// Open a terminal in a thread's folder on its machine. Output arrives over /api/code/events.
import { nanoid } from "nanoid";
import { z } from "zod";
import { api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { command } from "@/server/code/hub";
import { getThread } from "@/server/code/store";
import { terminals } from "@/server/code/terminals";

export const dynamic = "force-dynamic";

export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(req, z.object({ threadId: idSchema, cols: z.number().int().min(10).max(500), rows: z.number().int().min(4).max(200) }));
    const t = await getThread(user.id, body.threadId);
    const termId = nanoid();
    terminals.set(termId, { userId: user.id, machineId: t.machineId });
    await command(t.machineId, "terminal.open", { termId, cwd: t.cwd, cols: body.cols, rows: body.rows }, 20_000);
    return { termId };
  },
  { limit: LIMITS.write },
);
