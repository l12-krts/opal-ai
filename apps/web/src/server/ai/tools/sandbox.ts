// Computer tools: each agent has its own sandbox (browser + terminal + file system).
import { tool } from "ai";
import { z } from "zod";
import { ensureSandbox, execIn, SandboxUnavailableError, touchSandbox } from "../../sandbox/docker";
import { redact, resolvePlaceholders } from "../../vault";
import { ATTACHMENT_LIMITS, saveAgentFile } from "../../attachments";
import type { RunContext } from "../context";

const PATH = z
  .string()
  .max(300)
  .regex(/^[^\0]+$/)
  .describe("Path relative to /workspace, or absolute inside /workspace");

function inWorkspace(p: string): string {
  const clean = p.startsWith("/") ? p : `/workspace/${p}`;
  const parts: string[] = [];
  for (const seg of clean.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  const abs = `/${parts.join("/")}`;
  if (abs !== "/workspace" && !abs.startsWith("/workspace/")) throw new Error("Path must stay inside /workspace");
  return abs;
}

export function sandboxTools(ctx: RunContext) {
  const sb = () => ensureSandbox(ctx.userId, ctx.sandboxAgentId);

  const frame = (patch: Record<string, unknown>) =>
    ctx.writer.write({
      type: "data-sandbox",
      transient: true,
      data: {
        agentId: ctx.sandboxAgentId,
        agentName: ctx.sandboxAgentName,
        color: ctx.sandboxColor,
        shape: ctx.self?.agentId === ctx.sandboxAgentId ? ctx.self.shape : undefined,
        at: Date.now(),
        ...patch,
      },
    });

  const fail = (err: unknown) => ({
    ok: false as const,
    error: err instanceof SandboxUnavailableError ? err.message : err instanceof Error ? err.message.slice(0, 300) : "Failed",
  });

  return {
    browser: tool({
      description:
        "Control this agent's own Chromium browser. Actions: goto (url), click (selector or visible text), type (selector, value, submit), press (key), scroll (dy), back, read. Returns the page URL, title, visible text and links. Use {{secret:NAME}} placeholders for passwords; never ask for raw secrets.",
      inputSchema: z.object({
        action: z.enum(["goto", "click", "type", "press", "scroll", "back", "read"]),
        url: z.string().optional(),
        selector: z.string().max(300).optional(),
        text: z.string().max(200).optional(),
        value: z.string().max(4000).optional(),
        submit: z.boolean().optional(),
        key: z.string().max(40).optional(),
        dy: z.number().optional(),
      }),
      execute: async (input) => {
        try {
          const c = await sb();
          let payload = JSON.stringify(input);
          let used: string[] = [];
          if (input.value && input.value.includes("{{secret:")) {
            const r = await resolvePlaceholders(ctx.userId, input.value);
            if (r.missing.length) return { ok: false, error: `Missing secrets: ${r.missing.join(", ")}. Call request_secret first.` };
            payload = JSON.stringify({ ...input, value: r.resolved });
            used = r.values;
            ctx.secretValues.push(...r.values);
          }
          // Screenshots come back as base64 JPEG, so allow a much larger reply than for shell output.
          const res = await execIn(c, ["node", "/opt/opal/browser-client.mjs", payload], { timeoutSec: 50, maxOutput: 4_000_000 });
          let data: { ok: boolean; error?: string; url?: string; title?: string; text?: string; links?: { text: string; href: string }[]; screenshot?: string };
          try {
            data = JSON.parse(res.stdout);
          } catch {
            return { ok: false, error: (res.stderr || res.stdout || "Browser error").slice(0, 300) };
          }
          if (!data.ok) return { ok: false, error: data.error };
          const shot = data.screenshot ? `data:image/jpeg;base64,${data.screenshot}` : undefined;
          frame({ url: data.url, title: data.title, screenshot: shot });
          await touchSandbox(ctx.sandboxAgentId, { lastScreenshot: shot, lastUrl: data.url });
          const scrub = (s: string) => redact(s, [...used, ...ctx.secretValues]);
          return {
            ok: true,
            url: data.url,
            title: data.title,
            text: scrub((data.text ?? "").slice(0, 7000)),
            links: (data.links ?? []).slice(0, 30),
          };
        } catch (err) {
          return fail(err);
        }
      },
    }),

    terminal: tool({
      description:
        "Run a bash command in this agent's sandbox (Ubuntu, with python3, node, git, curl, jq, ripgrep). Working directory /workspace. 90 second limit. Network access is available; private networks are not.",
      inputSchema: z.object({ command: z.string().min(1).max(4000) }),
      execute: async ({ command }) => {
        try {
          const c = await sb();
          let cmd = command;
          if (cmd.includes("{{secret:")) {
            const r = await resolvePlaceholders(ctx.userId, cmd);
            if (r.missing.length) return { ok: false, error: `Missing secrets: ${r.missing.join(", ")}` };
            cmd = r.resolved;
            ctx.secretValues.push(...r.values);
          }
          const res = await execIn(c, ["bash", "-lc", cmd], { timeoutSec: 90 });
          const output = redact(`${res.stdout}${res.stderr ? `\n${res.stderr}` : ""}`.trim(), ctx.secretValues);
          frame({ terminal: { command, output: output.slice(-4000), exitCode: res.exitCode } });
          await touchSandbox(ctx.sandboxAgentId);
          return { ok: res.exitCode === 0, exitCode: res.exitCode, output: output.slice(-10000), truncated: res.truncated };
        } catch (err) {
          return fail(err);
        }
      },
    }),

    list_files: tool({
      description: "List files in this agent's /workspace (or a subfolder).",
      inputSchema: z.object({ path: PATH.optional() }),
      execute: async ({ path }) => {
        try {
          const c = await sb();
          const dir = inWorkspace(path ?? "/workspace");
          const res = await execIn(c, ["find", dir, "-maxdepth", "3", "-not", "-path", "*/node_modules/*", "-printf", "%y %s %P\n"], {
            timeoutSec: 15,
          });
          const entries = res.stdout
            .split("\n")
            .filter(Boolean)
            .slice(0, 300)
            .map((l) => {
              const [type, size, ...rest] = l.split(" ");
              return { type: type === "d" ? "dir" : "file", size: Number(size), path: rest.join(" ") };
            })
            .filter((e) => e.path);
          return { ok: true, root: dir, entries };
        } catch (err) {
          return fail(err);
        }
      },
    }),

    read_file: tool({
      description: "Read a text file from this agent's workspace (first 60k characters).",
      inputSchema: z.object({ path: PATH }),
      execute: async ({ path }) => {
        try {
          const c = await sb();
          const res = await execIn(c, ["head", "-c", "60000", inWorkspace(path)], { timeoutSec: 15 });
          if (res.exitCode !== 0) return { ok: false, error: res.stderr.slice(0, 300) };
          return { ok: true, path, content: redact(res.stdout, ctx.secretValues) };
        } catch (err) {
          return fail(err);
        }
      },
    }),

    write_file: tool({
      description: "Create or overwrite a text file in this agent's workspace.",
      inputSchema: z.object({ path: PATH, content: z.string().max(500_000) }),
      execute: async ({ path, content }) => {
        try {
          const c = await sb();
          const abs = inWorkspace(path);
          const res = await execIn(c, ["sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "_", abs], {
            timeoutSec: 20,
            stdin: content,
          });
          if (res.exitCode !== 0) return { ok: false, error: res.stderr.slice(0, 300) };
          await touchSandbox(ctx.sandboxAgentId);
          return { ok: true, path: abs, bytes: Buffer.byteLength(content) };
        } catch (err) {
          return fail(err);
        }
      },
    }),

    share_file: tool({
      description:
        "Attach a file from this agent's workspace to the chat, so the user can open it in Opal (a report, spreadsheet, slide deck, image, PDF, audio, zip…). Up to 20 MB. Use it whenever you made or downloaded something the user should have, then mention it in your reply.",
      inputSchema: z.object({
        path: PATH,
        name: z.string().max(120).optional().describe("Name to show; defaults to the file's own name"),
      }),
      execute: async ({ path, name }) => {
        try {
          const c = await sb();
          const abs = inWorkspace(path);
          const stat = await execIn(c, ["stat", "-L", "-c", "%s %F", abs], { timeoutSec: 10 });
          if (stat.exitCode !== 0) return { ok: false, error: `No such file: ${path}` };
          const [bytes, ...kind] = stat.stdout.trim().split(" ");
          if (!kind.join(" ").startsWith("regular")) return { ok: false, error: `${path} is not a file` };
          const size = Number(bytes);
          if (size > ATTACHMENT_LIMITS.maxBytes) return { ok: false, error: "Files can be up to 20 MB" };
          // Binary-safe: the file comes out as base64 and goes into Opal's own storage.
          const res = await execIn(c, ["base64", "-w0", abs], { timeoutSec: 40, maxOutput: Math.ceil(size / 3) * 4 + 1024 });
          if (res.exitCode !== 0 || res.truncated) return { ok: false, error: (res.stderr || "Could not read the file").slice(0, 300) };
          const file = await saveAgentFile(
            ctx.userId,
            ctx.conversationId,
            name?.trim() || abs.split("/").pop() || "file",
            Buffer.from(res.stdout.trim(), "base64"),
            (text) => redact(text, ctx.secretValues),
          );
          await touchSandbox(ctx.sandboxAgentId);
          return { ok: true, file };
        } catch (err) {
          return fail(err);
        }
      },
    }),
  };
}
