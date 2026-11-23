"use client";

import useSWR, { mutate } from "swr";
import { apiFetch, fetcher } from "./api";
import type { ModelInfoView } from "./client-types";
import type { AccentId } from "./accents";

export type ConversationRow = {
  id: string;
  title: string;
  mode: "chat" | "study";
  agentId: string | null;
  pinned: boolean;
  updatedAt: string;
};

export type SettingsResponse = {
  user: { id: string; name: string; email: string; image?: string | null; role: string };
  settings: { nerdMode: boolean; theme: "system" | "light" | "dark"; model: string | null; memoryEnabled: boolean; accent: AccentId };
  models: ModelInfoView[];
  defaultModel: string;
  status: { connectors: boolean; sandbox: boolean; ai: boolean; search: boolean };
};

export type AgentRow = {
  id: string;
  name: string;
  color: string;
  shape: string;
  threadId: string | null;
  running: boolean;
  /** Last message in its thread, one line. */
  preview: string;
  activityAt: string;
};

export function useConversations() {
  return useSWR<{ conversations: ConversationRow[] }>("/api/conversations", fetcher, { revalidateOnFocus: false });
}

export const refreshConversations = () => mutate("/api/conversations");

export function patchConversationTitle(id: string, title: string) {
  return mutate<{ conversations: ConversationRow[] }>(
    "/api/conversations",
    (d) => (d ? { conversations: d.conversations.map((c) => (c.id === id ? { ...c, title } : c)) } : d),
    { revalidate: false },
  );
}

export function useSettings() {
  return useSWR<SettingsResponse>("/api/settings", fetcher, { revalidateOnFocus: false });
}

export async function updateSettings(patch: Partial<SettingsResponse["settings"]>) {
  await mutate<SettingsResponse>(
    "/api/settings",
    async (current) => {
      await apiFetch("/api/settings", { method: "PATCH", json: patch });
      return current ? { ...current, settings: { ...current.settings, ...patch } } : current;
    },
    { optimisticData: (c) => (c ? { ...c, settings: { ...c.settings, ...patch } } : (c as never)), revalidate: false },
  );
}

export function useAgents(opts: { live?: boolean } = {}) {
  // `live`: the Agents tab polls so "working" and the last message stay current.
  return useSWR<{ agents: AgentRow[] }>("/api/agents", fetcher, { revalidateOnFocus: false, refreshInterval: opts.live ? 5000 : 0 });
}

export const refreshAgents = () => mutate("/api/agents");

export type SkillRow = { id: string; name: string; description: string; instructions: string; enabled: boolean; updatedAt: string };

export function useSkills() {
  return useSWR<{ skills: SkillRow[] }>("/api/skills", fetcher, { revalidateOnFocus: false });
}

export const refreshSkills = () => mutate("/api/skills");
