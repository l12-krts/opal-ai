import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { memory } from "@/server/db/schema";
import { api, ApiError, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { MEMORY_LIMITS } from "@/server/ai/personal";

const memoryId = z.string().regex(/^[A-Za-z0-9_-]{6,40}$/);

export const PATCH = api<{ id: string }>(
  async ({ req, user, params }) => {
    const id = memoryId.parse(params.id);
    const { content } = await readJson(req, z.object({ content: z.string().trim().min(2).max(MEMORY_LIMITS.chars) }), 4096);
    const [row] = await db
      .update(memory)
      .set({ content, updatedAt: new Date() })
      .where(and(eq(memory.id, id), eq(memory.userId, user.id)))
      .returning();
    if (!row) throw new ApiError(404, "not_found", "Memory not found");
    return { memory: row };
  },
  { limit: LIMITS.write },
);

export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    const id = memoryId.parse(params.id);
    await db.delete(memory).where(and(eq(memory.id, id), eq(memory.userId, user.id)));
    return { ok: true };
  },
  { limit: LIMITS.write },
);
