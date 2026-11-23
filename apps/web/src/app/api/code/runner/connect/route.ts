// The runner's command stream. Opal pushes commands down this SSE connection; the runner answers
// with POST /api/code/runner/reply.
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { codeMachine } from "@/server/db/schema";
import { attachRunner, sseResponse } from "@/server/code/hub";
import { machineView } from "@/server/code/store";
import { publish } from "@/server/code/hub";
import { runnerRoute } from "@/server/code/runner-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 86400;

export const GET = runnerRoute(async (req: NextRequest, machine) => {
  let detach = () => {};
  const res = sseResponse(req.signal, (write) => {
    detach = attachRunner({
      machineId: machine.id,
      userId: machine.userId,
      write,
      close: () => {
        try {
          write(JSON.stringify({ id: null, cmd: "replaced", args: {} }));
        } catch {}
      },
    });
    void db.update(codeMachine).set({ lastSeenAt: new Date() }).where(eq(codeMachine.id, machine.id)).returning().then(([m]) => m && publish(m.userId, { type: "machine", machine: machineView(m) }));
    return () => {
      detach();
      void db.update(codeMachine).set({ lastSeenAt: new Date() }).where(eq(codeMachine.id, machine.id)).returning().then(([m]) => m && publish(m.userId, { type: "machine", machine: machineView(m) }));
    };
  });
  return res;
}, 60);
