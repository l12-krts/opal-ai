// Shapes shared with the Opal server (apps/web/src/lib/code-types.ts). Keep them in step.

export type AgentId = "claude" | "codex";
export type Mode = "auto" | "ask" | "full";
export type ItemStatus = "running" | "done" | "failed";

export type ItemData =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "command"; command: string; output?: string; exitCode?: number | null; status: ItemStatus }
  | { kind: "edit"; files: { path: string; change: "add" | "update" | "delete"; diff?: string }[]; status: ItemStatus }
  | { kind: "tool"; name: string; server?: string; input?: unknown; output?: string; status: ItemStatus }
  | {
      kind: "approval";
      requestId: string;
      title: string;
      detail?: string;
      command?: string;
      status: "pending" | "approved" | "denied" | "expired";
    }
  | { kind: "error"; text: string }
  | { kind: "notice"; text: string };

export type RunnerEvent =
  | { type: "item"; threadId: string; id: string; data: ItemData }
  | { type: "status"; threadId: string; status: "idle" | "working" | "waiting" | "error" }
  | { type: "session"; threadId: string; sessionId: string }
  | { type: "terminal"; termId: string; data: string }
  | { type: "terminal-exit"; termId: string; code: number | null };

export type Command = { id: string | null; cmd: string; args: Record<string, unknown> };

export type TurnArgs = {
  threadId: string;
  agent: AgentId;
  model: string | null;
  mode: Mode;
  cwd: string;
  text: string;
  sessionId: string | null;
  instructions: string;
};

export type Decision = "allow" | "allow_session" | "deny";
