// Opal runner: connects this machine to Opal Code and runs coding agents here.
//   npm run pair -- <opal-url> <code> [--name "My PC"] [--root ~/Projects]
//   npm start
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { claudeSession } from "./agents/claude.js";
import { codexSession } from "./agents/codex.js";
import type { AgentSession } from "./agents/types.js";
import { CONFIG_PATH, SCRATCH, VERSION, loadConfig, saveConfig, type Config } from "./config.js";
import { Connection } from "./connection.js";
import { detectAgents, loginCommand, type AgentInfo } from "./detect.js";
import * as git from "./git.js";
import * as files from "./files.js";
import { McpServer } from "./mcp.js";
import type { Command, Decision, Mode, TurnArgs } from "./protocol.js";
import * as term from "./terminal.js";

// Inside the AppImage the commands are `opal-runner pair|start`; from the repo they're npm scripts.
const CMD = process.env.OPAL_RUNNER_CMD;
const PAIR = CMD ? `${CMD} pair` : "npm run pair --";
const START = CMD ? `${CMD} start` : "npm start";

const expand = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

function flag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function pair(args: string[]) {
  const [url, code] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!url || !code) {
    console.log(`Usage: ${PAIR} <opal-url> <code> [--name "My PC"] [--root ~/Projects]`);
    process.exit(1);
  }
  const name = flag(args, "--name") ?? hostname();
  const projectsRoot = resolve(expand(flag(args, "--root") ?? join(homedir(), "Projects")));
  mkdirSync(projectsRoot, { recursive: true });
  const serverUrl = new URL(url).origin;
  const res = await fetch(new URL("/api/code/runner/pair", serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name, os: platform(), hostname: hostname(), projectsRoot }),
  });
  const data = (await res.json().catch(() => ({}))) as { machineId?: string; token?: string; message?: string };
  if (!res.ok || !data.token || !data.machineId) {
    console.error(`Pairing failed: ${data.message ?? `HTTP ${res.status}`}`);
    process.exit(1);
  }
  saveConfig({ serverUrl, machineId: data.machineId, token: data.token, name, projectsRoot });
  console.log(`Paired "${name}". Projects go in ${projectsRoot}.\nSaved to ${CONFIG_PATH}. Now run: ${START}`);
}

async function start() {
  const cfg = loadConfig();
  if (!cfg) {
    console.error(`This machine isn't paired yet. In Opal, open Code → Machines → Connect a machine, then run:\n  ${PAIR} <opal-url> <code>`);
    process.exit(1);
  }
  let agents: AgentInfo[] = [];
  const sessions = new Map<string, AgentSession>();
  // eslint-disable-next-line prefer-const
  let conn: Connection;
  const mcp = new McpServer(null as unknown as Connection);

  async function hello() {
    agents = await detectAgents();
    const r = await conn.post<{ projectsRoot: string; name: string }>("/api/code/runner/hello", {
      agents: agents.map(({ id, version, ok, note, signedIn }) => ({ id, version, ok, note, signedIn })),
      runnerVersion: VERSION,
      os: platform(),
      hostname: hostname(),
    });
    if (r.projectsRoot !== cfg!.projectsRoot || r.name !== cfg!.name) saveConfig({ ...cfg!, projectsRoot: r.projectsRoot, name: r.name });
    Object.assign(cfg!, { projectsRoot: r.projectsRoot, name: r.name });
  }

  function session(a: TurnArgs): AgentSession {
    let s = sessions.get(a.threadId);
    if (s) return s;
    const ctx = {
      threadId: a.threadId,
      cwd: a.cwd,
      model: a.model,
      mode: a.mode,
      instructions: a.instructions,
      sessionId: a.sessionId,
      mcp: { url: mcp.url, token: mcp.tokenFor(a.threadId) },
      emit: (ev: Parameters<Connection["emit"]>[0]) => conn.emit(ev),
    };
    if (a.agent === "codex") {
      const info = agents.find((x) => x.id === "codex");
      if (!info?.ok) throw new Error(info?.note ?? "Codex isn't installed on this machine.");
      s = codexSession(ctx);
    } else {
      const info = agents.find((x) => x.id === "claude");
      s = claudeSession(ctx, info?.path && /claude(\.exe)?$/i.test(info.path) ? info.path : null);
      (s as AgentSession & { hooks?: { onClosed?: (id: string) => void } }).hooks!.onClosed = (id) => {
        if (sessions.get(id) === s) sessions.delete(id);
      };
    }
    sessions.set(a.threadId, s);
    return s;
  }

  async function handle(c: Command): Promise<unknown> {
    const a = c.args;
    switch (c.cmd) {
      case "replaced":
        console.error("[runner] Another runner connected with this machine's token. Stopping.");
        process.exit(0);
      case "revoked":
        console.error("[runner] This machine was removed in Opal. Pair it again to reconnect.");
        rmSync(CONFIG_PATH, { force: true });
        process.exit(0);
      case "config":
        saveConfig({ ...cfg!, name: String(a.name), projectsRoot: String(a.projectsRoot) });
        Object.assign(cfg!, { name: a.name, projectsRoot: a.projectsRoot });
        return { ok: true };
      case "project.create": {
        const name = String(a.name).replace(/[\\/:*?"<>|]/g, "-").trim();
        if (!name || name.startsWith("..")) throw new Error("Bad project name");
        const path = join(cfg!.projectsRoot, name);
        mkdirSync(path, { recursive: true });
        // A new project gets its own repository even when it sits inside another one.
        if (a.git !== false && !(await git.isRepoRoot(path))) await git.init(path);
        return { path, isGit: a.git !== false && (await git.isRepoRoot(path)) };
      }
      case "project.check": {
        const path = resolve(expand(String(a.path)));
        if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isDirectory()) throw new Error(`No folder at ${path}`);
        return { path, isGit: await git.isRepo(path) };
      }
      case "project.scratch": {
        const path = join(SCRATCH, String(a.name).replace(/[^\w.-]/g, "-"));
        mkdirSync(path, { recursive: true });
        return { path };
      }
      case "turn.start": {
        const t = a as unknown as TurnArgs;
        if (!existsSync(t.cwd)) throw new Error(`The thread's folder is gone: ${t.cwd}`);
        const s = session(t);
        s.setMode(t.mode);
        s.send(t.text);
        return { ok: true };
      }
      case "turn.interrupt":
        await sessions.get(String(a.threadId))?.interrupt();
        if (!sessions.get(String(a.threadId))) conn.emit({ type: "status", threadId: String(a.threadId), status: "idle" });
        return { ok: true };
      case "approval.respond":
        if (!sessions.get(String(a.threadId))?.respond(String(a.requestId), a.decision as Decision)) throw new Error("That request has expired");
        return { ok: true };
      case "thread.mode":
        sessions.get(String(a.threadId))?.setMode(a.mode as Mode);
        return { ok: true };
      case "thread.close":
        sessions.get(String(a.threadId))?.close();
        sessions.delete(String(a.threadId));
        return { ok: true };
      case "fs.search":
        return files.search(a as never);
      case "git.worktree":
        return git.worktree(a as never);
      case "git.status":
        return git.status(a as never);
      case "git.diff":
        return git.diff(a as never);
      case "git.commit":
        return git.commit(a as never);
      case "git.push":
        return git.push(a as never);
      case "git.pr":
        return git.pr(a as never);
      case "git.prState":
        return git.prState(a as never);
      case "git.branches":
        return git.branches(a as never);
      case "agent.login": {
        // Runs the agent's own sign-in in a terminal Opal shows beside the thread. When it ends,
        // the agents are checked again so Opal sees the new sign-in state.
        const cmd = loginCommand(String(a.agent), agents);
        if (!cmd) throw new Error(`${a.agent === "codex" ? "Codex" : "Claude Code"} isn't installed on this machine.`);
        return term.open(
          { termId: String(a.termId), cwd: homedir(), cols: Number(a.cols), rows: Number(a.rows), command: cmd, onExit: () => void hello().catch(() => {}) },
          (ev) => conn.emit(ev),
        );
      }
      case "agents.refresh":
        await hello();
        return { agents: agents.map(({ id, ok, signedIn }) => ({ id, ok, signedIn })) };
      case "terminal.open":
        return term.open(a as never, (ev) => conn.emit(ev));
      case "terminal.input":
        return term.input(String(a.termId), String(a.data));
      case "terminal.resize":
        return term.resize(String(a.termId), Number(a.cols), Number(a.rows));
      case "terminal.close":
        return term.close(String(a.termId));
      default:
        throw new Error(`Unknown command ${c.cmd}`);
    }
  }

  conn = new Connection(
    cfg,
    (c) => {
      void handle(c).then(
        (result) => {
          if (c.id) void conn.reply(c.id, true, result ?? null);
        },
        (err: Error) => {
          console.error(`[runner] ${c.cmd} failed: ${err.message}`);
          if (c.id) void conn.reply(c.id, false, undefined, err.message);
          else if (c.cmd === "turn.start" && c.args.threadId) {
            conn.emit({ type: "item", threadId: String(c.args.threadId), id: `err_${Date.now()}`, data: { kind: "error", text: err.message } });
            conn.emit({ type: "status", threadId: String(c.args.threadId), status: "error" });
          }
        },
      );
    },
    () => void hello().catch((e) => console.error("[runner] hello failed:", e.message)),
  );
  (mcp as unknown as { conn: Connection }).conn = conn;
  await mcp.start();
  mkdirSync(cfg.projectsRoot, { recursive: true });
  console.log(`[runner] Opal runner ${VERSION} · ${cfg.name} · projects in ${cfg.projectsRoot} · MCP on ${mcp.url}`);

  const stop = () => {
    for (const s of sessions.values()) s.close();
    term.closeAll();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await conn.run();
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "pair") void pair(rest);
else if (!cmd || cmd === "start") void start();
else {
  console.log(`Usage:\n  ${PAIR} <opal-url> <code> [--name NAME] [--root PATH]\n  ${START}`);
  process.exit(1);
}

export type { Config };
