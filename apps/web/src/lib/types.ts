// Types shared by the server stream and the client renderer.
import type { UIMessage } from "ai";

export type Route = "direct" | "agents";

export type AgentStep =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; tool: string; label: string; status: "running" | "done" | "error"; detail?: string; input?: unknown; output?: unknown }
  | { kind: "message"; to: string; text: string }
  | { kind: "text"; text: string };

/** Who sent a message to an agent. `key` identifies the conversation partner: "opal:<chatId>" or "agent:<agentId>". */
export type AgentSender = {
  key: string;
  kind: "opal" | "agent";
  name: string;
  color?: string;
  shape?: string;
  agentId?: string;
};

/** Live state of one agent run (one message to an agent and its reply). Keyed by runId. */
export type AgentRunView = {
  runId: string;
  toolCallId?: string;
  agentId: string;
  threadId?: string;
  name: string;
  color: string;
  shape?: string;
  ephemeral: boolean;
  from?: AgentSender;
  task: string;
  status: "running" | "done" | "error";
  /** Label of the step it is on now. */
  current?: string;
  toolCount?: number;
  result?: string;
  startedAt: number;
  finishedAt?: number;
  parentRunId?: string;
  /** Legacy (before agent threads): a run's step log. */
  steps?: AgentStep[];
};

/** A batch of UI stream chunks from an agent's run, relayed live to the client. */
export type AgentChunks = { runId: string; chunks: unknown[] };

export type AgentMessageView = {
  from: { name: string; color: string };
  to: { name: string; color: string };
  text: string;
  at: number;
};

export type SandboxFrame = {
  agentId: string;
  agentName: string;
  color: string;
  shape?: string;
  url?: string;
  title?: string;
  screenshot?: string; // data URL
  terminal?: { command: string; output: string; exitCode: number };
  at: number;
};

export type OpalDataParts = {
  /** `auto`: why Opal Auto picked this model (only when Auto was on). */
  route: { route: Route; reason: string; ms: number; model: string; auto?: string };
  agent: AgentRunView;
  "agent-chunks": AgentChunks;
  "agent-msg": AgentMessageView;
  sandbox: SandboxFrame;
  title: { title: string };
};

export type OpalMetadata = {
  model?: string;
  route?: Route;
  startedAt?: number;
  finishedAt?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  /** On a message an agent received from Opal or another agent. */
  from?: AgentSender;
  /** On an agent's reply to such a message. */
  run?: { runId: string; fromKey: string };
};

export type OpalUIMessage = UIMessage<OpalMetadata, OpalDataParts>;

export type ChatMode = "chat" | "study";

export const AGENT_COLORS = [
  { id: "slate", value: "#64748b" },
  { id: "blue", value: "#3b82f6" },
  { id: "teal", value: "#14b8a6" },
  { id: "green", value: "#22a35a" },
  { id: "amber", value: "#d99a1e" },
  { id: "orange", value: "#ea6a2a" },
  { id: "rose", value: "#e2496b" },
  { id: "violet", value: "#8b5cf6" },
] as const;

export const AGENT_CHARACTERS = {
  balanced: { label: "Balanced", prompt: "Clear, friendly and to the point." },
  concise: { label: "Concise", prompt: "Extremely brief. Bullet points, no filler, no pleasantries." },
  thorough: { label: "Thorough", prompt: "Careful and complete. Double-check facts and show your reasoning briefly." },
  friendly: { label: "Friendly", prompt: "Warm, encouraging and patient. Plain words." },
  formal: { label: "Formal", prompt: "Professional and precise, like a consultant writing to a client." },
  skeptic: { label: "Skeptic", prompt: "Questions assumptions, looks for holes, points out risks before agreeing." },
  playful: { label: "Playful", prompt: "Light, witty and a little cheeky, but still useful." },
  teacher: { label: "Teacher", prompt: "Explains step by step with examples and checks understanding." },
} as const;

export type CharacterId = keyof typeof AGENT_CHARACTERS;

export const CAPABILITIES = {
  sandbox: "Computer (browser, terminal, files)",
  connectors: "Connected apps",
  study: "Study tools",
  handwriting: "Handwriting",
  web: "Read web pages",
  ui: "Interactive answers",
} as const;

export type Capability = keyof typeof CAPABILITIES;
