// Auto-settle: a thread leaves the Inbox once it has been idle and read for a while, or once its
// pull request is merged. Runs lazily when the Inbox loads (at most every few minutes per user).
import "server-only";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { codeThread } from "../db/schema";
import { command, isOnline } from "./hub";
import { updateThread } from "./store";
import { loadCodeSettings } from "./prefs";

const last = new Map<string, number>();

export async function sweepSettled(userId: string) {
  const now = Date.now();
  if ((last.get(userId) ?? 0) > now - 5 * 60_000) return;
  last.set(userId, now);
  try {
    const { settleDays } = await loadCodeSettings(userId);
    const cutoff = new Date(now - settleDays * 24 * 60 * 60 * 1000);
    const stale = !settleDays
      ? []
      : await db
      .select()
      .from(codeThread)
      .where(
        and(
          eq(codeThread.userId, userId),
          isNull(codeThread.settledAt),
          isNull(codeThread.pinnedAt),
          eq(codeThread.status, "idle"),
          lt(codeThread.lastActivityAt, cutoff),
          sql`${codeThread.lastReadAt} >= ${codeThread.lastActivityAt}`,
        ),
      );
    for (const t of stale) await updateThread(t.id, { settledAt: new Date() });

    const withPr = await db
      .select()
      .from(codeThread)
      .where(and(eq(codeThread.userId, userId), isNull(codeThread.settledAt), isNotNull(codeThread.prUrl)));
    for (const t of withPr) {
      if (!isOnline(t.machineId)) continue;
      const r = await command<{ state: string }>(t.machineId, "git.prState", { cwd: t.cwd, url: t.prUrl }, 20_000).catch(() => null);
      if (r?.state === "MERGED") await updateThread(t.id, { settledAt: new Date(), pinnedAt: null });
    }
  } catch (e) {
    console.error("[code] settle sweep", e);
  }
}
