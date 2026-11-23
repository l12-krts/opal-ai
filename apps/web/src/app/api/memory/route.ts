import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/server/db";
import { memory } from "@/server/db/schema";
import { api, ApiError, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { MEMORY_LIMITS } from "@/server/ai/personal";

export const GET = api(
  async ({ user }) => {
    const rows = await db
      .select({ id: memory.id, content: memory.content, source: memory.source, createdAt: memory.createdAt })
      .from(memory)
      .where(eq(memory.userId, user.id))
      .orderBy(desc(memory.createdAt));
    return { memories: rows };
  },
  { limit: LIMITS.read },
);

export const POST = api(
  async ({ req, user }) => {
    const { content } = await readJson(req, z.object({ content: z.string().trim().min(2).max(MEMORY_LIMITS.chars) }), 4096);
    const count = await db.$count(memory, eq(memory.userId, user.id));
    if (count >= MEMORY_LIMITS.perUser) throw new ApiError(400, "limit", `You can keep up to ${MEMORY_LIMITS.perUser} memories`);
    const [dupe] = await db
      .select({ id: memory.id })
      .from(memory)
      .where(and(eq(memory.userId, user.id), sql`lower(${memory.content}) = lower(${content})`))
      .limit(1);
    if (dupe) throw new ApiError(409, "duplicate", "Opal already remembers that");
    const [row] = await db.insert(memory).values({ id: nanoid(10), userId: user.id, content, source: "user" }).returning();
    return { memory: row };
  },
  { limit: LIMITS.write },
);

/** Forget everything. */
export const DELETE = api(
  async ({ user }) => {
    await db.delete(memory).where(eq(memory.userId, user.id));
    return { ok: true };
  },
  { limit: LIMITS.write },
);
