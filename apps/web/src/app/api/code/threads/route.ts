// Start threads. Several agents at once: one thread each, sharing a group id, each in its own
// worktree when the project is a Git repository.
import { z } from "zod";
import { nanoid } from "nanoid";
import { api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { createThread, getProject } from "@/server/code/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(
      req,
      z.object({
        projectId: idSchema.nullable().optional(),
        machineId: idSchema.nullable().optional(),
        agents: z
          .array(z.object({ agent: z.enum(["claude", "codex"]), model: z.string().max(60).nullable().optional() }))
          .min(1)
          .max(4),
        mode: z.enum(["auto", "ask", "full"]).default("auto"),
        worktree: z.boolean().default(false),
        baseBranch: z.string().max(200).nullable().optional(),
        text: z.string().trim().min(1).max(100_000),
        mentions: z.array(z.object({ kind: z.enum(["file", "thread", "agent"]), id: z.string().min(1).max(500), label: z.string().min(1).max(200) })).max(30).default([]),
      }),
      512 * 1024,
    );
    const multi = body.agents.length > 1;
    const isGit = body.projectId ? (await getProject(user.id, body.projectId)).isGit : false;
    const groupId = multi ? nanoid() : null;
    const threads = [];
    for (const a of body.agents) {
      const t = await createThread(user.id, {
        projectId: body.projectId,
        machineId: body.machineId,
        agent: a.agent,
        model: a.model ?? null,
        mode: body.mode,
        worktree: multi ? isGit : body.worktree,
        baseBranch: body.baseBranch,
        text: body.text,
        mentions: body.mentions,
        groupId,
      });
      threads.push(t.id);
    }
    return { threads };
  },
  { limit: LIMITS.chat },
);
