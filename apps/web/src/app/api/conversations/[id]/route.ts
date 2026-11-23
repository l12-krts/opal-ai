import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { agent, conversation, message } from "@/server/db/schema";
import { api, ApiError, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { deleteConversationDeep } from "@/server/ai/threads";

async function own(userId: string, id: string) {
  const cid = idSchema.parse(id);
  const [c] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, cid), eq(conversation.userId, userId)))
    .limit(1);
  if (!c) throw new ApiError(404, "not_found", "Chat not found");
  return c;
}

export const GET = api<{ id: string }>(
  async ({ user, params }) => {
    const c = await own(user.id, params.id);
    const rows = await db.select().from(message).where(eq(message.conversationId, c.id)).orderBy(asc(message.createdAt));
    const [a] = c.agentId
      ? await db
          .select({ id: agent.id, name: agent.name, color: agent.color, shape: agent.shape, ephemeral: agent.ephemeral })
          .from(agent)
          .where(and(eq(agent.id, c.agentId), eq(agent.userId, user.id)))
          .limit(1)
      : [];
    return {
      conversation: { id: c.id, title: c.title, mode: c.mode, pinned: c.pinned, agent: a ?? null },
      messages: rows.map((r) => ({ id: r.id, role: r.role, parts: r.parts, metadata: r.metadata ?? {} })),
    };
  },
  { limit: LIMITS.read },
);

export const PATCH = api<{ id: string }>(
  async ({ req, user, params }) => {
    const c = await own(user.id, params.id);
    const body = await readJson(
      req,
      z.object({ title: z.string().trim().min(1).max(120).optional(), pinned: z.boolean().optional(), mode: z.enum(["chat", "study"]).optional() }),
      4096,
    );
    await db
      .update(conversation)
      .set({ ...body })
      .where(and(eq(conversation.id, c.id), eq(conversation.userId, user.id)));
    return { ok: true };
  },
  { limit: LIMITS.write },
);

export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    const c = await own(user.id, params.id);
    await deleteConversationDeep(user.id, c.id);
    return { ok: true };
  },
  { limit: LIMITS.write },
);
