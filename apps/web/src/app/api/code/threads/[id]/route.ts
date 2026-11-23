import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { codeThread } from "@/server/db/schema";
import { api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { publish, send } from "@/server/code/hub";
import { getThread, loadItems, threadView, updateThread } from "@/server/code/store";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(
  async ({ user, params }) => {
    const t = await getThread(user.id, idSchema.parse(params.id));
    return { thread: threadView(t), items: await loadItems(t.id) };
  },
  { limit: LIMITS.read },
);

export const PATCH = api<{ id: string }>(
  async ({ req, user, params }) => {
    const t = await getThread(user.id, idSchema.parse(params.id));
    const body = await readJson(
      req,
      z.object({
        title: z.string().trim().min(1).max(120).optional(),
        pinned: z.boolean().optional(),
        snoozedUntil: z.string().datetime().nullable().optional(),
        settled: z.boolean().optional(),
        read: z.literal(true).optional(),
        mode: z.enum(["auto", "ask", "full"]).optional(),
        model: z.string().max(60).nullable().optional(),
      }),
    );
    const patch: Partial<typeof codeThread.$inferInsert> = {};
    if (body.title) patch.title = body.title;
    if (body.pinned !== undefined) patch.pinnedAt = body.pinned ? new Date() : null;
    if (body.snoozedUntil !== undefined) patch.snoozedUntil = body.snoozedUntil ? new Date(body.snoozedUntil) : null;
    if (body.settled !== undefined) Object.assign(patch, body.settled ? { settledAt: new Date(), pinnedAt: null, snoozedUntil: null } : { settledAt: null });
    if (body.read) patch.lastReadAt = new Date();
    if (body.mode) patch.mode = body.mode;
    if (body.model !== undefined) patch.model = body.model;
    const next = await updateThread(t.id, patch);
    if (body.mode && body.mode !== t.mode) {
      try {
        send(t.machineId, "thread.mode", { threadId: t.id, mode: body.mode });
      } catch {}
    }
    return { thread: next ? threadView(next) : null };
  },
  { limit: LIMITS.write },
);

/** Deletes the thread from Opal and stops its agent. Its folder or worktree stays on the machine. */
export const DELETE = api<{ id: string }>(
  async ({ user, params }) => {
    const t = await getThread(user.id, idSchema.parse(params.id));
    try {
      send(t.machineId, "thread.close", { threadId: t.id });
    } catch {}
    await db.delete(codeThread).where(eq(codeThread.id, t.id));
    publish(user.id, { type: "thread-deleted", threadId: t.id });
    return { ok: true };
  },
  { limit: LIMITS.write },
);
