import { z } from "zod";
import { api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { command } from "@/server/code/hub";
import { getThread } from "@/server/code/store";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(
  async ({ req, user, params }) => {
    const t = await getThread(user.id, idSchema.parse(params.id));
    const body = await readJson(req, z.object({ requestId: z.string().max(200), decision: z.enum(["allow", "allow_session", "deny"]) }));
    await command(t.machineId, "approval.respond", { threadId: t.id, ...body }, 15_000);
    return { ok: true };
  },
  { limit: LIMITS.write },
);
