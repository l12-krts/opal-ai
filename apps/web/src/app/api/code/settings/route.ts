import { z } from "zod";
import { api, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { loadCodeSettings, saveCodeSettings } from "@/server/code/prefs";

export const dynamic = "force-dynamic";

export const GET = api(async ({ user }) => ({ settings: await loadCodeSettings(user.id) }), { limit: LIMITS.read });

export const PATCH = api(
  async ({ req, user }) => {
    const body = await readJson(
      req,
      z.object({
        defaultAgent: z.enum(["claude", "codex"]).optional(),
        defaultMode: z.enum(["auto", "ask", "full"]).optional(),
        worktreeByDefault: z.boolean().optional(),
        settleDays: z.number().int().min(0).max(60).optional(),
      }),
    );
    return { settings: await saveCodeSettings(user.id, body) };
  },
  { limit: LIMITS.write },
);
