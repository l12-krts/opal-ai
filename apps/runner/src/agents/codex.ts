// OpenAI Codex through `codex app-server` (JSON-RPC 2.0, one JSON message per line on stdio).
// Protocol shapes follow T3 Code's generated schema (packages/effect-codex-app-server).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Decision, ItemData, Mode } from "../protocol.js";
import { safeCommand } from "../policy.js";
import { VERSION } from "../config.js";
import { type AgentSession, type SessionCtx, clip, emitters } from "./types.js";

type Rpc = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };

const policy = (mode: Mode) =>
  mode === "full"
    ? { approvalPolicy: "never", sandbox: "danger-full-access" }
    : mode === "ask"
      ? { approvalPolicy: "untrusted", sandbox: "workspace-write" }
      : { approvalPolicy: "on-request", sandbox: "workspace-write" };

const DECISION: Record<Decision, string> = { allow: "accept", allow_session: "acceptForSession", deny: "decline" };

export function codexSession(ctx: SessionCtx): AgentSession {
  const e = emitters(ctx);
  let mode: Mode = ctx.mode;
  let proc: ChildProcessWithoutNullStreams | null = null;
  let nextId = 1;
  const calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const pending = new Map<string, { rpcId: number | string; itemId: string; data: Extract<ItemData, { kind: "approval" }> }>();
  const texts = new Map<string, string>();
  const outputs = new Map<string, string>();
  const queue: string[] = [];
  let threadId: string | null = ctx.sessionId;
  let turnId: string | null = null;
  let ready: Promise<void> | null = null;
  let closed = false;

  function write(msg: Rpc) {
    proc?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  }

  function request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      calls.set(id, { resolve: resolve as (v: unknown) => void, reject });
      write({ id, method, params });
    });
  }

  function mcpConfig() {
    return {
      "mcp_servers.opal-code": { url: ctx.mcp.url, http_headers: { Authorization: `Bearer ${ctx.mcp.token}` }, tool_timeout_sec: 1800 },
    };
  }

  async function start() {
    proc = spawn("codex", ["app-server"], { cwd: ctx.cwd, shell: process.platform === "win32", windowsHide: true, env: process.env });
    proc.on("exit", (code) => {
      for (const c of calls.values()) c.reject(new Error(`Codex exited (${code})`));
      calls.clear();
      if (!closed) {
        e.item(`err_${Date.now()}`, { kind: "error", text: `Codex stopped (exit ${code}).` });
        e.status("error");
      }
      proc = null;
      ready = null;
    });
    proc.stderr.on("data", (d) => process.env.OPAL_RUNNER_DEBUG && process.stderr.write(d));
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let msg: Rpc;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id !== undefined && !msg.method) {
        const c = calls.get(Number(msg.id));
        if (!c) return;
        calls.delete(Number(msg.id));
        if (msg.error) c.reject(new Error(msg.error.message));
        else c.resolve(msg.result);
      } else if (msg.method && msg.id !== undefined) onRequest(msg);
      else if (msg.method) onNotification(msg.method, msg.params ?? {});
    });

    await request("initialize", { clientInfo: { name: "opal-code", title: "Opal Code", version: VERSION }, capabilities: { experimentalApi: true } });
    write({ method: "initialized" });
    const common = { cwd: ctx.cwd, ...(ctx.model ? { model: ctx.model } : {}), ...policy(mode), developerInstructions: ctx.instructions, config: mcpConfig() };
    let res: { thread?: { id: string } } | null = null;
    if (threadId) res = await request<{ thread?: { id: string } }>("thread/resume", { ...common, threadId }).catch(() => null);
    if (!res) res = await request<{ thread?: { id: string } }>("thread/start", common);
    threadId = res.thread?.id ?? threadId;
    if (threadId) e.session(threadId);
  }

  function itemData(item: Record<string, unknown>, done: boolean): ItemData | null {
    const st = String(item.status ?? "");
    const status = !done ? "running" : st === "failed" || st === "declined" ? "failed" : "done";
    switch (item.type) {
      case "agentMessage":
        return { kind: "assistant", text: String(item.text ?? texts.get(String(item.id)) ?? "") };
      case "reasoning": {
        const t = [...((item.summary as string[]) ?? []), ...((item.content as string[]) ?? [])].join("\n\n");
        return t ? { kind: "reasoning", text: t } : null;
      }
      case "commandExecution":
        return {
          kind: "command",
          command: String(item.command ?? ""),
          output: clip(String(item.aggregatedOutput ?? outputs.get(String(item.id)) ?? "")),
          exitCode: (item.exitCode as number | null) ?? null,
          status,
        };
      case "fileChange":
        return {
          kind: "edit",
          files: ((item.changes as { path: string; kind?: { type?: string } | string; diff?: string }[]) ?? []).map((c) => {
            const k = typeof c.kind === "string" ? c.kind : c.kind?.type;
            return { path: c.path, change: k === "add" ? "add" : k === "delete" ? "delete" : "update", diff: c.diff ? clip(c.diff, 30_000) : undefined };
          }),
          status,
        };
      case "mcpToolCall": {
        const r = item.result as { content?: { text?: string }[] } | null;
        return {
          kind: "tool",
          name: String(item.tool ?? "tool"),
          server: String(item.server ?? ""),
          input: item.arguments,
          output: r?.content?.map((c) => c.text ?? "").join("\n") ?? (item.error as { message?: string } | null)?.message,
          status,
        };
      }
      case "webSearch":
        return { kind: "tool", name: "web_search", input: { query: item.query }, status };
      default:
        return null;
    }
  }

  function onNotification(method: string, p: Record<string, unknown>) {
    switch (method) {
      case "item/started":
      case "item/completed": {
        const item = p.item as Record<string, unknown>;
        const d = itemData(item, method === "item/completed");
        if (d) e.item(`cx_${item.id}`, d);
        return;
      }
      case "item/agentMessage/delta": {
        const id = String(p.itemId);
        const t = (texts.get(id) ?? "") + String(p.delta ?? "");
        texts.set(id, t);
        e.item(`cx_${id}`, { kind: "assistant", text: t });
        return;
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const id = `r${p.itemId}`;
        const t = (texts.get(id) ?? "") + String(p.delta ?? "");
        texts.set(id, t);
        e.item(`cx_${p.itemId}`, { kind: "reasoning", text: t });
        return;
      }
      case "item/commandExecution/outputDelta": {
        const id = String(p.itemId);
        outputs.set(id, (outputs.get(id) ?? "") + String(p.delta ?? ""));
        return;
      }
      case "turn/started":
        turnId = String((p.turn as { id?: string })?.id ?? turnId);
        return;
      case "turn/completed": {
        const turn = p.turn as { status?: string; error?: { message?: string } } | undefined;
        turnId = null;
        if (turn?.status === "failed") e.item(`err_${Date.now()}`, { kind: "error", text: turn.error?.message ?? "The turn failed" });
        if (queue.length) return void runTurn(queue.shift()!);
        e.status(turn?.status === "failed" ? "error" : "idle");
        return;
      }
      case "error":
        e.item(`err_${Date.now()}`, { kind: "error", text: String((p.error as { message?: string })?.message ?? p.message ?? "Codex error") });
        return;
    }
  }

  function onRequest(msg: Rpc) {
    const p = msg.params ?? {};
    const isCmd = msg.method === "item/commandExecution/requestApproval";
    const isFile = msg.method === "item/fileChange/requestApproval";
    if (!isCmd && !isFile) {
      write({ id: msg.id, error: { message: "Not supported by Opal Code" } } as Rpc);
      return;
    }
    const command = isCmd ? String(p.command ?? "") : undefined;
    if (mode === "full" || (mode === "auto" && command && safeCommand(command))) {
      write({ id: msg.id, result: { decision: "accept" } });
      return;
    }
    const requestId = `cx_${String(msg.id)}_${Date.now().toString(36)}`;
    const itemId = `ap_${requestId}`;
    const data: Extract<ItemData, { kind: "approval" }> = {
      kind: "approval",
      requestId,
      title: isCmd ? "Run a command" : "Change files",
      command,
      detail: p.reason ? String(p.reason) : undefined,
      status: "pending",
    };
    pending.set(requestId, { rpcId: msg.id!, itemId, data });
    e.item(itemId, data);
    e.status("waiting");
  }

  async function runTurn(text: string) {
    e.status("working");
    try {
      ready ??= start();
      await ready;
      const r = await request<{ turn?: { id: string } }>("turn/start", { threadId, input: [{ type: "text", text }], approvalPolicy: policy(mode).approvalPolicy });
      turnId = r.turn?.id ?? turnId;
    } catch (err) {
      e.item(`err_${Date.now()}`, { kind: "error", text: `Codex: ${(err as Error).message}` });
      e.status("error");
    }
  }

  return {
    send(text) {
      if (turnId || (ready && !threadId)) queue.push(text);
      else void runTurn(text);
    },
    async interrupt() {
      queue.length = 0;
      for (const [id, p] of pending) {
        write({ id: p.rpcId, result: { decision: "cancel" } });
        e.item(p.itemId, { ...p.data, status: "expired" });
        pending.delete(id);
      }
      if (threadId && turnId) await request("turn/interrupt", { threadId, turnId }).catch(() => {});
      e.item(`n_${Date.now()}`, { kind: "notice", text: "Stopped" });
      e.status("idle");
    },
    respond(requestId, decision) {
      const p = pending.get(requestId);
      if (!p) return false;
      pending.delete(requestId);
      write({ id: p.rpcId, result: { decision: DECISION[decision] } });
      e.item(p.itemId, { ...p.data, status: decision === "deny" ? "denied" : "approved" });
      if (!pending.size) e.status("working");
      return true;
    },
    setMode(next) {
      mode = next;
    },
    close() {
      closed = true;
      proc?.kill();
    },
  };
}
