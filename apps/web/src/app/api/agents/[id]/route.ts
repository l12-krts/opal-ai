import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/server/db";
import { agent, conversation } from "@/server/db/schema";
import { api, ApiError, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { deleteAgentDeep } from "@/server/ai/threads";
import { AgentInput } from "../route";

export const PATCH = api<{ id: string }>(
  async ({ req, user, params }) => {
    const id = idSchema.parse(params.id);
    const body = await readJson(req, AgentInput.partial(), 4 * 1024);
    if (body.name) {
      const [dupe] = await db
        .select({ id: agent.id })
        .from(agent)
        .where(and(eq(agent.userId, user.id), isNull(agent.conversationId), eq(agent.name, body.name), ne(agent.id, id)))
        .limit(1);
      if (dupe) throw new ApiError(409, "name_taken", "You already have an agent with that name");
    }
    const [row] = await db
      .update(agent)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(agent.id, id), eq(agent.userId, user.id)))
      .returning();
    if (!row) throw new ApiError(404, "not_found", "Agent not found");
    if (body.name) await db.update(conversation).set({ title: body.name }).where(and(eq(conversation.agentId, id), eq(conversation.userId, user.id)));
    return { agent: row };
  },
  { limit: LIMITS.write },
);

export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    const id = idSchema.parse(params.id);
    if (!(await deleteAgentDeep(user.id, id))) throw new ApiError(404, "not_found", "Agent not found");
    return { ok: true };
  },
  { limit: LIMITS.write },
);
