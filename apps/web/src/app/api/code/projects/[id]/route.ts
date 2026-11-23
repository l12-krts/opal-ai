import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { codeProject } from "@/server/db/schema";
import { api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { getProject, projectView } from "@/server/code/store";

export const dynamic = "force-dynamic";

export const PATCH = api<{ id: string }>(
  async ({ req, user, params }) => {
    const p = await getProject(user.id, idSchema.parse(params.id));
    const body = await readJson(req, z.object({ name: z.string().trim().min(1).max(60) }));
    const [next] = await db.update(codeProject).set(body).where(eq(codeProject.id, p.id)).returning();
    return { project: projectView(next) };
  },
  { limit: LIMITS.write },
);

/** Removes the project from Opal. The folder stays on the machine. */
export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    const p = await getProject(user.id, idSchema.parse(params.id));
    await db.delete(codeProject).where(eq(codeProject.id, p.id));
    return { ok: true };
  },
  { limit: LIMITS.write },
);
