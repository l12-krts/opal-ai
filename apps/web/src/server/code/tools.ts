// The Opal Code tools agents get over MCP ("opal-code" server, relayed by the runner), so a thread
// can see and talk to the user's other threads. Opal chat uses the same actions (ai/tools/code.ts).
import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { codeProject, codeThread, type CodeThread } from "../db/schema";
import { agentLabel, type CodeItem } from "@/lib/code-types";
import { onIdle } from "./hub";
import { createThread, getThread, lastReply, loadItems, sendToThread } from "./store";

export const AGENT_TOOLS = [
  {
    name: "list_threads",
    description: "List the user's other Opal Code threads (id, title, agent, project, status). By default only active (not settled) threads.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["project", "all"], description: "project = only threads in this project (default: all)" },
        include_settled: { type: "boolean" },
      },
    },
  },
  {
    name: "read_thread",
    description: "Read the recent conversation of another thread: messages and a summary of the commands and edits it made.",
    inputSchema: {
      type: "object",
      properties: { thread_id: { type: "string" }, last: { type: "number", description: "How many recent entries (default 30)" } },
      required: ["thread_id"],
    },
  },
  {
    name: "send_message",
    description:
      "Send a message to another thread's agent. It shows up in that thread as a message from you and starts (or queues) a turn there. Set wait=true to wait for its reply.",
    inputSchema: {
      type: "object",
      properties: { thread_id: { type: "string" }, text: { type: "string" }, wait: { type: "boolean" }, timeout_sec: { type: "number" } },
      required: ["thread_id", "text"],
    },
  },
  {
    name: "start_thread",
    description:
      "Delegate a task to a new thread with its own agent (claude or codex) in this project. worktree=true gives it its own git branch and folder. Set wait=true to wait for the result.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Everything the other agent needs; it does not see this conversation." },
        agent: { type: "string", enum: ["claude", "codex"] },
        worktree: { type: "boolean" },
        wait: { type: "boolean" },
        timeout_sec: { type: "number" },
      },
      required: ["task"],
    },
  },
  {
    name: "ask_opal_agent",
    description:
      "Ask one of the user's Opal agents (assistants with their own computer, browser and the user's connected apps) to do something or answer a question, and wait for its reply. Use it when the user mentions an Opal agent.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string", description: "The agent's name or id" }, text: { type: "string", description: "What to ask; it doesn't see this conversation." } },
      required: ["agent", "text"],
    },
  },
  {
    name: "wait_thread",
    description: "Wait until another thread finishes its current turn, then return its last reply.",
    inputSchema: { type: "object", properties: { thread_id: { type: "string" }, timeout_sec: { type: "number" } }, required: ["thread_id"] },
  },
] as const;

/** Resolves true when the thread is idle (or errored), false after the timeout. */
export async function waitIdle(threadId: string, timeoutMs: number): Promise<boolean> {
  const [t] = await db.select({ status: codeThread.status }).from(codeThread).where(eq(codeThread.id, threadId)).limit(1);
  if (!t || t.status === "idle" || t.status === "error") return true;
  return new Promise((resolve) => {
    const off = onIdle(threadId, () => {
      clearTimeout(timer);
      resolve(true);
    });
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, timeoutMs);
  });
}

export const clampWait = (s: unknown) => Math.min(Math.max(Number(s) || 600, 5), 1800) * 1000;

export function transcript(items: CodeItem[]): string {
  return items
    .map((i) => {
      switch (i.kind) {
        case "user":
          return `USER${i.from ? ` (from ${i.from.title})` : ""}: ${i.text}`;
        case "assistant":
          return `AGENT: ${i.text}`;
        case "command":
          return `[ran] ${i.command}${i.exitCode != null ? ` (exit ${i.exitCode})` : ""}`;
        case "edit":
          return `[edited] ${i.files.map((f) => f.path).join(", ")}`;
        case "tool":
          return `[tool] ${i.name}`;
        case "approval":
          return `[approval ${i.status}] ${i.title}`;
        case "error":
          return `[error] ${i.text}`;
        default:
          return null;
      }
    })
    .filter(Boolean)
    .join("\n");
}

export async function describeThread(t: CodeThread) {
  const [p] = t.projectId ? await db.select().from(codeProject).where(eq(codeProject.id, t.projectId)).limit(1) : [];
  return `${t.id} · "${t.title}" · ${agentLabel(t.agent)} · ${p ? `project ${p.name}` : "no project"}${t.branch ? ` · branch ${t.branch}` : ""} · ${t.status}`;
}

export async function runAgentTool(self: CodeThread, name: string, args: Record<string, unknown>): Promise<string> {
  const userId = self.userId;
  const from = { threadId: self.id, title: self.title, agent: self.agent };
  switch (name) {
    case "list_threads": {
      const conds = [eq(codeThread.userId, userId), ne(codeThread.id, self.id)];
      if (args.scope === "project" && self.projectId) conds.push(eq(codeThread.projectId, self.projectId));
      const rows = await db.select().from(codeThread).where(and(...conds)).orderBy(desc(codeThread.lastActivityAt)).limit(50);
      const list = rows.filter((t) => args.include_settled || !t.settledAt);
      if (!list.length) return "No other threads.";
      return (await Promise.all(list.map(describeThread))).join("\n");
    }
    case "read_thread": {
      const t = await getThread(userId, String(args.thread_id));
      const items = await loadItems(t.id, Math.min(Number(args.last) || 30, 200));
      return `${await describeThread(t)}\n\n${transcript(items) || "(empty)"}`;
    }
    case "send_message": {
      const t = await getThread(userId, String(args.thread_id));
      if (t.id === self.id) return "That is this thread.";
      await sendToThread(t, String(args.text ?? ""), from);
      if (!args.wait) return `Sent to "${t.title}". It is working on it; use wait_thread or read_thread later.`;
      const done = await waitIdle(t.id, clampWait(args.timeout_sec));
      return done ? `Reply from "${t.title}":\n\n${(await lastReply(t.id)) || "(no text)"}` : `Still working after the timeout. Use wait_thread ${t.id} again later.`;
    }
    case "start_thread": {
      const agent = args.agent === "codex" || args.agent === "claude" ? args.agent : self.agent;
      const t = await createThread(userId, {
        projectId: self.projectId,
        machineId: self.machineId,
        agent,
        mode: self.mode,
        worktree: Boolean(args.worktree),
        text: String(args.task ?? ""),
        parentThreadId: self.id,
        from,
      });
      if (!args.wait) return `Started thread ${t.id} (${agentLabel(agent)}). Use wait_thread or read_thread to follow it.`;
      const done = await waitIdle(t.id, clampWait(args.timeout_sec));
      return done ? `Thread ${t.id} finished:\n\n${(await lastReply(t.id)) || "(no text)"}` : `Thread ${t.id} is still working. Use wait_thread later.`;
    }
    case "ask_opal_agent": {
      // Imported lazily: the Opal agent runtime is heavy and imports these tools itself.
      const { askOpalAgent } = await import("./opal-agents");
      return askOpalAgent(self, String(args.agent ?? ""), String(args.text ?? ""));
    }
    case "wait_thread": {
      const t = await getThread(userId, String(args.thread_id));
      const done = await waitIdle(t.id, clampWait(args.timeout_sec));
      const now = await getThread(userId, t.id);
      return done
        ? `"${now.title}" is ${now.status === "error" ? "stopped with an error" : "done"}. Last reply:\n\n${(await lastReply(t.id)) || "(no text)"}`
        : "Still working.";
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
