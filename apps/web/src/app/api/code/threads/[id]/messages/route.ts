// Send a message to a thread. While the agent is working the runner queues it for the next turn.
import { z } from "zod";
import { api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { getThread, sendToThread, updateThread } from "@/server/code/store";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(
  async ({ req, user, params }) => {
    const t = await getThread(user.id, idSchema.parse(params.id));
    const { text, mentions } = await readJson(req, z.object({ text: z.string().trim().min(1).max(100_000), mentions: z.array(z.object({ kind: z.enum(["file", "thread", "agent"]), id: z.string().min(1).max(500), label: z.string().min(1).max(200) })).max(30).default([]) }), 512 * 1024);
    await sendToThread(t, text, undefined, mentions);
    await updateThread(t.id, { lastReadAt: new Date(), settledAt: null, snoozedUntil: null });
    return { ok: true };
  },
  { limit: LIMITS.chat },
);
