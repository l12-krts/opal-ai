// Latest state of an agent's computer, for the side panel.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { sandbox } from "@/server/db/schema";
import { api } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { ensureSandbox, execIn } from "@/server/sandbox/docker";

const agentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{4,80}$/);

export const GET = api<{ agentId: string }>(
  async ({ user, params }) => {
    const agentId = agentIdSchema.parse(params.agentId);
    const [row] = await db
      .select()
      .from(sandbox)
      .where(and(eq(sandbox.agentId, agentId), eq(sandbox.userId, user.id)))
      .limit(1);
    if (!row) return { sandbox: null };
    let files: { type: string; path: string; size: number }[] = [];
    if (row.status === "running") {
      try {
        const c = await ensureSandbox(user.id, agentId);
        const res = await execIn(c, ["find", "/workspace", "-maxdepth", "3", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.*", "-printf", "%y %s %P\n"], { timeoutSec: 10 });
        files = res.stdout
          .split("\n")
          .filter(Boolean)
          .slice(0, 200)
          .map((l) => {
            const [t, s, ...p] = l.split(" ");
            return { type: t === "d" ? "dir" : "file", size: Number(s), path: p.join(" ") };
          })
          .filter((f) => f.path);
      } catch {}
    }
    return {
      sandbox: { status: row.status, lastUrl: row.lastUrl, lastScreenshot: row.lastScreenshot, lastUsedAt: row.lastUsedAt, files },
    };
  },
  { limit: LIMITS.read },
);

// Agent ids for sandboxes may be the per-user "opal-<userId>" one; only the owner reaches it
// because rows are filtered by user_id and containers are labelled with it.
export const dynamic = "force-dynamic";
