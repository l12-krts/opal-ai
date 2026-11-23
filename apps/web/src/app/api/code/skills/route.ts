// Opal Code skills (separate from Opal chat skills). Used with "/Skill name" in the Code composer.
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/server/db";
import { codeSkill } from "@/server/db/schema";
import { ApiError, api, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { SkillFields, assertFreeName, listCodeSkills, skillView } from "@/server/code/prefs";

export const dynamic = "force-dynamic";

export const GET = api(async ({ user }) => ({ skills: (await listCodeSkills(user.id)).map(skillView) }), { limit: LIMITS.read });

export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(req, z.object({ ...SkillFields, description: SkillFields.description.default(""), enabled: SkillFields.enabled.default(true) }), 64 * 1024);
    const count = (await listCodeSkills(user.id)).length;
    if (count >= 50) throw new ApiError(400, "limit", "You can have up to 50 Code skills");
    await assertFreeName(user.id, body.name);
    const [s] = await db.insert(codeSkill).values({ id: nanoid(), userId: user.id, ...body }).returning();
    return { skill: skillView(s) };
  },
  { limit: LIMITS.write },
);
