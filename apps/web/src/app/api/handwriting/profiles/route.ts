import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/server/db";
import { handwritingProfile } from "@/server/db/schema";
import { api, ApiError, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";

export const GET = api(
  async ({ user }) => {
    const rows = await db
      .select({ id: handwritingProfile.id, name: handwritingProfile.name, glyphCount: handwritingProfile.glyphCount, updatedAt: handwritingProfile.updatedAt })
      .from(handwritingProfile)
      .where(eq(handwritingProfile.userId, user.id))
      .orderBy(desc(handwritingProfile.updatedAt));
    return { profiles: rows };
  },
  { limit: LIMITS.read },
);

export const POST = api(
  async ({ req, user }) => {
    const { name } = await readJson(req, z.object({ name: z.string().trim().min(1).max(60) }), 1024);
    const count = await db.$count(handwritingProfile, eq(handwritingProfile.userId, user.id));
    if (count >= 10) throw new ApiError(400, "limit", "Up to 10 handwriting profiles");
    const [row] = await db.insert(handwritingProfile).values({ id: nanoid(), userId: user.id, name }).returning();
    return { profile: { id: row.id, name: row.name, glyphCount: 0 } };
  },
  { limit: LIMITS.write },
);
