// Git for a thread's folder: status + diff (GET), and commit / push / open PR (POST).
import { generateText } from "ai";
import { z } from "zod";
import { ApiError, api, idSchema, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { command } from "@/server/code/hub";
import { getThread, updateThread } from "@/server/code/store";
import { fastModelId, getModel, noThinking } from "@/server/ai/models";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

type Status = { branch: string | null; base: string | null; ahead: number; behind: number; dirty: boolean; hasRemote: boolean; files: { path: string; status: string; additions: number; deletions: number }[] };

export const GET = api<{ id: string }>(
  async ({ user, params }) => {
    const t = await getThread(user.id, idSchema.parse(params.id));
    const [status, diff] = await Promise.all([
      command<Status>(t.machineId, "git.status", { cwd: t.cwd, base: t.baseBranch }),
      command<{ diff: string; truncated: boolean }>(t.machineId, "git.diff", { cwd: t.cwd, base: t.baseBranch }, 60_000),
    ]);
    return { status, ...diff, prUrl: t.prUrl };
  },
  { limit: LIMITS.read },
);

async function commitMessage(diff: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: getModel(fastModelId()),
      timeout: 15_000,
      maxRetries: 0,
      maxOutputTokens: 120,
      temperature: 0.2,
      providerOptions: noThinking(fastModelId()) as never,
      instructions:
        "Write a git commit message for this diff: a subject line under 70 characters in the imperative mood, then (only if useful) a blank line and up to three short bullet lines. Reply with only the message.",
      prompt: diff.slice(0, 24_000),
    });
    return text.trim() || "Update files";
  } catch {
    return "Update files";
  }
}

export const POST = api<{ id: string }>(
  async ({ req, user, params }) => {
    const t = await getThread(user.id, idSchema.parse(params.id));
    const body = await readJson(req, z.object({ action: z.enum(["commit", "push", "pr", "commit_push", "commit_push_pr"]), message: z.string().max(4000).optional() }));
    const out: { sha?: string; message?: string; prUrl?: string } = {};
    if (body.action.startsWith("commit")) {
      const { diff } = await command<{ diff: string }>(t.machineId, "git.diff", { cwd: t.cwd, base: null }, 60_000);
      if (!diff.trim() && body.action === "commit") throw new ApiError(400, "clean", "Nothing to commit");
      if (diff.trim()) {
        const message = body.message?.trim() || (await commitMessage(diff));
        const r = await command<{ sha: string }>(t.machineId, "git.commit", { cwd: t.cwd, message }, 60_000);
        Object.assign(out, { sha: r.sha, message });
      }
    }
    if (body.action !== "commit") {
      await command(t.machineId, "git.push", { cwd: t.cwd }, 120_000);
    }
    if (body.action === "pr" || body.action === "commit_push_pr") {
      const r = await command<{ url: string }>(t.machineId, "git.pr", { cwd: t.cwd, title: t.title, base: t.baseBranch, body: "Opened from Opal Code." }, 120_000);
      out.prUrl = r.url;
      await updateThread(t.id, { prUrl: r.url });
    }
    return out;
  },
  { limit: LIMITS.write },
);
