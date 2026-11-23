import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { handwritingGlyph, handwritingProfile } from "@/server/db/schema";
import { api, ApiError, idSchema } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";

async function own(userId: string, raw: string) {
  const id = idSchema.parse(raw);
  const [p] = await db
    .select()
    .from(handwritingProfile)
    .where(and(eq(handwritingProfile.id, id), eq(handwritingProfile.userId, userId)))
    .limit(1);
  if (!p) throw new ApiError(404, "not_found", "Profile not found");
  return p;
}

/** Glyph atlas for the renderer. */
export const GET = api<{ id: string }>(
  async ({ user, params }) => {
    const p = await own(user.id, params.id);
    const rows = await db
      .select()
      .from(handwritingGlyph)
      .where(eq(handwritingGlyph.profileId, p.id))
      .orderBy(asc(handwritingGlyph.char), asc(handwritingGlyph.variant));
    return {
      profile: { id: p.id, name: p.name, settings: p.settings },
      glyphs: rows.map((g) => ({
        char: g.char,
        variant: g.variant,
        width: g.width,
        height: g.height,
        baseline: g.baseline,
        advance: g.advance,
        png: `data:image/png;base64,${Buffer.from(g.png).toString("base64")}`,
      })),
    };
  },
  { limit: LIMITS.read },
);

export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    const p = await own(user.id, params.id);
    await db.delete(handwritingProfile).where(and(eq(handwritingProfile.id, p.id), eq(handwritingProfile.userId, user.id)));
    return { ok: true };
  },
  { limit: LIMITS.write },
);
