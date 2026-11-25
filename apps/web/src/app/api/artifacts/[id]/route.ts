import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { artifact } from "@/server/db/schema";
import { api, ApiError, idSchema } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";

export const GET = api<{ id: string }>(
  async ({ user, params }) => {
    const id = idSchema.parse(params.id);
    const [a] = await db
      .select({
        id: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        data: artifact.data,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
        conversationId: artifact.conversationId,
      })
      .from(artifact)
      .where(and(eq(artifact.id, id), eq(artifact.userId, user.id)))
      .limit(1);
    if (!a) throw new ApiError(404, "not_found", "Not found");
    return { artifact: a };
  },
  { limit: LIMITS.read },
);

/** Deletes a saved artifact (a document from the Documents page). Chats that showed it keep their copy. */
export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    const id = idSchema.parse(params.id);
    const gone = await db
      .delete(artifact)
      .where(and(eq(artifact.id, id), eq(artifact.userId, user.id)))
      .returning({ id: artifact.id });
    if (!gone.length) throw new ApiError(404, "not_found", "Not found");
    return { ok: true };
  },
  { limit: LIMITS.write },
);
