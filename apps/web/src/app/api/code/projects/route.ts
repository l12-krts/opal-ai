// Create a project: a new folder at <projectsRoot>/<name> on the machine, or an existing folder.
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { codeProject } from "@/server/db/schema";
import { ApiError, api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { command } from "@/server/code/hub";
import { getMachine, projectView } from "@/server/code/store";

export const dynamic = "force-dynamic";

export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(
      req,
      z.object({
        machineId: idSchema,
        name: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[\w.-][\w .-]*$/, "Use letters, numbers, spaces, dots, dashes or underscores"),
        existingPath: z.string().trim().max(500).optional(),
        git: z.boolean().default(true),
      }),
    );
    const m = await getMachine(user.id, body.machineId);
    const r = body.existingPath
      ? await command<{ path: string; isGit: boolean }>(m.id, "project.check", { path: body.existingPath })
      : await command<{ path: string; isGit: boolean }>(m.id, "project.create", { name: body.name, git: body.git });
    try {
      const [p] = await db.insert(codeProject).values({ id: nanoid(), userId: user.id, machineId: m.id, name: body.name, path: r.path, isGit: r.isGit }).returning();
      return { project: projectView(p) };
    } catch {
      throw new ApiError(409, "exists", "That folder is already a project");
    }
  },
  { limit: LIMITS.write },
);
