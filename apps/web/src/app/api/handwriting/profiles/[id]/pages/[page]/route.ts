// Upload a photo/scan of one filled-in template page.
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { db } from "@/server/db";
import { handwritingGlyph, handwritingProfile } from "@/server/db/schema";
import { api, ApiError, idSchema } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { extractPage } from "@/server/handwriting/extract";
import { cells, PAGE_COUNT } from "@/lib/handwriting/template";

const MAX_BYTES = 15 * 1024 * 1024;

export const POST = api<{ id: string; page: string }>(
  async ({ req, user, params }) => {
    const id = idSchema.parse(params.id);
    const page = Number(params.page);
    if (!Number.isInteger(page) || page < 1 || page > PAGE_COUNT) throw new ApiError(400, "bad_page", "Unknown page");
    const [p] = await db
      .select({ id: handwritingProfile.id })
      .from(handwritingProfile)
      .where(and(eq(handwritingProfile.id, id), eq(handwritingProfile.userId, user.id)))
      .limit(1);
    if (!p) throw new ApiError(404, "not_found", "Profile not found");

    if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 4096) throw new ApiError(413, "too_large", "Image is larger than 15 MB");
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof Blob)) throw new ApiError(400, "no_image", "Attach an image");
    if (file.size > MAX_BYTES) throw new ApiError(413, "too_large", "Image is larger than 15 MB");
    const buf = Buffer.from(await file.arrayBuffer());

    // Trust the decoded format, not the declared MIME type.
    const meta = await sharp(buf, { limitInputPixels: 60_000_000 }).metadata().catch(() => null);
    if (!meta || !["jpeg", "png", "webp", "tiff"].includes(meta.format ?? "")) {
      throw new ApiError(415, "bad_format", "Use a JPG, PNG or WebP photo");
    }
    if ((meta.width ?? 0) * (meta.height ?? 0) > 60_000_000) {
      throw new ApiError(413, "too_many_pixels", "This photo's resolution is too high. Take it at a normal camera setting (12–50 MP).");
    }

    const result = await extractPage(buf, page).catch((err) => {
      console.error("[handwriting] extract failed", err);
      throw new ApiError(422, "unreadable", "Couldn't read the sheet in this photo. Retake it from above in good light with all four corner squares visible.");
    });
    const pageChars = [...new Set(cells().filter((c) => c.page === page).map((c) => c.char))];

    await db.transaction(async (tx) => {
      await tx.delete(handwritingGlyph).where(and(eq(handwritingGlyph.profileId, p.id), inArray(handwritingGlyph.char, pageChars)));
      if (result.glyphs.length) {
        await tx.insert(handwritingGlyph).values(
          result.glyphs.map((g) => ({
            id: nanoid(),
            profileId: p.id,
            char: g.char,
            variant: g.variant,
            png: g.png,
            width: g.width,
            height: g.height,
            baseline: g.baseline,
            advance: g.advance,
          })),
        );
      }
      const count = await tx.$count(handwritingGlyph, eq(handwritingGlyph.profileId, p.id));
      await tx.update(handwritingProfile).set({ glyphCount: count, updatedAt: new Date() }).where(eq(handwritingProfile.id, p.id));
    });

    return { found: result.glyphs.length, missing: result.missing, markers: result.markers };
  },
  { limit: LIMITS.upload, limitKey: "hw-upload" },
);
