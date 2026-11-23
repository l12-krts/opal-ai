import { api, idSchema } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { command } from "@/server/code/hub";
import { getThread, setStatus } from "@/server/code/store";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(
  async ({ user, params }) => {
    const t = await getThread(user.id, idSchema.parse(params.id));
    await command(t.machineId, "turn.interrupt", { threadId: t.id }, 15_000).catch(async () => {
      // Runner gone or no session: just mark it stopped.
      await setStatus(t.id, "idle");
    });
    return { ok: true };
  },
  { limit: LIMITS.write },
);
