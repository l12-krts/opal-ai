import type { Decision, ItemData, Mode, RunnerEvent } from "../protocol.js";

export type SessionCtx = {
  threadId: string;
  cwd: string;
  model: string | null;
  mode: Mode;
  instructions: string;
  sessionId: string | null;
  mcp: { url: string; token: string };
  emit: (e: RunnerEvent) => void;
};

export interface AgentSession {
  /** Starts a turn, or queues the message until the current one ends. */
  send(text: string): void;
  interrupt(): Promise<void>;
  respond(requestId: string, decision: Decision): boolean;
  setMode(mode: Mode): void;
  close(): void;
}

export function emitters(ctx: SessionCtx) {
  return {
    item: (id: string, data: ItemData) => ctx.emit({ type: "item", threadId: ctx.threadId, id, data }),
    status: (status: "idle" | "working" | "waiting" | "error") => ctx.emit({ type: "status", threadId: ctx.threadId, status }),
    session: (sessionId: string) => ctx.emit({ type: "session", threadId: ctx.threadId, sessionId }),
  };
}

/** A very small line diff for edit previews (old block → new block). */
export function blockDiff(oldText: string, newText: string, max = 400): string {
  const minus = oldText ? oldText.split("\n").map((l) => `-${l}`) : [];
  const plus = newText ? newText.split("\n").map((l) => `+${l}`) : [];
  const lines = [...minus, ...plus];
  return lines.length > max ? `${lines.slice(0, max).join("\n")}\n… ${lines.length - max} more lines` : lines.join("\n");
}

export const clip = (s: string, n = 20_000) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s);
