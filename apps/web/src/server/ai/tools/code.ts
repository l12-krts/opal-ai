// Opal chat → Opal Code: Opal (and Opal agents) can see coding projects and threads, start a
// thread with Claude Code or Codex on one of the user's machines, message it, and read it.
import { tool } from "ai";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { codeMachine, codeProject, codeThread } from "../../db/schema";
import { isOnline } from "../../code/hub";
import { createThread, getThread, lastReply, loadItems, sendToThread } from "../../code/store";
import { clampWait, describeThread, transcript, waitIdle } from "../../code/tools";
import type { RunContext } from "../context";

export function codeTools(ctx: RunContext) {
  const from = { title: ctx.self?.name ?? "Opal" };
  return {
    code_overview: tool({
      description:
        "Opal Code: list the user's machines (online or not), coding projects and active coding threads (Claude Code / Codex agents running on their computers). Call this before starting or messaging a coding thread.",
      inputSchema: z.object({}),
      execute: async () => {
        const [machines, projects, threads] = await Promise.all([
          db.select().from(codeMachine).where(eq(codeMachine.userId, ctx.userId)),
          db.select().from(codeProject).where(eq(codeProject.userId, ctx.userId)),
          db.select().from(codeThread).where(and(eq(codeThread.userId, ctx.userId), isNull(codeThread.settledAt))).orderBy(desc(codeThread.lastActivityAt)).limit(30),
        ]);
        if (!machines.length) return { ok: true, note: "No machines connected. The user can connect one in Code → Machines." };
        return {
          ok: true,
          machines: machines.map((m) => ({ id: m.id, name: m.name, online: isOnline(m.id), agents: m.agents.filter((a) => a.ok).map((a) => a.id) })),
          projects: projects.map((p) => ({ id: p.id, name: p.name, machine: machines.find((m) => m.id === p.machineId)?.name, git: p.isGit })),
          threads: await Promise.all(threads.map(describeThread)),
        };
      },
    }),
    code_start: tool({
      description:
        "Opal Code: start a coding thread. A Claude Code or Codex agent works on the task in a project folder on the user's machine. The agent does not see this chat, so give it the full task. Returns the thread id; the user can follow it in Code.",
      inputSchema: z.object({
        project_id: z.string().describe("Project id from code_overview"),
        task: z.string().min(5),
        agent: z.enum(["claude", "codex"]).default("claude"),
        worktree: z.boolean().default(false).describe("Work on a new git branch in its own folder"),
        wait: z.boolean().default(false).describe("Wait for the agent to finish (up to 10 minutes) and return its reply"),
      }),
      execute: async ({ project_id, task, agent, worktree, wait }) => {
        try {
          const t = await createThread(ctx.userId, { projectId: project_id, agent, mode: "auto", worktree, text: task, from });
          if (!wait) return { ok: true, threadId: t.id, url: `/code/t/${t.id}`, note: "Started. It runs in Auto mode; risky steps wait for the user's approval in Opal Code." };
          const done = await waitIdle(t.id, clampWait(600));
          return { ok: true, threadId: t.id, url: `/code/t/${t.id}`, finished: done, reply: done ? await lastReply(t.id) : undefined };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    }),
    code_message: tool({
      description: "Opal Code: send a follow-up message to an existing coding thread. Set wait to get its reply.",
      inputSchema: z.object({ thread_id: z.string(), text: z.string().min(1), wait: z.boolean().default(false) }),
      execute: async ({ thread_id, text, wait }) => {
        try {
          const t = await getThread(ctx.userId, thread_id);
          await sendToThread(t, text, from);
          if (!wait) return { ok: true, threadId: t.id };
          const done = await waitIdle(t.id, clampWait(600));
          return { ok: true, threadId: t.id, finished: done, reply: done ? await lastReply(t.id) : undefined };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    }),
    code_read: tool({
      description: "Opal Code: read the recent conversation and actions of a coding thread.",
      inputSchema: z.object({ thread_id: z.string(), last: z.number().int().min(1).max(200).default(30) }),
      execute: async ({ thread_id, last }) => {
        try {
          const t = await getThread(ctx.userId, thread_id);
          return { ok: true, thread: await describeThread(t), transcript: transcript(await loadItems(t.id, last)) };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    }),
  };
}
