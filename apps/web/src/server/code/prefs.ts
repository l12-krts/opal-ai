// Opal Code preferences and skills. Both are separate from Opal chat's settings and skills.
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "../http";
import { db } from "../db";
import { codeSkill, userSettings, type CodeSkill } from "../db/schema";
import { codeSettingsOf, type CodeSettings, type CodeSkillView } from "@/lib/code-types";

export async function loadCodeSettings(userId: string): Promise<CodeSettings> {
  const [s] = await db.select({ code: userSettings.codeSettings }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return codeSettingsOf(s?.code);
}

export async function saveCodeSettings(userId: string, patch: Partial<CodeSettings>): Promise<CodeSettings> {
  const next = codeSettingsOf({ ...(await loadCodeSettings(userId)), ...patch });
  await db
    .insert(userSettings)
    .values({ userId, codeSettings: next })
    .onConflictDoUpdate({ target: userSettings.userId, set: { codeSettings: next, updatedAt: new Date() } });
  return next;
}

export const skillView = (s: CodeSkill): CodeSkillView => ({ id: s.id, name: s.name, description: s.description, instructions: s.instructions, enabled: s.enabled });

export async function listCodeSkills(userId: string) {
  return db.select().from(codeSkill).where(eq(codeSkill.userId, userId)).orderBy(asc(codeSkill.name));
}

/** A leading "/Skill name" in a message, matched against the user's enabled Code skills. */
export async function skillFromText(userId: string, text: string): Promise<CodeSkill | null> {
  if (!text.startsWith("/")) return null;
  const skills = (await db.select().from(codeSkill).where(and(eq(codeSkill.userId, userId), eq(codeSkill.enabled, true))))
    .sort((a, b) => b.name.length - a.name.length);
  const lower = text.toLowerCase();
  return skills.find((s) => {
    const tok = `/${s.name.toLowerCase()}`;
    return lower.startsWith(tok) && (lower.length === tok.length || /\s/.test(lower[tok.length]));
  }) ?? null;
}

export const SkillFields = {
  name: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u, "Letters, numbers, spaces, dots, dashes or underscores"),
  description: z.string().trim().max(240),
  instructions: z.string().trim().min(10).max(12_000),
  enabled: z.boolean(),
};

export async function assertFreeName(userId: string, name: string, except?: string) {
  const rows = await db.select({ id: codeSkill.id, name: codeSkill.name }).from(codeSkill).where(eq(codeSkill.userId, userId));
  if (rows.some((r) => r.id !== except && r.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, "exists", `You already have a skill called ${name}`);
}

export async function ownSkill(userId: string, id: string) {
  const [s] = await db.select().from(codeSkill).where(and(eq(codeSkill.id, id), eq(codeSkill.userId, userId))).limit(1);
  if (!s) throw new ApiError(404, "not_found", "Skill not found");
  return s;
}
