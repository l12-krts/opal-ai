import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { skill } from "@/server/db/schema";
import { api, ApiError, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { assertFreeName, SkillPatch } from "../route";

export const PATCH = api<{ id: string }>(
  async ({ req, user, params }) => {
    const id = idSchema.parse(params.id);
    const body = await readJson(req, SkillPatch, 32 * 1024);
    if (body.name) await assertFreeName(user.id, body.name, id);
    const [row] = await db
      .update(skill)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(skill.id, id), eq(skill.userId, user.id)))
      .returning();
    if (!row) throw new ApiError(404, "not_found", "Skill not found");
    return { skill: row };
  },
  { limit: LIMITS.write },
);

export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    const id = idSchema.parse(params.id);
    await db.delete(skill).where(and(eq(skill.id, id), eq(skill.userId, user.id)));
    return { ok: true };
  },
  { limit: LIMITS.write },
);
