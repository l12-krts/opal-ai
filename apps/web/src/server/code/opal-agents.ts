// Lets a coding thread talk to one of the user's Opal agents (the ones with their own computers).
// The agent runs a normal turn in its own thread, without a browser watching, and its reply goes
// back to the coding agent. The agent can answer back through its Opal Code tools.
import "server-only";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "../db";
import { agent as agentTable, user as userTable } from "../db/schema";
import { mainModelId } from "../ai/models";
import { runAgent } from "../ai/agents";
import { AgentBus } from "../ai/bus";
import type { RunContext } from "../ai/context";
import type { CodeThread } from "../db/schema";

export async function findOpalAgent(userId: string, nameOrId: string) {
  const byId = await db.select().from(agentTable).where(and(eq(agentTable.userId, userId), eq(agentTable.id, nameOrId))).limit(1);
  if (byId[0]) return byId[0];
  const byName = await db
    .select()
    .from(agentTable)
    .where(and(eq(agentTable.userId, userId), ilike(agentTable.name, nameOrId.replace(/[%_\\]/g, "\\$&"))))
    .limit(1);
  return byName[0] ?? null;
}

export async function askOpalAgent(from: CodeThread, nameOrId: string, text: string): Promise<string> {
  const target = await findOpalAgent(from.userId, nameOrId);
  if (!target) throw new Error(`There's no Opal agent called "${nameOrId}".`);
  const [u] = await db.select({ name: userTable.name }).from(userTable).where(eq(userTable.id, from.userId)).limit(1);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10 * 60_000);
  // Nobody is watching this turn live, so stream parts go nowhere; the run is still saved in
  // the agent's thread like any other.
  const writer = { write() {}, merge() {}, onError: undefined } as unknown as RunContext["writer"];
  const ctx: RunContext = {
    userId: from.userId,
    userName: u?.name ?? "the user",
    conversationId: `code:${from.id}`,
    writer,
    signal: ctl.signal,
    nerd: false,
    mode: "chat",
    modelId: mainModelId(),
    depth: 1,
    chain: [],
    sandboxAgentId: target.id,
    sandboxAgentName: target.name,
    sandboxColor: target.color,
    bus: new AgentBus(),
    secretValues: [],
  };
  try {
    const r = await runAgent(ctx, target, `[From the Opal Code thread "${from.title}" (thread id ${from.id}). You can follow it with code_read and reply into it with code_message.]\n\n${text}`);
    if (r.status === "error") throw new Error(r.text || `${target.name} couldn't finish.`);
    return r.text || `${target.name} finished without a reply.`;
  } finally {
    clearTimeout(timer);
  }
}
