// What makes Opal the user's own: memories it keeps across chats, and skills (reusable
// instructions) it loads when a task fits. Both reach the model through the system prompt
// (memories in full, skills as name + description) and a few small tools.
import { tool, type ToolSet } from "ai";
import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../db";
import { memory, skill, userSettings } from "../db/schema";
import type { RunContext } from "./context";

export const MEMORY_LIMITS = { perUser: 300, chars: 500, promptChars: 6000 };
export const SKILL_LIMITS = { perUser: 50, name: 40, description: 240, instructions: 12_000 };

export type Personal = { memoryEnabled: boolean; memories: { id: string; content: string }[]; skills: { name: string; description: string }[] };

export async function loadPersonal(userId: string): Promise<Personal> {
  const [[s], memories, skills] = await Promise.all([
    db.select({ memoryEnabled: userSettings.memoryEnabled }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
    db.select({ id: memory.id, content: memory.content }).from(memory).where(eq(memory.userId, userId)).orderBy(asc(memory.createdAt)),
    db
      .select({ name: skill.name, description: skill.description })
      .from(skill)
      .where(and(eq(skill.userId, userId), eq(skill.enabled, true)))
      .orderBy(asc(skill.name)),
  ]);
  return { memoryEnabled: s?.memoryEnabled ?? true, memories, skills };
}

/** The part of the system prompt about memories and skills. */
export function personalPrompt(p: Personal, userName: string): string {
  const out: string[] = [];
  if (p.memoryEnabled) {
    let used = 0;
    const lines: string[] = [];
    // Newest win when the list is too long for the prompt.
    for (const m of [...p.memories].reverse()) {
      const line = `- [${m.id}] ${m.content}`;
      if (used + line.length > MEMORY_LIMITS.promptChars) break;
      used += line.length;
      lines.unshift(line);
    }
    out.push(
      `MEMORY. You remember things about ${userName} across chats.${lines.length ? `\n${lines.join("\n")}` : " Nothing saved yet."}
- Use what you remember when it helps; don't recite it.
- Save with remember when ${userName} shares a lasting fact or preference (name, school, projects, how they like answers) or asks you to remember something. One short sentence each, no duplicates.
- Never save passwords, keys, or sensitive details (health, finances) unless asked. Use forget when something is wrong or ${userName} asks.`,
    );
  }
  if (p.skills.length) {
    out.push(
      `SKILLS. Before a task that fits one of these, call use_skill with its name and follow what it says:\n${p.skills
        .map((s) => `- ${s.name}: ${s.description || "(no description)"}`)
        .join("\n")}`,
    );
  }
  return out.length ? `\n\n${out.join("\n\n")}` : "";
}

export function personalTools(ctx: RunContext, p: Personal): ToolSet {
  const tools: ToolSet = {};
  if (p.memoryEnabled) {
    tools.remember = tool({
      description: "Save a lasting fact or preference about the user to memory, as one short sentence.",
      inputSchema: z.object({ fact: z.string().min(3).max(MEMORY_LIMITS.chars) }),
      execute: async ({ fact }) => {
        const content = fact.trim();
        const [dupe] = await db
          .select({ id: memory.id })
          .from(memory)
          .where(and(eq(memory.userId, ctx.userId), sql`lower(${memory.content}) = lower(${content})`))
          .limit(1);
        if (dupe) return { ok: true, id: dupe.id, fact: content, note: "Already remembered" };
        const count = await db.$count(memory, eq(memory.userId, ctx.userId));
        if (count >= MEMORY_LIMITS.perUser) return { ok: false, error: "Memory is full. Ask the user to remove some memories in Customization." };
        const id = nanoid(10);
        await db.insert(memory).values({ id, userId: ctx.userId, content, source: "opal" });
        return { ok: true, id, fact: content };
      },
    });
    tools.forget = tool({
      description: "Remove a memory by its id (shown in brackets in your memory list).",
      inputSchema: z.object({ id: z.string().max(40) }),
      execute: async ({ id }) => {
        const [row] = await db
          .delete(memory)
          .where(and(eq(memory.id, id), eq(memory.userId, ctx.userId)))
          .returning({ content: memory.content });
        return row ? { ok: true, fact: row.content } : { ok: false, error: "No memory with that id" };
      },
    });
  }
  if (p.skills.length) {
    tools.use_skill = tool({
      description: "Load a skill's full instructions by name. Follow them for the rest of the task.",
      inputSchema: z.object({ name: z.string().max(SKILL_LIMITS.name) }),
      execute: async ({ name }) => {
        const [row] = await db
          .select({ name: skill.name, instructions: skill.instructions })
          .from(skill)
          .where(and(eq(skill.userId, ctx.userId), eq(skill.enabled, true), sql`lower(${skill.name}) = lower(${name.trim()})`))
          .limit(1);
        if (!row) return { ok: false, error: `No skill named ${name}. Skills: ${p.skills.map((s) => s.name).join(", ")}` };
        return { ok: true, name: row.name, instructions: row.instructions };
      },
    });
  }
  return tools;
}

/**
 * "/Skill name" at the start of a user message (picked from the composer's / menu) becomes an
 * explicit instruction to load that skill. The stored message keeps the short form for the chip.
 */
export function expandSkillCommands<M extends { role: string; parts: { type: string; text?: string }[] }>(messages: M[], p: Personal): M[] {
  const names = [...p.skills.map((s) => s.name)].sort((a, b) => b.length - a.length);
  if (!names.length) return messages;
  return messages.map((m) => {
    if (m.role !== "user") return m;
    const i = m.parts.findIndex((x) => x.type === "text");
    const text = i >= 0 ? (m.parts[i].text ?? "") : "";
    if (!text.startsWith("/")) return m;
    const lower = text.toLowerCase();
    const name = names.find((n) => {
      const tok = `/${n.toLowerCase()}`;
      return lower.startsWith(tok) && (lower.length === tok.length || /\s/.test(lower[tok.length]));
    });
    if (!name) return m;
    const rest = text.slice(name.length + 1).trim();
    const parts = [...m.parts];
    parts[i] = { ...parts[i], text: `[The user picked the "${name}" skill: call use_skill("${name}") first and follow it.]\n${rest || `Run the ${name} skill.`}` };
    return { ...m, parts };
  });
}
