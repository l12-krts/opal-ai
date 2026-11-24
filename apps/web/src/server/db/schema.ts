import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const userRef = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

// ─── Settings ────────────────────────────────────────────────────────────────
export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  nerdMode: boolean("nerd_mode").notNull().default(false),
  theme: text("theme", { enum: ["system", "light", "dark"] }).notNull().default("system"),
  model: text("model"), // null → server default
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
  accent: text("accent").notNull().default("mono"),
  /** Opal Code preferences, kept apart from chat settings. See lib/code-types CodeSettings. */
  codeSettings: jsonb("code_settings").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
});

// ─── Customization: memory and skills ────────────────────────────────────────
// Things Opal remembers about the user across chats. Saved by Opal (remember tool) or by hand.
export const memory = pgTable(
  "memory",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    content: text("content").notNull(),
    source: text("source", { enum: ["opal", "user"] }).notNull().default("opal"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("memory_user_idx").on(t.userId, t.createdAt)],
);

// Reusable instructions. Opal sees each enabled skill's name and description, and loads the
// instructions (use_skill) when a task fits.
export const skill = pgTable(
  "skill",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    instructions: text("instructions").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("skill_user_name_uq").on(t.userId, t.name)],
);

// ─── Agents ──────────────────────────────────────────────────────────────────
export const agent = pgTable(
  "agent",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    // Body shape of the agent's face (see lib/agent-shapes.ts).
    shape: text("shape").notNull().default("circle"),
    // Legacy: agents used to have a character, instructions, a role and a capability list.
    // Every agent now has its own computer and every tool; these stay for old rows only.
    character: text("character").notNull().default("balanced"),
    persona: text("persona").notNull().default(""),
    role: text("role", { enum: ["assistant", "helper"] }).notNull().default("helper"),
    model: text("model"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
    // Created by a chat on the fly (sub-agent). Hidden from the agents page unless saved.
    ephemeral: boolean("ephemeral").notNull().default(false),
    conversationId: text("conversation_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("agent_user_idx").on(t.userId),
    unique("agent_user_name_uq").on(t.userId, t.name, t.conversationId).nullsNotDistinct(),
  ],
);

// ─── Conversations ───────────────────────────────────────────────────────────
export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    title: text("title").notNull().default("New chat"),
    mode: text("mode", { enum: ["chat", "study"] }).notNull().default("chat"),
    // Set on an agent's thread. Each agent has exactly one, deleted with the agent.
    agentId: text("agent_id").references(() => agent.id, { onDelete: "cascade" }),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversation_user_updated_idx").on(t.userId, t.updatedAt), uniqueIndex("conversation_agent_uq").on(t.agentId)],
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    parts: jsonb("parts").$type<unknown[]>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("message_conversation_idx").on(t.conversationId, t.createdAt)],
);

// ─── Agent runs and the agent message bus ────────────────────────────────────
export const agentRun = pgTable(
  "agent_run",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    conversationId: text("conversation_id").references(() => conversation.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agent.id, { onDelete: "set null" }),
    parentRunId: text("parent_run_id"),
    task: text("task").notNull(),
    status: text("status", { enum: ["running", "done", "error", "cancelled"] }).notNull().default("running"),
    result: text("result"),
    steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
    usage: jsonb("usage").$type<Record<string, number>>(),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("agent_run_conversation_idx").on(t.conversationId)],
);

export const agentMessage = pgTable(
  "agent_message",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    conversationId: text("conversation_id").references(() => conversation.id, { onDelete: "cascade" }),
    fromAgentId: text("from_agent_id"), // null = Opal (the orchestrator)
    toAgentId: text("to_agent_id"),
    content: text("content").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("agent_message_to_idx").on(t.toAgentId, t.readAt)],
);

export const sandbox = pgTable("sandbox", {
  id: text("id").primaryKey(),
  userId: userRef(),
  agentId: text("agent_id").notNull().unique(),
  containerId: text("container_id"),
  status: text("status", { enum: ["creating", "running", "stopped", "error"] }).notNull().default("creating"),
  lastScreenshot: text("last_screenshot"), // data URL of the latest browser frame
  lastUrl: text("last_url"),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Secrets vault (values are AES-256-GCM encrypted, never sent to a model) ─
export const secret = pgTable(
  "secret",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    name: text("name").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    ciphertext: text("ciphertext").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("secret_user_name_uq").on(t.userId, t.name)],
);

// ─── Study ───────────────────────────────────────────────────────────────────
export const studySource = pgTable(
  "study_source",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    kind: text("kind", { enum: ["ebooks", "eclass"] }).notNull(),
    label: text("label").notNull(),
    config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("study_source_user_idx").on(t.userId)],
);

export const artifact = pgTable(
  "artifact",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    conversationId: text("conversation_id").references(() => conversation.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["quiz", "flashcards", "ui", "handwriting", "document"] }).notNull(),
    title: text("title").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("artifact_user_idx").on(t.userId, t.createdAt)],
);

// ─── Handwriting ─────────────────────────────────────────────────────────────
export const handwritingProfile = pgTable(
  "handwriting_profile",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    name: text("name").notNull(),
    glyphCount: integer("glyph_count").notNull().default(0),
    settings: jsonb("settings").$type<Record<string, number | string>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("handwriting_profile_user_idx").on(t.userId)],
);

export const handwritingGlyph = pgTable(
  "handwriting_glyph",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => handwritingProfile.id, { onDelete: "cascade" }),
    char: text("char").notNull(),
    variant: integer("variant").notNull(),
    png: bytea("png").notNull(),
    // Glyph size in em units (1 em = the template's writing-box height)
    width: real("width").notNull(),
    height: real("height").notNull(),
    // Distance from the glyph's top edge to the writing baseline, in em units (1 = cell x-height box)
    baseline: real("baseline").notNull(),
    // Left offset and advance, in em units
    advance: real("advance").notNull(),
  },
  (t) => [uniqueIndex("handwriting_glyph_uq").on(t.profileId, t.char, t.variant)],
);

// ─── Attachments ─────────────────────────────────────────────────────────────
// Files added in the composer. Uploaded before the message is sent (conversation_id is set
// once it is), so unsent uploads can be cleaned up later. Text is extracted on upload.
export const attachment = pgTable(
  "attachment",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    conversationId: text("conversation_id").references(() => conversation.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mediaType: text("media_type").notNull(),
    kind: text("kind", { enum: ["image", "pdf", "text", "file"] }).notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    text: text("text"),
    createdAt: createdAt(),
  },
  (t) => [index("attachment_user_idx").on(t.userId, t.createdAt)],
);

// ─── Usage (for upcoming plan limits) ────────────────────────────────────────
export const usageDaily = pgTable(
  "usage_daily",
  {
    userId: userRef(),
    day: text("day").notNull(), // YYYY-MM-DD (UTC)
    requests: integer("requests").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

// ─── Opal Code: machines, projects, threads ──────────────────────────────────
export const codeMachine = pgTable(
  "code_machine",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    name: text("name").notNull(),
    os: text("os").notNull().default(""),
    hostname: text("hostname").notNull().default(""),
    projectsRoot: text("projects_root").notNull(),
    tokenHash: text("token_hash").notNull(),
    agents: jsonb("agents").$type<{ id: string; version: string | null; ok: boolean; note?: string; signedIn?: boolean }[]>().notNull().default([]),
    runnerVersion: text("runner_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("code_machine_user_idx").on(t.userId), uniqueIndex("code_machine_token_uq").on(t.tokenHash)],
);

export const codePairing = pgTable("code_pairing", {
  code: text("code").primaryKey(),
  userId: userRef(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const codeProject = pgTable(
  "code_project",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    machineId: text("machine_id")
      .notNull()
      .references(() => codeMachine.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    path: text("path").notNull(),
    isGit: boolean("is_git").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("code_project_user_idx").on(t.userId), uniqueIndex("code_project_path_uq").on(t.machineId, t.path)],
);

export const codeThread = pgTable(
  "code_thread",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    machineId: text("machine_id")
      .notNull()
      .references(() => codeMachine.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => codeProject.id, { onDelete: "set null" }),
    title: text("title").notNull().default("New thread"),
    agent: text("agent").notNull(), // claude | codex
    model: text("model"),
    mode: text("mode", { enum: ["auto", "ask", "full"] }).notNull().default("auto"),
    status: text("status", { enum: ["idle", "working", "waiting", "error"] }).notNull().default("idle"),
    cwd: text("cwd").notNull(),
    branch: text("branch"),
    baseBranch: text("base_branch"),
    worktree: boolean("worktree").notNull().default(false),
    providerSessionId: text("provider_session_id"),
    parentThreadId: text("parent_thread_id"),
    groupId: text("group_id"),
    prUrl: text("pr_url"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("code_thread_user_idx").on(t.userId, t.lastActivityAt)],
);

export const codeItem = pgTable(
  "code_item",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => codeThread.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.id] }), index("code_item_seq_idx").on(t.threadId, t.seq)],
);

/** Opal Code skills: instructions for coding agents, separate from Opal chat skills. */
export const codeSkill = pgTable(
  "code_skill",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    instructions: text("instructions").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("code_skill_name_uq").on(t.userId, t.name)],
);

export type CodeMachine = typeof codeMachine.$inferSelect;
export type CodeSkill = typeof codeSkill.$inferSelect;
export type CodeProject = typeof codeProject.$inferSelect;
export type CodeThread = typeof codeThread.$inferSelect;

export type Agent = typeof agent.$inferSelect;
export type Conversation = typeof conversation.$inferSelect;
export type Artifact = typeof artifact.$inferSelect;
export type Memory = typeof memory.$inferSelect;
export type Skill = typeof skill.$inferSelect;
