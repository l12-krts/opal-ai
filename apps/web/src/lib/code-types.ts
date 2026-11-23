// Opal Code types shared by the server routes and the UI. The runner keeps a copy of the item and
// event shapes in apps/runner/src/protocol.ts; keep the two in step.

export type CodeAgentId = "claude" | "codex";
export type CodeMode = "auto" | "ask" | "full";
export type ThreadStatus = "idle" | "working" | "waiting" | "error";

export const CODE_AGENTS: { id: CodeAgentId; label: string; models: { id: string; label: string }[] }[] = [
  {
    id: "claude",
    label: "Claude Code",
    models: [
      { id: "default", label: "Default" },
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" },
      { id: "haiku", label: "Haiku" },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    models: [
      { id: "default", label: "Default" },
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.5-codex", label: "GPT-5.5 Codex" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
    ],
  },
];

export const agentLabel = (id: string) => CODE_AGENTS.find((a) => a.id === id)?.label ?? id;

export type ItemStatus = "running" | "done" | "failed";

/** Something @mentioned in a message. `label` is exactly what follows the @ in the text. */
export type Mention = { kind: "file" | "thread" | "agent"; id: string; label: string };

export type CodeSkillView = { id: string; name: string; description: string; instructions: string; enabled: boolean };

/** Opal Code preferences (separate from Opal chat settings). */
export type CodeSettings = {
  defaultAgent: CodeAgentId;
  defaultMode: CodeMode;
  worktreeByDefault: boolean;
  /** Days a finished, read thread stays in the Inbox before it settles. 0 = never. */
  settleDays: number;
};

export const DEFAULT_CODE_SETTINGS: CodeSettings = { defaultAgent: "claude", defaultMode: "auto", worktreeByDefault: false, settleDays: 3 };

export function codeSettingsOf(raw: unknown): CodeSettings {
  const r = (raw ?? {}) as Partial<CodeSettings>;
  return {
    defaultAgent: r.defaultAgent === "codex" ? "codex" : "claude",
    defaultMode: r.defaultMode === "ask" || r.defaultMode === "full" ? r.defaultMode : "auto",
    worktreeByDefault: Boolean(r.worktreeByDefault),
    settleDays: Number.isFinite(r.settleDays) ? Math.min(Math.max(Math.round(r.settleDays!), 0), 60) : 3,
  };
}

/** The enabled skill whose "/Name" starts the text, if any. */
export function leadingSkill(text: string, names: string[]): string | null {
  const lower = text.toLowerCase();
  return (
    [...names]
      .sort((a, b) => b.length - a.length)
      .find((n) => {
        const tok = `/${n.toLowerCase()}`;
        return lower.startsWith(tok) && (lower.length === tok.length || /\s/.test(lower[tok.length]));
      }) ?? null
  );
}

/** Splits text into plain runs and @mention / leading /skill tokens, for chips. */
export type RichPart = { type: "text"; text: string } | { type: "mention"; text: string; mention: Mention } | { type: "skill"; text: string; name: string };

export function richParts(text: string, mentions: Mention[] = [], skill?: string): RichPart[] {
  const out: RichPart[] = [];
  let rest = text;
  if (skill && rest.toLowerCase().startsWith(`/${skill.toLowerCase()}`)) {
    out.push({ type: "skill", text: rest.slice(0, skill.length + 1), name: skill });
    rest = rest.slice(skill.length + 1);
  }
  const labels = [...new Set(mentions.map((m) => m.label))].sort((a, b) => b.length - a.length);
  if (!labels.length) {
    if (rest) out.push({ type: "text", text: rest });
    return out;
  }
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@(${labels.map(esc).join("|")})`, "g");
  let last = 0;
  for (const m of rest.matchAll(re)) {
    if (m.index! > last) out.push({ type: "text", text: rest.slice(last, m.index) });
    const mention = mentions.find((x) => x.label === m[1])!;
    out.push({ type: "mention", text: m[0], mention });
    last = m.index! + m[0].length;
  }
  if (last < rest.length) out.push({ type: "text", text: rest.slice(last) });
  return out;
}

export type CodeItemData =
  | { kind: "user"; text: string; from?: { threadId?: string; title: string; agent?: string }; mentions?: Mention[]; skill?: string }
  | { kind: "assistant"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "command"; command: string; output?: string; exitCode?: number | null; status: ItemStatus }
  | { kind: "edit"; files: { path: string; change: "add" | "update" | "delete"; diff?: string }[]; status: ItemStatus }
  | { kind: "tool"; name: string; server?: string; input?: unknown; output?: string; status: ItemStatus }
  | {
      kind: "approval";
      requestId: string;
      title: string;
      detail?: string;
      command?: string;
      status: "pending" | "approved" | "denied" | "expired";
    }
  | { kind: "error"; text: string }
  | { kind: "notice"; text: string };

export type CodeItem = CodeItemData & { id: string; seq: number; createdAt: string; updatedAt: string };

export type MachineView = {
  id: string;
  name: string;
  os: string;
  hostname: string;
  projectsRoot: string;
  online: boolean;
  agents: { id: string; version: string | null; ok: boolean; note?: string; signedIn?: boolean }[];
  lastSeenAt: string | null;
};

export type ProjectView = { id: string; machineId: string; name: string; path: string; isGit: boolean };

export type ThreadView = {
  id: string;
  title: string;
  agent: string;
  model: string | null;
  mode: CodeMode;
  status: ThreadStatus;
  machineId: string;
  projectId: string | null;
  cwd: string;
  branch: string | null;
  baseBranch: string | null;
  worktree: boolean;
  parentThreadId: string | null;
  groupId: string | null;
  prUrl: string | null;
  pinnedAt: string | null;
  snoozedUntil: string | null;
  settledAt: string | null;
  lastReadAt: string | null;
  lastActivityAt: string;
  createdAt: string;
  preview: string | null;
};

export type CodeState = { machines: MachineView[]; projects: ProjectView[]; threads: ThreadView[] };

/** Live events sent to the browser over /api/code/events. */
export type CodeLiveEvent =
  | { type: "thread"; thread: ThreadView }
  | { type: "thread-deleted"; threadId: string }
  | { type: "item"; threadId: string; item: CodeItem }
  | { type: "machine"; machine: MachineView }
  | { type: "terminal"; termId: string; data: string }
  | { type: "terminal-exit"; termId: string; code: number | null };

export type InboxSection = "pinned" | "needs" | "working" | "done" | "snoozed" | "settled";

export function inboxSection(t: ThreadView, now = Date.now()): InboxSection {
  if (t.settledAt) return "settled";
  if (t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now) return "snoozed";
  if (t.pinnedAt) return "pinned";
  if (t.status === "waiting" || t.status === "error") return "needs";
  if (t.status === "working") return "working";
  return "done";
}

export const isUnread = (t: ThreadView) => !t.lastReadAt || new Date(t.lastActivityAt) > new Date(t.lastReadAt);
