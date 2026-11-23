// File search for @mentions, in a thread's folder or a project's folder on its machine.
import { z } from "zod";
import { ApiError, api, idSchema } from "@/server/http";
import { command } from "@/server/code/hub";
import { getProject, getThread } from "@/server/code/store";

export const dynamic = "force-dynamic";

export const GET = api(
  async ({ req, user }) => {
    const sp = req.nextUrl.searchParams;
    const q = z.string().max(200).parse(sp.get("q") ?? "");
    let target: { machineId: string; cwd: string };
    if (sp.get("thread")) {
      const t = await getThread(user.id, idSchema.parse(sp.get("thread")));
      target = { machineId: t.machineId, cwd: t.cwd };
    } else if (sp.get("project")) {
      const p = await getProject(user.id, idSchema.parse(sp.get("project")));
      target = { machineId: p.machineId, cwd: p.path };
    } else throw new ApiError(400, "bad_request", "thread or project is required");
    return command<{ files: string[]; total: number }>(target.machineId, "fs.search", { cwd: target.cwd, q, limit: 30 }, 20_000);
  },
  { limit: { max: 600, windowMs: 60_000 } },
);
