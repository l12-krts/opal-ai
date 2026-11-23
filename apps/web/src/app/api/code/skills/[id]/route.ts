import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { codeSkill } from "@/server/db/schema";
import { api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { SkillFields, assertFreeName, ownSkill, skillView } from "@/server/code/prefs";

export const dynamic = "force-dynamic";

export const PATCH = api<{ id: string }>(
  async ({ req, user, params }) => {
    const s = await ownSkill(user.id, idSchema.parse(params.id));
    const body = await readJson(req, z.object(SkillFields).partial(), 64 * 1024);
    if (body.name) await assertFreeName(user.id, body.name, s.id);
    const [next] = await db.update(codeSkill).set({ ...body, updatedAt: new Date() }).where(eq(codeSkill.id, s.id)).returning();
    return { skill: skillView(next) };
  },
  { limit: LIMITS.write },
);

export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    const s = await ownSkill(user.id, idSchema.parse(params.id));
    await db.delete(codeSkill).where(eq(codeSkill.id, s.id));
    return { ok: true };
  },
  { limit: LIMITS.write },
);
