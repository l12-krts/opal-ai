// Opal Code persistence and the actions shared by the browser API, the runner API, agent MCP
// tools and Opal chat tools.
import "server-only";
import { createHash } from "node:crypto";
import { generateText } from "ai";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db";
import { codeItem, codeMachine, codeProject, codeThread, type CodeMachine, type CodeProject, type CodeThread } from "../db/schema";
import { ApiError } from "../http";
import { fastModelId, getModel, noThinking } from "../ai/models";
import type { CodeItem, CodeItemData, CodeMode, CodeState, MachineView, Mention, ProjectView, ThreadStatus, ThreadView } from "@/lib/code-types";
import { skillFromText } from "./prefs";
import { command, isOnline, notifyIdle, publish } from "./hub";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function machineView(m: CodeMachine): MachineView {
  return {
    id: m.id,
    name: m.name,
    os: m.os,
    hostname: m.hostname,
    projectsRoot: m.projectsRoot,
    online: isOnline(m.id),
    agents: m.agents ?? [],
    lastSeenAt: m.lastSeenAt?.toISOString() ?? null,
  };
}

export const projectView = (p: CodeProject): ProjectView => ({ id: p.id, machineId: p.machineId, name: p.name, path: p.path, isGit: p.isGit });

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function threadView(t: CodeThread, preview: string | null = null): ThreadView {
  return {
    id: t.id,
    title: t.title,
    agent: t.agent,
    model: t.model,
    mode: t.mode,
    status: t.status,
    machineId: t.machineId,
    projectId: t.projectId,
    cwd: t.cwd,
    branch: t.branch,
    baseBranch: t.baseBranch,
    worktree: t.worktree,
    parentThreadId: t.parentThreadId,
    groupId: t.groupId,
    prUrl: t.prUrl,
    pinnedAt: iso(t.pinnedAt),
    snoozedUntil: iso(t.snoozedUntil),
    settledAt: iso(t.settledAt),
    lastReadAt: iso(t.lastReadAt),
    lastActivityAt: t.lastActivityAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
    preview,
  };
}

async function previews(threadIds: string[]): Promise<Map<string, string>> {
  if (!threadIds.length) return new Map();
  const rows = await db.execute<{ thread_id: string; text: string | null }>(sql`
    select distinct on (thread_id) thread_id, data->>'text' as text
    from code_item
    where thread_id in (${sql.join(threadIds.map((id) => sql`${id}`), sql`, `)}) and kind in ('assistant', 'user')
    order by thread_id, seq desc`);
  const out = new Map<string, string>();
  for (const r of rows.rows as unknown as { thread_id: string; text: string | null }[]) {
    if (r.text) out.set(r.thread_id, plain(r.text).slice(0, 160));
  }
  return out;
}

const plain = (s: string) =>
  s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>~[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export async function loadState(userId: string): Promise<CodeState> {
  const [machines, projects, threads] = await Promise.all([
    db.select().from(codeMachine).where(eq(codeMachine.userId, userId)).orderBy(codeMachine.createdAt),
    db.select().from(codeProject).where(eq(codeProject.userId, userId)).orderBy(codeProject.name),
    db.select().from(codeThread).where(eq(codeThread.userId, userId)).orderBy(desc(codeThread.lastActivityAt)).limit(400),
  ]);
  const pv = await previews(threads.map((t) => t.id));
  return {
    machines: machines.map(machineView),
    projects: projects.map(projectView),
    threads: threads.map((t) => threadView(t, pv.get(t.id) ?? null)),
  };
}

export async function getThread(userId: string, id: string): Promise<CodeThread> {
  const [t] = await db.select().from(codeThread).where(and(eq(codeThread.id, id), eq(codeThread.userId, userId))).limit(1);
  if (!t) throw new ApiError(404, "not_found", "Thread not found");
  return t;
}

export async function getMachine(userId: string, id: string): Promise<CodeMachine> {
  const [m] = await db.select().from(codeMachine).where(and(eq(codeMachine.id, id), eq(codeMachine.userId, userId))).limit(1);
  if (!m) throw new ApiError(404, "not_found", "Machine not found");
  return m;
}

export async function getProject(userId: string, id: string): Promise<CodeProject> {
  const [p] = await db.select().from(codeProject).where(and(eq(codeProject.id, id), eq(codeProject.userId, userId))).limit(1);
  if (!p) throw new ApiError(404, "not_found", "Project not found");
  return p;
}

export async function loadItems(threadId: string, limit = 2000): Promise<CodeItem[]> {
  const rows = await db.select().from(codeItem).where(eq(codeItem.threadId, threadId)).orderBy(desc(codeItem.seq)).limit(limit);
  return rows.reverse().map((r) => ({
    ...(r.data as CodeItemData),
    id: r.id,
    seq: r.seq,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function publishThread(t: CodeThread) {
  const pv = await previews([t.id]);
  publish(t.userId, { type: "thread", thread: threadView(t, pv.get(t.id) ?? null) });
}

export async function updateThread(id: string, patch: Partial<typeof codeThread.$inferInsert>): Promise<CodeThread | null> {
  const [t] = await db.update(codeThread).set(patch).where(eq(codeThread.id, id)).returning();
  if (t) await publishThread(t);
  return t ?? null;
}

/** Inserts or replaces an item (by id) and tells the browser. */
export async function upsertItem(thread: Pick<CodeThread, "id" | "userId">, id: string, data: CodeItemData): Promise<CodeItem> {
  const [row] = await db
    .insert(codeItem)
    .values({
      threadId: thread.id,
      id,
      kind: data.kind,
      data: data as unknown as Record<string, unknown>,
      seq: sql`(select coalesce(max(seq), 0) + 1 from code_item where thread_id = ${thread.id})`,
    })
    .onConflictDoUpdate({ target: [codeItem.threadId, codeItem.id], set: { data: data as unknown as Record<string, unknown>, kind: data.kind, updatedAt: new Date() } })
    .returning();
  const item: CodeItem = { ...data, id: row.id, seq: row.seq, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  publish(thread.userId, { type: "item", threadId: thread.id, item });
  return item;
}

export async function setStatus(threadId: string, status: ThreadStatus) {
  const patch: Partial<typeof codeThread.$inferInsert> = { status, lastActivityAt: new Date() };
  // New activity wakes a snoozed or settled thread when it needs you or finished.
  if (status !== "working") Object.assign(patch, { snoozedUntil: null, settledAt: null });
  const t = await updateThread(threadId, patch);
  if (status === "idle" || status === "error") notifyIdle(threadId);
  return t;
}

const OPAL_CODE_INSTRUCTIONS = (t: CodeThread) =>
  `You are running inside Opal Code (thread id ${t.id}). The "opal-code" MCP server lets you see and talk to the user's other coding threads: list_threads, read_thread, send_message, start_thread (delegate a task to another agent, optionally in its own worktree) and wait_thread, and ask_opal_agent reaches the user's Opal agents (assistants with their own computer). Use them when the user asks you to coordinate with, check on, or hand work to other threads or agents.`;

/**
 * What the coding agent actually receives: the message, plus a leading Code skill's instructions
 * and short notes on what the user @mentioned (files are paths it can open; threads and Opal
 * agents are reachable through its opal-code tools).
 */
function agentText(text: string, opts: { mentions: Mention[]; skill: { name: string; instructions: string } | null }) {
  const parts: string[] = [];
  let body = text;
  if (opts.skill) {
    body = body.slice(opts.skill.name.length + 1).trim();
    parts.push(`Follow the user's "${opts.skill.name}" skill for this request:\n${opts.skill.instructions}\n---`);
  }
  parts.push(body || (opts.skill ? `Run the "${opts.skill.name}" skill.` : ""));
  const files = opts.mentions.filter((m) => m.kind === "file");
  const threads = opts.mentions.filter((m) => m.kind === "thread");
  const agents = opts.mentions.filter((m) => m.kind === "agent");
  const notes: string[] = [];
  if (files.length) notes.push(`Files the user pointed to (relative to your working folder): ${files.map((f) => f.id).join(", ")}`);
  if (threads.length)
    notes.push(`Other Opal Code threads the user mentioned: ${threads.map((m) => `"${m.label}" (thread id ${m.id})`).join(", ")}. Use read_thread / send_message from the opal-code tools.`);
  if (agents.length) notes.push(`Opal agents the user mentioned: ${agents.map((m) => `${m.label} (id ${m.id})`).join(", ")}. Reach them with ask_opal_agent.`);
  if (notes.length) parts.push(`[${notes.join("\n")}]`);
  return parts.filter(Boolean).join("\n\n").trim();
}

/** Adds the user's message to the thread and starts (or queues) a turn on the machine. */
export async function sendToThread(t: CodeThread, text: string, from?: { threadId?: string; title: string; agent?: string }, mentions: Mention[] = []) {
  const itemId = `u_${nanoid(12)}`;
  const skill = from ? null : await skillFromText(t.userId, text);
  const used = mentions.filter((m) => text.includes(`@${m.label}`));
  await upsertItem(t, itemId, { kind: "user", text, ...(from ? { from } : {}), ...(used.length ? { mentions: used } : {}), ...(skill ? { skill: skill.name } : {}) });
  await command(t.machineId, "turn.start", {
    threadId: t.id,
    agent: t.agent,
    model: t.model && t.model !== "default" ? t.model : null,
    mode: t.mode,
    cwd: t.cwd,
    text: from ? `[Message from ${from.title}${from.threadId ? ` (thread ${from.threadId})` : ""}]\n\n${text}` : agentText(text, { mentions: used, skill }),
    sessionId: t.providerSessionId,
    instructions: OPAL_CODE_INSTRUCTIONS(t),
  }, 30_000);
  await setStatus(t.id, "working");
  if (t.title === "New thread") void nameThread(t, skill ? text.slice(skill.name.length + 1).trim() || skill.name : text);
}

async function nameThread(t: CodeThread, text: string) {
  try {
    const { text: out } = await generateText({
      model: getModel(fastModelId()),
      timeout: 8000,
      maxRetries: 0,
      maxOutputTokens: 24,
      temperature: 0.2,
      providerOptions: noThinking(fastModelId()) as never,
      instructions: "You name coding tasks. Do not do the task. Reply with only a 2-6 word title for it, sentence case, no quotes, no period.",
      prompt: `Task:\n"""\n${text.slice(0, 1500)}\n"""\n\nTitle:`,
    });
    const title = out.replace(/["«»“”]/g, "").trim().replace(/\.$/, "").slice(0, 80);
    if (title) await updateThread(t.id, { title });
  } catch {
    await updateThread(t.id, { title: text.replace(/\s+/g, " ").slice(0, 60) });
  }
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .slice(0, 40)
    .replace(/-+$/, "") || "task";

export type NewThreadInput = {
  projectId?: string | null;
  machineId?: string | null;
  agent: string;
  model?: string | null;
  mode: CodeMode;
  worktree?: boolean;
  baseBranch?: string | null;
  text: string;
  parentThreadId?: string | null;
  groupId?: string | null;
  from?: { threadId?: string; title: string; agent?: string };
  mentions?: Mention[];
};

/** Creates a thread (and its worktree when asked) and sends the first message. */
export async function createThread(userId: string, input: NewThreadInput): Promise<CodeThread> {
  let machineId = input.machineId ?? null;
  let cwd: string | null = null;
  let project: CodeProject | null = null;
  if (input.projectId) {
    project = await getProject(userId, input.projectId);
    machineId = project.machineId;
    cwd = project.path;
  }
  if (!machineId) throw new ApiError(400, "no_machine", "Pick a project or a machine");
  const machine = await getMachine(userId, machineId);
  if (!isOnline(machine.id)) throw new ApiError(409, "offline", `${machine.name} is offline. Start the Opal runner on it.`);
  const id = nanoid();

  let branch: string | null = null;
  let baseBranch: string | null = input.baseBranch ?? null;
  if (!cwd) {
    const r = await command<{ path: string }>(machine.id, "project.scratch", { name: `${new Date().toISOString().slice(0, 10)}-${slug(input.text)}-${id.slice(0, 6)}` });
    cwd = r.path;
  } else if (input.worktree && project?.isGit) {
    const r = await command<{ path: string; branch: string; base: string }>(
      machine.id,
      "git.worktree",
      { repo: project.path, project: project.name, branch: `opal/${slug(input.text)}-${id.slice(0, 4)}`, base: baseBranch },
      120_000,
    );
    cwd = r.path;
    branch = r.branch;
    baseBranch = r.base;
  } else if (project?.isGit) {
    const s = await command<{ branch: string | null }>(machine.id, "git.status", { cwd }).catch(() => ({ branch: null }));
    branch = s.branch;
  }

  const [t] = await db
    .insert(codeThread)
    .values({
      id,
      userId,
      machineId: machine.id,
      projectId: project?.id ?? null,
      agent: input.agent,
      model: input.model ?? null,
      mode: input.mode,
      cwd,
      branch,
      baseBranch,
      worktree: Boolean(input.worktree && project?.isGit),
      parentThreadId: input.parentThreadId ?? null,
      groupId: input.groupId ?? null,
    })
    .returning();
  await publishThread(t);
  await sendToThread(t, input.text, input.from, input.mentions ?? []);
  return t;
}

/** Last assistant reply in a thread (for waits and read_thread). */
export async function lastReply(threadId: string): Promise<string> {
  const [row] = await db
    .select({ data: codeItem.data })
    .from(codeItem)
    .where(and(eq(codeItem.threadId, threadId), eq(codeItem.kind, "assistant")))
    .orderBy(desc(codeItem.seq))
    .limit(1);
  return (row?.data as { text?: string } | undefined)?.text ?? "";
}

export async function threadsByIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(codeThread).where(and(eq(codeThread.userId, userId), inArray(codeThread.id, ids)));
}
