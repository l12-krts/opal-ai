import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { userSettings } from "@/server/db/schema";
import { api, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { availableModels, isAllowedModel, mainModelId } from "@/server/ai/models";
import { composioEnabled } from "@/server/connectors/composio";
import { dockerAvailable } from "@/server/sandbox/docker";
import { searchServiceReady } from "@/server/ai/tools/web";
import { ACCENT_IDS, DEFAULT_ACCENT, isAccent } from "@/lib/accents";

export const GET = api(
  async ({ user }) => {
    const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
    return {
      user: { id: user.id, name: user.name, email: user.email, image: user.image, role: user.role },
      settings: {
        nerdMode: s?.nerdMode ?? false,
        theme: s?.theme ?? "system",
        model: s?.model ?? null,
        memoryEnabled: s?.memoryEnabled ?? true,
        accent: isAccent(s?.accent) ? s?.accent : DEFAULT_ACCENT,
      },
      models: availableModels(),
      defaultModel: mainModelId(),
      status: {
        connectors: composioEnabled(),
        sandbox: await dockerAvailable(),
        ai: availableModels().length > 0,
        search: await searchServiceReady(),
      },
    };
  },
  { limit: LIMITS.read },
);

export const PATCH = api(
  async ({ req, user }) => {
    const body = await readJson(
      req,
      z.object({
        nerdMode: z.boolean().optional(),
        theme: z.enum(["system", "light", "dark"]).optional(),
        model: z.string().max(120).nullable().optional(),
        memoryEnabled: z.boolean().optional(),
        accent: z.enum(ACCENT_IDS).optional(),
      }),
      2048,
    );
    if (body.model && !isAllowedModel(body.model)) body.model = null;
    await db
      .insert(userSettings)
      .values({ userId: user.id, ...body })
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...body, updatedAt: new Date() } });
    return { ok: true };
  },
  { limit: LIMITS.write },
);
