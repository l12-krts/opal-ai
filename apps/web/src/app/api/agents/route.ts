import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { SHAPE_IDS } from "@/lib/agent-shapes";
import { db } from "@/server/db";
import { agent } from "@/server/db/schema";
import { api, ApiError, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";

// An agent is a name, a color and a shape. Everything else (its computer, every tool, its
// single thread) comes with it.
export const AgentInput = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u, "Letters, numbers, spaces, dots, dashes"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  shape: z.enum(SHAPE_IDS).default("circle"),
});

type ListRow = {
  id: string;
  name: string;
  color: string;
  shape: string;
  thread_id: string | null;
  activity_at: string | Date;
  running: boolean;
  last: { role: string; parts: { type: string; text?: string; filename?: string }[]; metadata: { from?: { name: string } } | null } | null;
};

/** Markdown to one plain line. */
function plain(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`>#|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function preview(last: ListRow["last"]): string {
  if (!last) return "";
  const text = plain(
    last.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join(" "),
  );
  const file = last.parts.find((p) => p.type === "file");
  const body = text || (file ? `Sent ${file.filename ?? "a file"}` : last.role === "assistant" ? "Worked on a task" : "");
  if (last.role === "user") return `${last.metadata?.from?.name ?? "You"}: ${body}`.slice(0, 140);
  return body.slice(0, 140);
}

export const GET = api(
  async ({ user }) => {
    const result = await db.execute(sql`
      select a.id, a.name, a.color, a.shape, c.id as thread_id,
        coalesce(c.updated_at, a.created_at) as activity_at,
        exists (
          select 1 from agent_run r
          where r.agent_id = a.id and r.status = 'running' and r.created_at > now() - interval '20 minutes'
        ) as running,
        (
          select json_build_object('role', m.role, 'parts', m.parts, 'metadata', m.metadata)
          from message m where m.conversation_id = c.id
          order by m.created_at desc limit 1
        ) as last
      from agent a
      left join conversation c on c.agent_id = a.id
      where a.user_id = ${user.id} and a.conversation_id is null
      order by activity_at desc
    `);
    const rows = result.rows as unknown as ListRow[];
    return {
      agents: rows.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        shape: r.shape,
        threadId: r.thread_id,
        running: Boolean(r.running),
        preview: preview(r.last),
        activityAt: new Date(r.activity_at).toISOString(),
      })),
    };
  },
  { limit: LIMITS.read },
);

export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(req, AgentInput.extend({ fromEphemeralId: z.string().max(40).optional() }), 4 * 1024);
    const count = await db.$count(agent, and(eq(agent.userId, user.id), isNull(agent.conversationId)));
    if (count >= 50) throw new ApiError(400, "limit", "You can have up to 50 agents");
    const [dupe] = await db
      .select({ id: agent.id })
      .from(agent)
      .where(and(eq(agent.userId, user.id), isNull(agent.conversationId), eq(agent.name, body.name)))
      .limit(1);
    if (dupe) throw new ApiError(409, "name_taken", "You already have an agent with that name");

    // "Save" a helper a chat created: promote it (with its thread) instead of duplicating it.
    if (body.fromEphemeralId) {
      const [eph] = await db
        .update(agent)
        .set({ ephemeral: false, conversationId: null, name: body.name, color: body.color, shape: body.shape, updatedAt: new Date() })
        .where(and(eq(agent.id, body.fromEphemeralId), eq(agent.userId, user.id), ne(agent.ephemeral, false)))
        .returning();
      if (eph) return { agent: eph };
    }
    const [row] = await db
      .insert(agent)
      .values({ id: nanoid(), userId: user.id, name: body.name, color: body.color, shape: body.shape, role: "assistant" })
      .returning();
    return { agent: row };
  },
  { limit: LIMITS.write },
);
