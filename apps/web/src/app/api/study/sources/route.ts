import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/server/db";
import { studySource } from "@/server/db/schema";
import { api, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { assertPublicUrl } from "@/server/net";

export const GET = api(
  async ({ user }) => {
    const rows = await db.select().from(studySource).where(eq(studySource.userId, user.id));
    return { sources: rows.map(({ userId: _u, ...r }) => r) };
  },
  { limit: LIMITS.read },
);

export const PUT = api(
  async ({ req, user }) => {
    const body = await readJson(
      req,
      z.object({
        kind: z.literal("eclass"),
        baseUrl: z.string().url().max(200),
        username: z.string().trim().min(1).max(120),
      }),
      4096,
    );
    const url = await assertPublicUrl(body.baseUrl);
    if (url.protocol !== "https:") throw new Error("eClass must use https");
    const baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    const [existing] = await db
      .select({ id: studySource.id })
      .from(studySource)
      .where(and(eq(studySource.userId, user.id), eq(studySource.kind, "eclass")))
      .limit(1);
    const config = { baseUrl, username: body.username, secretName: "ECLASS_PASSWORD" };
    if (existing) await db.update(studySource).set({ config, label: url.hostname }).where(eq(studySource.id, existing.id));
    else await db.insert(studySource).values({ id: nanoid(), userId: user.id, kind: "eclass", label: url.hostname, config });
    return { ok: true };
  },
  { limit: LIMITS.write },
);
