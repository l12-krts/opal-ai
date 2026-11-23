// Agent threads. Every agent has exactly one conversation (its thread). Messages from the user
// and from other agents all land there, so an agent remembers everything it has been told.
import { and, asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { OpalMetadata, OpalUIMessage } from "@/lib/types";
import { db } from "../db";
import { agent as agentTable, conversation, message } from "../db/schema";
import { removeSandbox } from "../sandbox/docker";

/** The agent's thread id, created on first use. */
export async function agentThread(userId: string, a: { id: string; name: string }): Promise<string> {
  const find = async () =>
    (
      await db
        .select({ id: conversation.id })
        .from(conversation)
        .where(and(eq(conversation.agentId, a.id), eq(conversation.userId, userId)))
        .limit(1)
    )[0]?.id;
  const existing = await find();
  if (existing) return existing;
  // Two runs can race to create it; the unique index on agent_id keeps exactly one.
  await db.insert(conversation).values({ id: nanoid(), userId, agentId: a.id, title: a.name }).onConflictDoNothing();
  const id = await find();
  if (!id) throw new Error("Couldn't create the agent's thread");
  return id;
}

/** The newest `limit` messages of a conversation, oldest first. */
export async function loadMessages(conversationId: string, limit = 60): Promise<OpalUIMessage[]> {
  const rows = await db
    .select()
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(desc(message.createdAt))
    .limit(limit);
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    parts: r.parts as OpalUIMessage["parts"],
    metadata: (r.metadata ?? {}) as OpalMetadata,
  }));
}

export async function loadAllMessages(conversationId: string): Promise<OpalUIMessage[]> {
  const rows = await db.select().from(message).where(eq(message.conversationId, conversationId)).orderBy(asc(message.createdAt));
  return rows.map((r) => ({ id: r.id, role: r.role, parts: r.parts as OpalUIMessage["parts"], metadata: (r.metadata ?? {}) as OpalMetadata }));
}

export async function saveMessage(conversationId: string, m: OpalUIMessage) {
  await db
    .insert(message)
    .values({ id: m.id, conversationId, role: m.role, parts: m.parts, metadata: (m.metadata ?? {}) as Record<string, unknown> })
    .onConflictDoUpdate({ target: message.id, set: { parts: m.parts, metadata: (m.metadata ?? {}) as Record<string, unknown> } });
}

export async function touchConversation(conversationId: string) {
  await db.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, conversationId));
}

/**
 * For the model: messages an agent received from Opal or another agent are marked with who
 * sent them, so it can tell them apart from the user's own messages.
 */
export function labelInbound(messages: OpalUIMessage[]): OpalUIMessage[] {
  return messages.map((m) => {
    const from = m.role === "user" ? m.metadata?.from : undefined;
    if (!from) return m;
    let labelled = false;
    const parts = m.parts.map((p) => {
      if (p.type !== "text" || labelled) return p;
      labelled = true;
      return { ...p, text: `[Message from ${from.name}${from.kind === "opal" ? " (the assistant the user talks to)" : ", an agent"}]\n${p.text}` };
    });
    return { ...m, parts };
  });
}

/** Deletes an agent with its thread, its computer, and the helpers created inside its thread. */
export async function deleteAgentDeep(userId: string, agentId: string): Promise<boolean> {
  const [thread] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.agentId, agentId), eq(conversation.userId, userId)))
    .limit(1);
  if (thread) await deleteScopedHelpers(userId, thread.id);
  const [row] = await db
    .delete(agentTable)
    .where(and(eq(agentTable.id, agentId), eq(agentTable.userId, userId)))
    .returning({ id: agentTable.id });
  if (row) void removeSandbox(agentId).catch(() => {});
  return Boolean(row);
}

/** Deletes a chat and the temporary helpers it created (their threads go with them). */
export async function deleteConversationDeep(userId: string, conversationId: string) {
  await deleteScopedHelpers(userId, conversationId);
  await db.delete(conversation).where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId)));
}

async function deleteScopedHelpers(userId: string, conversationId: string) {
  const helpers = await db
    .delete(agentTable)
    .where(and(eq(agentTable.userId, userId), eq(agentTable.conversationId, conversationId), eq(agentTable.ephemeral, true)))
    .returning({ id: agentTable.id });
  for (const h of helpers) void removeSandbox(h.id).catch(() => {});
}
