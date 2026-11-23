// Finds the coding agents installed on this machine, and whether they're signed in.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type AgentInfo = {
  id: string;
  version: string | null;
  ok: boolean;
  note?: string;
  path?: string;
  /** Installed but not signed in: Opal offers a "Sign in" button that runs `login` here. */
  signedIn?: boolean;
};

function run(cmd: string, args: string[], timeout = 15_000): Promise<{ out: string; ok: boolean }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, shell: process.platform === "win32", windowsHide: true }, (err, stdout, stderr) => {
      resolve({ out: `${stdout ?? ""}${stderr ?? ""}`.trim(), ok: !err });
    });
  });
}

async function which(cmd: string): Promise<string | null> {
  const r = await run(process.platform === "win32" ? "where" : "which", [cmd], 5000);
  if (!r.ok) return null;
  return r.out.split(/\r?\n/)[0]?.trim() || null;
}

/** The Claude Code binary that ships inside the Agent SDK's platform package, if there is one. */
export function bundledClaude(): string | null {
  const require = createRequire(import.meta.url);
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const names =
    process.platform === "linux"
      ? [`linux-${arch}`, `linux-${arch}-musl`]
      : process.platform === "darwin"
        ? [`darwin-${arch}`]
        : [`win32-${arch}`];
  for (const n of names) {
    try {
      const dir = dirname(require.resolve(`@anthropic-ai/claude-agent-sdk-${n}/package.json`));
      const bin = join(dir, process.platform === "win32" ? "claude.exe" : "claude");
      if (existsSync(bin)) return bin;
    } catch {}
  }
  return null;
}

/** The command to run for an agent's sign-in, or null when it can't sign in here. */
export function loginCommand(agent: string, agents: AgentInfo[]): string[] | null {
  const info = agents.find((a) => a.id === agent);
  if (!info?.path) return null;
  if (agent === "claude") return [info.path, "auth", "login"];
  // Device sign-in prints a link and a code, which works from a browser on another computer.
  if (agent === "codex") return [info.path, "login", "--device-auth"];
  return null;
}

export async function detectAgents(): Promise<AgentInfo[]> {
  const out: AgentInfo[] = [];

  const claude = (await which("claude")) ?? bundledClaude();
  if (claude) {
    const v = await run(claude, ["--version"]);
    const m = v.out.match(/(\d+\.\d+\.\d+)/);
    const auth = await run(claude, ["auth", "status"]);
    let signedIn = true;
    try {
      signedIn = Boolean((JSON.parse(auth.out.slice(auth.out.indexOf("{"))) as { loggedIn?: boolean }).loggedIn);
    } catch {}
    const note = !v.ok ? "claude --version failed" : !signedIn ? "Not signed in on this machine." : undefined;
    out.push({ id: "claude", version: m?.[1] ?? null, ok: v.ok && signedIn, path: claude, signedIn, ...(note ? { note } : {}) });
  } else {
    out.push({ id: "claude", version: null, ok: false, note: "Claude Code isn't installed. Install it with: npm i -g @anthropic-ai/claude-code" });
  }

  const codex = await which("codex");
  if (codex) {
    const v = await run(codex, ["--version"]);
    // The real CLI prints "codex-cli x.y.z"; an unrelated npm package called "codex" exists too.
    const m = v.out.match(/codex-cli\s+(\d+\.\d+\.\d+)/i);
    if (m) {
      const signedIn = (await run(codex, ["login", "status"])).ok;
      out.push({
        id: "codex",
        version: m[1],
        ok: signedIn,
        path: codex,
        signedIn,
        ...(signedIn ? {} : { note: "Not signed in on this machine." }),
      });
    } else {
      out.push({ id: "codex", version: null, ok: false, note: "`codex` here isn't OpenAI's Codex CLI. Install it with: npm i -g @openai/codex" });
    }
  } else {
    out.push({ id: "codex", version: null, ok: false, note: "Not installed. Install with: npm i -g @openai/codex" });
  }
  return out;
}

export { run, which };
