import { api, ApiError } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { PAGE_COUNT, templateSvg } from "@/lib/handwriting/template";

export const GET = api(
  async ({ req }) => {
    const page = Number(req.nextUrl.searchParams.get("page") ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > PAGE_COUNT) throw new ApiError(400, "bad_page", "Unknown page");
    return new Response(templateSvg(page), {
      headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
    });
  },
  { limit: LIMITS.read },
);
