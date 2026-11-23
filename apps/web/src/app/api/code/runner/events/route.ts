// Batched events from the runner: thread items, status changes, provider session ids, terminal
// output. Every thread event is checked against the machine that sent it.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { codeThread } from "@/server/db/schema";
import { readJson } from "@/server/http";
import { publish } from "@/server/code/hub";
import { setStatus, updateThread, upsertItem } from "@/server/code/store";
import { runnerRoute } from "@/server/code/runner-auth";
import type { CodeItemData } from "@/lib/code-types";

export const dynamic = "force-dynamic";

const Event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("item"), threadId: z.string().max(64), id: z.string().max(200), data: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("status"), threadId: z.string().max(64), status: z.enum(["idle", "working", "waiting", "error"]) }),
  z.object({ type: z.literal("session"), threadId: z.string().max(64), sessionId: z.string().max(200) }),
  z.object({ type: z.literal("terminal"), termId: z.string().max(64), data: z.string().max(512 * 1024) }),
  z.object({ type: z.literal("terminal-exit"), termId: z.string().max(64), code: z.number().nullable() }),
]);

const KINDS = new Set(["user", "assistant", "reasoning", "command", "edit", "tool", "approval", "error", "notice"]);

export const POST = runnerRoute(async (req, machine) => {
  const { events } = await readJson(req, z.object({ events: z.array(Event).max(500) }), 8 * 1024 * 1024);
  const ids = [...new Set(events.flatMap((e) => ("threadId" in e ? [e.threadId] : [])))];
  const owned = ids.length
    ? await db.select().from(codeThread).where(and(inArray(codeThread.id, ids), eq(codeThread.machineId, machine.id)))
    : [];
  const threads = new Map(owned.map((t) => [t.id, t]));

  for (const e of events) {
    if (e.type === "terminal") {
      publish(machine.userId, { type: "terminal", termId: e.termId, data: e.data });
      continue;
    }
    if (e.type === "terminal-exit") {
      publish(machine.userId, { type: "terminal-exit", termId: e.termId, code: e.code });
      continue;
    }
    const t = threads.get(e.threadId);
    if (!t) continue;
    if (e.type === "item") {
      const kind = String(e.data.kind ?? "");
      if (!KINDS.has(kind)) continue;
      await upsertItem(t, e.id, e.data as unknown as CodeItemData);
    } else if (e.type === "status") {
      const next = await setStatus(t.id, e.status);
      if (next) threads.set(t.id, next);
    } else if (e.type === "session") {
      await updateThread(t.id, { providerSessionId: e.sessionId });
    }
  }
  return { ok: true };
});
