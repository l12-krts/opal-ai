import type { UIMessageStreamWriter } from "ai";
import type { ChatMode, OpalUIMessage } from "@/lib/types";
import type { AgentBus } from "./bus";

export type AgentSelf = { agentId: string; name: string; color: string; shape?: string; runId: string; threadId?: string };

/** Everything a tool needs to know about the turn it runs in. */
export type RunContext = {
  userId: string;
  userName: string;
  /** The chat this turn belongs to (Opal's chat, or the agent thread the user is talking in). */
  conversationId: string;
  writer: UIMessageStreamWriter<OpalUIMessage>;
  signal: AbortSignal;
  nerd: boolean;
  mode: ChatMode;
  modelId: string;
  /** 0 = whoever the user is talking to, 1 = an agent it messaged, 2 = an agent that one messaged. */
  depth: number;
  /** The agent this context belongs to; undefined for Opal. */
  self?: AgentSelf;
  /** Agents up the call chain, waiting on this one. They can't be messaged (they'd deadlock). */
  chain: string[];
  /** The agent whose sandbox tools use, defaults to self or a per-user "opal" sandbox. */
  sandboxAgentId: string;
  sandboxAgentName: string;
  sandboxColor: string;
  bus: AgentBus;
  /** Secret values resolved during this turn; scrubbed from anything returned to a model. */
  secretValues: string[];
};

export const MAX_AGENT_DEPTH = 2;
