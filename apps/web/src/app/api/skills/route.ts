import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/server/db";
import { skill } from "@/server/db/schema";
import { api, ApiError, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { SKILL_LIMITS } from "@/server/ai/personal";

const fields = {
  name: z
    .string()
    .trim()
    .min(2)
    .max(SKILL_LIMITS.name)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u, "Letters, numbers, spaces, dots, dashes"),
  description: z.string().trim().max(SKILL_LIMITS.description),
  instructions: z.string().trim().min(10).max(SKILL_LIMITS.instructions),
  enabled: z.boolean(),
};

export const SkillInput = z.object({ ...fields, description: fields.description.default(""), enabled: fields.enabled.default(true) });
/** Edits: only what was sent changes (no defaults). */
export const SkillPatch = z.object(fields).partial();

export async function assertFreeName(userId: string, name: string, exceptId?: string) {
  const rows = await db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.userId, userId), sql`lower(${skill.name}) = lower(${name})`));
  if (rows.some((r) => r.id !== exceptId)) throw new ApiError(409, "name_taken", "You already have a skill with that name");
}

export const GET = api(
  async ({ user }) => {
    const rows = await db.select().from(skill).where(eq(skill.userId, user.id)).orderBy(asc(skill.name));
    return { skills: rows.map(({ userId: _u, ...s }) => s) };
  },
  { limit: LIMITS.read },
);

export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(req, SkillInput, 32 * 1024);
    const count = await db.$count(skill, eq(skill.userId, user.id));
    if (count >= SKILL_LIMITS.perUser) throw new ApiError(400, "limit", `You can have up to ${SKILL_LIMITS.perUser} skills`);
    await assertFreeName(user.id, body.name);
    const [row] = await db.insert(skill).values({ id: nanoid(), userId: user.id, ...body }).returning();
    return { skill: row };
  },
  { limit: LIMITS.write },
);
