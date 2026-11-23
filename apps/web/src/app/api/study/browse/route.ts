import { z } from "zod";
import { api, ApiError } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { STUDY_SOURCES } from "@/server/study/registry";

export const GET = api(
  async ({ req, user }) => {
    const source = z.enum(["ebooks", "eclass"]).parse(req.nextUrl.searchParams.get("source"));
    const ref = req.nextUrl.searchParams.get("ref")?.slice(0, 300) ?? undefined;
    try {
      return { items: (await STUDY_SOURCES[source].browse?.(user.id, ref)) ?? [] };
    } catch (err) {
      throw new ApiError(502, "source_error", (err as Error).message.slice(0, 200));
    }
  },
  { limit: LIMITS.read },
);
