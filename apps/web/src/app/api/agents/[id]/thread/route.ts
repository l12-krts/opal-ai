// An agent's one thread: created on first open.
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { agent } from "@/server/db/schema";
import { api, ApiError, idSchema } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { agentThread } from "@/server/ai/threads";

export const GET = api<{ id: string }>(
  async ({ user, params }) => {
    const id = idSchema.parse(params.id);
    const [a] = await db
      .select()
      .from(agent)
      .where(and(eq(agent.id, id), eq(agent.userId, user.id)))
      .limit(1);
    if (!a) throw new ApiError(404, "not_found", "Agent not found");
    const threadId = await agentThread(user.id, a);
    return {
      threadId,
      agent: { id: a.id, name: a.name, color: a.color, shape: a.shape, ephemeral: a.ephemeral },
    };
  },
  { limit: LIMITS.read },
);

export const dynamic = "force-dynamic";
