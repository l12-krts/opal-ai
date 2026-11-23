// Terminals on this machine: a shell in a thread's folder, or a single command such as an agent's
// sign-in. Uses node-pty when it loads. Without it, Linux and macOS get a real terminal through
// `script` (so prompts and full-screen apps still work); elsewhere a plain pipe is the last resort.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { RunnerEvent } from "./protocol.js";

type Term = { write: (d: string) => void; resize: (c: number, r: number) => void; kill: () => void };
const terms = new Map<string, Term>();

const shell = () => (process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash");

/** Quotes one argument for a POSIX shell. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

type OpenArgs = { termId: string; cwd: string; cols: number; rows: number; command?: string[]; onExit?: (code: number | null) => void };

export async function open(a: OpenArgs, emit: (e: RunnerEvent) => void) {
  close(a.termId);
  const [file, ...args] = a.command?.length ? a.command : [shell()];
  const env = { ...process.env, TERM: "xterm-256color", COLUMNS: String(a.cols), LINES: String(a.rows) } as Record<string, string>;
  const exited = (code: number | null) => {
    terms.delete(a.termId);
    emit({ type: "terminal-exit", termId: a.termId, code });
    a.onExit?.(code);
  };

  try {
    const pty = await import("node-pty");
    const p = pty.spawn(file, args, { name: "xterm-256color", cwd: a.cwd, cols: a.cols, rows: a.rows, env });
    p.onData((data) => emit({ type: "terminal", termId: a.termId, data }));
    p.onExit(({ exitCode }) => exited(exitCode));
    terms.set(a.termId, { write: (d) => p.write(d), resize: (c, r) => p.resize(c, r), kill: () => p.kill() });
    return { ok: true };
  } catch {}

  // util-linux / BSD `script` allocates a pseudo-terminal for the command.
  const script = process.platform === "linux" ? "/usr/bin/script" : process.platform === "darwin" ? "/usr/bin/script" : null;
  if (script && existsSync(script)) {
    const line = [file, ...args].map(q).join(" ");
    // Size the pty before the command starts; `script` can't be resized afterwards.
    const sized = `stty cols ${a.cols} rows ${a.rows} 2>/dev/null; exec ${line}`;
    const scriptArgs = process.platform === "linux" ? ["-qfec", `sh -c ${q(sized)}`, "/dev/null"] : ["-q", "/dev/null", "sh", "-c", sized];
    const p = spawn(script, scriptArgs, { cwd: a.cwd, env });
    p.stdout.on("data", (d) => emit({ type: "terminal", termId: a.termId, data: d.toString() }));
    p.stderr.on("data", (d) => emit({ type: "terminal", termId: a.termId, data: d.toString() }));
    p.on("exit", (code) => exited(code));
    terms.set(a.termId, { write: (d) => p.stdin.write(d), resize: () => {}, kill: () => p.kill() });
    return { ok: true };
  }

  const p = spawn(file, args, { cwd: a.cwd, env, windowsHide: true });
  p.stdout.on("data", (d) => emit({ type: "terminal", termId: a.termId, data: d.toString() }));
  p.stderr.on("data", (d) => emit({ type: "terminal", termId: a.termId, data: d.toString() }));
  p.on("exit", (code) => exited(code));
  p.on("error", (err) => {
    emit({ type: "terminal", termId: a.termId, data: `${err.message}\r\n` });
    exited(null);
  });
  terms.set(a.termId, { write: (d) => p.stdin.write(d.replace(/\r/g, "\n")), resize: () => {}, kill: () => p.kill() });
  emit({ type: "terminal", termId: a.termId, data: "(basic terminal: node-pty is not available)\r\n" });
  return { ok: true };
}

export const input = (termId: string, data: string) => terms.get(termId)?.write(data);
export const resize = (termId: string, cols: number, rows: number) => terms.get(termId)?.resize(cols, rows);
export function close(termId: string) {
  terms.get(termId)?.kill();
  terms.delete(termId);
}
export const closeAll = () => [...terms.keys()].forEach(close);
