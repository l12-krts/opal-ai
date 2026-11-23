// The runner reports what it found on the machine: installed agents, versions, OS.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { codeMachine } from "@/server/db/schema";
import { readJson } from "@/server/http";
import { publish } from "@/server/code/hub";
import { machineView } from "@/server/code/store";
import { runnerRoute } from "@/server/code/runner-auth";

export const dynamic = "force-dynamic";

export const POST = runnerRoute(async (req, machine) => {
  const body = await readJson(
    req,
    z.object({
      agents: z.array(z.object({ id: z.string().max(40), version: z.string().max(80).nullable(), ok: z.boolean(), note: z.string().max(200).optional(), signedIn: z.boolean().optional() })).max(20),
      runnerVersion: z.string().max(40),
      os: z.string().max(40),
      hostname: z.string().max(120),
      projectsRoot: z.string().max(500).optional(),
    }),
    32 * 1024,
  );
  const [m] = await db
    .update(codeMachine)
    .set({ agents: body.agents, runnerVersion: body.runnerVersion, os: body.os, hostname: body.hostname, lastSeenAt: new Date() })
    .where(eq(codeMachine.id, machine.id))
    .returning();
  publish(m.userId, { type: "machine", machine: machineView(m) });
  return { ok: true, projectsRoot: m.projectsRoot, name: m.name };
});
