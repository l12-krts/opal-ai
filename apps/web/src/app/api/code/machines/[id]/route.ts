import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { codeMachine } from "@/server/db/schema";
import { api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { publish, send } from "@/server/code/hub";
import { getMachine, machineView } from "@/server/code/store";

export const dynamic = "force-dynamic";

export const PATCH = api<{ id: string }>(
  async ({ req, user, params }) => {
    const m = await getMachine(user.id, idSchema.parse(params.id));
    const body = await readJson(req, z.object({ name: z.string().trim().min(1).max(60).optional(), projectsRoot: z.string().trim().min(1).max(500).optional() }));
    const [next] = await db.update(codeMachine).set(body).where(eq(codeMachine.id, m.id)).returning();
    publish(user.id, { type: "machine", machine: machineView(next) });
    try {
      send(m.id, "config", { name: next.name, projectsRoot: next.projectsRoot });
    } catch {}
    return { machine: machineView(next) };
  },
  { limit: LIMITS.write },
);

/** Forgets the machine and revokes its token. Its folders are left alone. */
export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    const m = await getMachine(user.id, idSchema.parse(params.id));
    try {
      send(m.id, "revoked", {});
    } catch {}
    await db.delete(codeMachine).where(eq(codeMachine.id, m.id));
    return { ok: true };
  },
  { limit: LIMITS.write },
);
