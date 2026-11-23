// Claude Code through the Claude Agent SDK, in streaming-input mode so one session serves the
// whole thread. Uses the Claude login already on this machine.
import { query, type Query, type SDKMessage, type SDKUserMessage, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Decision, Mode } from "../protocol.js";
import { autoAllows } from "../policy.js";
import { type AgentSession, type SessionCtx, blockDiff, clip, emitters } from "./types.js";

type Pending = { resolve: (d: Decision) => void; itemId: string; title: string; command?: string; detail?: string };

export function claudeSession(ctx: SessionCtx, claudePath: string | null): AgentSession {
  const e = emitters(ctx);
  let mode: Mode = ctx.mode;
  const inbox: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let turns = 0;
  let approvals = 0;
  const pending = new Map<string, Pending>();
  const sessionAllowed = new Set<string>();
  const tools = new Map<string, { name: string; input: Record<string, unknown>; files?: { path: string; change: "add" | "update"; diff?: string }[] }>();
  let mid = "m";
  const texts = new Map<string, { kind: "assistant" | "reasoning"; text: string }>();
  const abort = new AbortController();
  const sessions: { onClosed?: (id: string) => void } = {};

  async function* input(): AsyncGenerator<SDKUserMessage> {
    while (!closed) {
      const next = inbox.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((r) => (wake = r));
      wake = null;
    }
  }

  function key(tool: string, inp: Record<string, unknown>) {
    return tool === "Bash" ? `Bash:${String(inp.command ?? "").trim().split(/\s+/).slice(0, 2).join(" ")}` : tool;
  }

  const canUseTool = async (toolName: string, inp: Record<string, unknown>, opts: { signal: AbortSignal; title?: string; decisionReason?: string }): Promise<PermissionResult> => {
    if (mode === "full") return { behavior: "allow", updatedInput: inp };
    if (mode === "auto" && autoAllows(toolName, inp, ctx.cwd)) return { behavior: "allow", updatedInput: inp };
    if (sessionAllowed.has(key(toolName, inp))) return { behavior: "allow", updatedInput: inp };

    const requestId = `cl_${++approvals}_${Date.now().toString(36)}`;
    const itemId = `ap_${requestId}`;
    const command = toolName === "Bash" ? String(inp.command ?? "") : undefined;
    const file = String(inp.file_path ?? inp.notebook_path ?? "");
    const title = opts.title || (command ? "Run a command" : file ? `${toolName} ${file}` : `Use ${toolName}`);
    const detail = opts.decisionReason || (command ? undefined : file || JSON.stringify(inp).slice(0, 400));
    e.item(itemId, { kind: "approval", requestId, title, command, detail, status: "pending" });
    e.status("waiting");
    const decision = await new Promise<Decision>((resolve) => {
      pending.set(requestId, { resolve, itemId, title, command, detail });
      opts.signal.addEventListener("abort", () => resolve("deny"));
    });
    pending.delete(requestId);
    e.item(itemId, { kind: "approval", requestId, title, command, detail, status: decision === "deny" ? "denied" : "approved" });
    if (!pending.size) e.status("working");
    if (decision === "allow_session") sessionAllowed.add(key(toolName, inp));
    return decision === "deny" ? { behavior: "deny", message: "The user declined this." } : { behavior: "allow", updatedInput: inp };
  };

  const q: Query = query({
    prompt: input(),
    options: {
      cwd: ctx.cwd,
      model: ctx.model ?? undefined,
      abortController: abort,
      includePartialMessages: true,
      permissionMode: mode === "full" ? "bypassPermissions" : "default",
      allowDangerouslySkipPermissions: mode === "full",
      canUseTool: canUseTool as never,
      resume: ctx.sessionId ?? undefined,
      systemPrompt: { type: "preset", preset: "claude_code", append: ctx.instructions },
      mcpServers: {
        "opal-code": { type: "http", url: ctx.mcp.url, headers: { Authorization: `Bearer ${ctx.mcp.token}` }, timeout: 30 * 60_000 },
      },
      allowedTools: ["mcp__opal-code__*"],
      settingSources: ["user", "project", "local"],
      // The SDK's own Claude Code (same login as the CLI). MCP config, which carries this
      // thread's token, goes over stdin rather than the command line other users can read.
      mcpServersDelivery: "initialize",
      ...(claudePath && process.env.OPAL_CLAUDE_PATH ? { pathToClaudeCodeExecutable: claudePath } : {}),
    } as never,
  });

  function toolStarted(id: string, name: string, inp: Record<string, unknown>) {
    tools.set(id, { name, input: inp });
    if (name === "Bash") return e.item(id, { kind: "command", command: String(inp.command ?? ""), status: "running" });
    if (name === "Edit" || name === "MultiEdit" || name === "Write") {
      const path = String(inp.file_path ?? "");
      const diff =
        name === "Write"
          ? blockDiff("", String(inp.content ?? ""))
          : name === "Edit"
            ? blockDiff(String(inp.old_string ?? ""), String(inp.new_string ?? ""))
            : ((inp.edits as { old_string: string; new_string: string }[]) ?? []).map((x) => blockDiff(x.old_string, x.new_string)).join("\n");
      const files = [{ path, change: name === "Write" ? ("add" as const) : ("update" as const), diff }];
      tools.set(id, { name, input: inp, files });
      return e.item(id, { kind: "edit", files, status: "running" });
    }
    const server = name.startsWith("mcp__") ? name.split("__")[1] : undefined;
    e.item(id, { kind: "tool", name: server ? name.split("__").slice(2).join("__") : name, server, input: inp, status: "running" });
  }

  function toolFinished(id: string, output: string, isError: boolean) {
    const t = tools.get(id);
    if (!t) return;
    const status = isError ? "failed" : "done";
    if (t.name === "Bash") {
      const m = output.match(/exit code (\d+)/i);
      return e.item(id, { kind: "command", command: String(t.input.command ?? ""), output: clip(output), exitCode: m ? Number(m[1]) : isError ? 1 : 0, status });
    }
    if (t.name === "Edit" || t.name === "MultiEdit" || t.name === "Write") {
      return e.item(id, { kind: "edit", files: t.files ?? [], status });
    }
    const server = t.name.startsWith("mcp__") ? t.name.split("__")[1] : undefined;
    e.item(id, { kind: "tool", name: server ? t.name.split("__").slice(2).join("__") : t.name, server, input: t.input, output: clip(output, 8000), status });
  }

  function onMessage(m: SDKMessage) {
    switch (m.type) {
      case "system":
        if (m.subtype === "init" && "session_id" in m) e.session(m.session_id);
        return;
      case "stream_event": {
        const ev = m.event as { type: string; index?: number; delta?: { type: string; text?: string; thinking?: string }; content_block?: { type: string }; message?: { id: string } };
        if (ev.type === "message_start" && ev.message) mid = ev.message.id;
        if (ev.type === "content_block_delta" && ev.delta) {
          const id = `${ev.delta.type === "thinking_delta" ? "r" : "a"}_${mid}_${ev.index}`;
          const piece = ev.delta.text ?? ev.delta.thinking ?? "";
          if (!piece) return;
          const cur = texts.get(id) ?? { kind: ev.delta.type === "thinking_delta" ? "reasoning" : "assistant", text: "" };
          cur.text += piece;
          texts.set(id, cur);
          e.item(id, { kind: cur.kind, text: cur.text });
        }
        return;
      }
      case "assistant": {
        const msg = m.message as { id: string; content: { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }[] };
        msg.content.forEach((b, i) => {
          if (b.type === "text" && b.text) e.item(`a_${msg.id}_${i}`, { kind: "assistant", text: b.text });
          else if (b.type === "thinking" && b.thinking) e.item(`r_${msg.id}_${i}`, { kind: "reasoning", text: b.thinking });
          else if (b.type === "tool_use" && b.id) toolStarted(b.id, b.name ?? "tool", b.input ?? {});
        });
        return;
      }
      case "user": {
        const content = (m.message as { content: unknown }).content;
        if (!Array.isArray(content)) return;
        for (const b of content as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
          if (b.type !== "tool_result" || !b.tool_use_id) continue;
          const out = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? (b.content as { text?: string }[]).map((c) => c.text ?? "").join("\n") : "";
          toolFinished(b.tool_use_id, out, Boolean(b.is_error));
        }
        return;
      }
      case "result": {
        if (m.subtype !== "success") {
          const errs = (m as { errors?: string[] }).errors;
          e.item(`err_${Date.now()}`, { kind: "error", text: errs?.join("\n") || `Claude stopped (${m.subtype})` });
        }
        turns = Math.max(0, turns - 1);
        if (!turns) e.status(m.subtype === "success" ? "idle" : "error");
        return;
      }
    }
  }

  void (async () => {
    try {
      for await (const m of q) onMessage(m);
    } catch (err) {
      if (!closed) {
        e.item(`err_${Date.now()}`, { kind: "error", text: (err as Error).message });
        e.status("error");
      }
    } finally {
      closed = true;
      sessions.onClosed?.(ctx.threadId);
    }
  })();

  return Object.assign(
    {
      send(text: string) {
        turns += 1;
        inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" } as SDKUserMessage);
        e.status("working");
        wake?.();
      },
      async interrupt() {
        for (const p of pending.values()) p.resolve("deny");
        await q.interrupt().catch(() => {});
        inbox.length = 0;
        turns = 0;
        e.item(`n_${Date.now()}`, { kind: "notice", text: "Stopped" });
        e.status("idle");
      },
      respond(requestId: string, decision: Decision) {
        const p = pending.get(requestId);
        if (!p) return false;
        p.resolve(decision);
        return true;
      },
      setMode(next: Mode) {
        mode = next;
        void q.setPermissionMode(next === "full" ? "bypassPermissions" : "default").catch(() => {});
      },
      close() {
        closed = true;
        for (const p of pending.values()) p.resolve("deny");
        abort.abort();
        wake?.();
      },
    } satisfies AgentSession,
    { hooks: sessions },
  );
}
