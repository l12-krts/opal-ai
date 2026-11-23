import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { conversation } from "@/server/db/schema";
import { api } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";

export const GET = api(
  async ({ user }) => {
    const rows = await db
      .select({
        id: conversation.id,
        title: conversation.title,
        mode: conversation.mode,
        agentId: conversation.agentId,
        pinned: conversation.pinned,
        updatedAt: conversation.updatedAt,
      })
      .from(conversation)
      .where(and(eq(conversation.userId, user.id), isNull(conversation.agentId)))
      .orderBy(desc(conversation.updatedAt))
      .limit(200);
    return { conversations: rows };
  },
  { limit: LIMITS.read },
);
