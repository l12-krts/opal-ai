// Opens an agent's sign-in (`claude auth login`, `codex login`) in a terminal on the machine.
// Its output arrives over /api/code/events like any terminal; input goes to /api/code/terminals/:id.
import { nanoid } from "nanoid";
import { z } from "zod";
import { ApiError, api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { command, isOnline } from "@/server/code/hub";
import { getMachine } from "@/server/code/store";
import { terminals } from "@/server/code/terminals";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(
  async ({ req, user, params }) => {
    const m = await getMachine(user.id, idSchema.parse(params.id));
    const body = await readJson(
      req,
      z.object({ agent: z.enum(["claude", "codex"]), cols: z.number().int().min(10).max(500), rows: z.number().int().min(4).max(200) }),
    );
    if (!isOnline(m.id)) throw new ApiError(409, "offline", `${m.name} is offline. Start the runner there first.`);
    const termId = nanoid();
    terminals.set(termId, { userId: user.id, machineId: m.id });
    try {
      await command(m.id, "agent.login", { termId, agent: body.agent, cols: body.cols, rows: body.rows }, 20_000);
    } catch (e) {
      terminals.delete(termId);
      throw new ApiError(502, "runner_error", (e as Error).message);
    }
    return { termId };
  },
  { limit: LIMITS.write },
);
