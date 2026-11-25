// Serve an attachment to its owner, or delete one that was never sent.
import { api, ApiError, idSchema } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { deleteUnsentAttachment, readAttachment } from "@/server/attachments";

// Images agents share aren't re-encoded, so GIF and WebP can show too.
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export const GET = api<{ id: string }>(
  async ({ user, params }) => {
    const row = await readAttachment(user.id, idSchema.parse(params.id));
    if (!row) throw new ApiError(404, "not_found", "File not found");
    const inline = INLINE.has(row.mediaType);
    const encoded = encodeURIComponent(row.name);
    return new Response(new Uint8Array(row.data), {
      headers: {
        // Only re-encoded images render in the browser; everything else downloads.
        "Content-Type": inline ? row.mediaType : row.kind === "pdf" ? "application/pdf" : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  },
  { limit: LIMITS.read, limitKey: "attach-read" },
);

export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    await deleteUnsentAttachment(user.id, idSchema.parse(params.id));
    return { ok: true };
  },
  { limit: LIMITS.write, limitKey: "attach-del" },
);
