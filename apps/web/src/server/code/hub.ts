// In-memory hub for Opal Code: connected runners, command replies, browser subscribers and
// "wait until this thread is idle" waiters. One Opal process; kept on globalThis so dev reloads
// don't drop live connections.
import "server-only";
import { nanoid } from "nanoid";
import type { CodeLiveEvent } from "@/lib/code-types";
import { ApiError } from "../http";

type Writer = (data: string) => void;

type RunnerConn = { machineId: string; userId: string; write: Writer; close: () => void; connectedAt: number };

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

type Hub = {
  runners: Map<string, RunnerConn>;
  pending: Map<string, Pending>;
  browsers: Map<string, Set<Writer>>;
  idleWaiters: Map<string, Set<() => void>>;
};

const g = globalThis as unknown as { __opalCodeHub?: Hub };
const hub: Hub = (g.__opalCodeHub ??= { runners: new Map(), pending: new Map(), browsers: new Map(), idleWaiters: new Map() });

export class RunnerOffline extends ApiError {
  constructor() {
    super(409, "offline", "That machine is offline. Start the Opal runner on it.");
  }
}

export function attachRunner(conn: Omit<RunnerConn, "connectedAt">) {
  hub.runners.get(conn.machineId)?.close();
  const c = { ...conn, connectedAt: Date.now() };
  hub.runners.set(conn.machineId, c);
  return () => {
    if (hub.runners.get(conn.machineId) === c) hub.runners.delete(conn.machineId);
  };
}

export const isOnline = (machineId: string) => hub.runners.has(machineId);

/** Sends a command to a machine's runner and waits for its reply. */
export function command<T = unknown>(machineId: string, cmd: string, args: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
  const r = hub.runners.get(machineId);
  if (!r) return Promise.reject(new RunnerOffline());
  const id = nanoid();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      hub.pending.delete(id);
      reject(new ApiError(504, "timeout", "The machine didn't answer in time. Is the runner still running?"));
    }, timeoutMs);
    hub.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    r.write(JSON.stringify({ id, cmd, args }));
  });
}

/** Fire-and-forget command (no reply expected). */
export function send(machineId: string, cmd: string, args: Record<string, unknown> = {}) {
  const r = hub.runners.get(machineId);
  if (!r) throw new RunnerOffline();
  r.write(JSON.stringify({ id: null, cmd, args }));
}

export function resolveReply(id: string, ok: boolean, result: unknown, error?: string) {
  const p = hub.pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  hub.pending.delete(id);
  if (ok) p.resolve(result);
  // The runner's own message (git said…, folder missing…) is what the user needs to see.
  else p.reject(new ApiError(502, "runner_error", (error || "The machine couldn't do that").slice(0, 600)));
}

export function subscribe(userId: string, write: Writer) {
  let set = hub.browsers.get(userId);
  if (!set) hub.browsers.set(userId, (set = new Set()));
  set.add(write);
  return () => {
    set.delete(write);
    if (!set.size) hub.browsers.delete(userId);
  };
}

export function publish(userId: string, event: CodeLiveEvent) {
  const set = hub.browsers.get(userId);
  if (!set) return;
  const data = JSON.stringify(event);
  for (const w of set) {
    try {
      w(data);
    } catch {
      set.delete(w);
    }
  }
}

export function onIdle(threadId: string, fn: () => void) {
  let set = hub.idleWaiters.get(threadId);
  if (!set) hub.idleWaiters.set(threadId, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

export function notifyIdle(threadId: string) {
  const set = hub.idleWaiters.get(threadId);
  if (!set) return;
  hub.idleWaiters.delete(threadId);
  for (const fn of set) fn();
}

/** A text/event-stream Response. `setup` gets a writer and returns a cleanup. */
export function sseResponse(signal: AbortSignal, setup: (write: Writer) => () => void): Response {
  const enc = new TextEncoder();
  let cleanup = () => {};
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write: Writer = (data) => controller.enqueue(enc.encode(`data: ${data}\n\n`));
      write(JSON.stringify({ type: "hello" }));
      cleanup = setup(write);
      ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          clearInterval(ping);
        }
      }, 15_000);
      signal.addEventListener("abort", () => {
        clearInterval(ping);
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(ping);
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
