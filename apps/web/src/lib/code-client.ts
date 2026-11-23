"use client";

// Opal Code on the client: one SWR cache for machines/projects/threads, one per open thread, and
// a single live SSE connection that patches both.
import { useEffect } from "react";
import useSWR, { mutate } from "swr";
import { apiFetch, fetcher } from "./api";
import type { CodeItem, CodeLiveEvent, CodeSettings, CodeSkillView, CodeState, ThreadView } from "./code-types";

export const STATE_KEY = "/api/code/state";
export const threadKey = (id: string) => `/api/code/threads/${id}`;

export type ThreadResponse = { thread: ThreadView; items: CodeItem[] };

export function useCodeState() {
  return useSWR<CodeState>(STATE_KEY, fetcher, { revalidateOnFocus: true, refreshInterval: 60_000 });
}

export function useThread(id: string | null) {
  return useSWR<ThreadResponse>(id ? threadKey(id) : null, fetcher, { revalidateOnFocus: true });
}

const sortThreads = (list: ThreadView[]) => list.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

const terminalListeners = new Map<string, (data: string | null) => void>();
export function onTerminal(termId: string, fn: (data: string | null) => void) {
  terminalListeners.set(termId, fn);
  return () => terminalListeners.delete(termId);
}

function apply(ev: CodeLiveEvent) {
  switch (ev.type) {
    case "thread": {
      const t = ev.thread;
      void mutate<CodeState>(
        STATE_KEY,
        (s) => {
          if (!s) return s;
          const prev = s.threads.find((x) => x.id === t.id);
          const next = { ...t, preview: t.preview ?? prev?.preview ?? null };
          return { ...s, threads: sortThreads([next, ...s.threads.filter((x) => x.id !== t.id)]) };
        },
        { revalidate: false },
      );
      void mutate<ThreadResponse>(threadKey(t.id), (r) => (r ? { ...r, thread: { ...t, preview: r.thread.preview } } : r), { revalidate: false });
      return;
    }
    case "thread-deleted":
      void mutate<CodeState>(STATE_KEY, (s) => (s ? { ...s, threads: s.threads.filter((x) => x.id !== ev.threadId) } : s), { revalidate: false });
      return;
    case "item": {
      void mutate<ThreadResponse>(
        threadKey(ev.threadId),
        (r) => {
          if (!r) return r;
          const i = r.items.findIndex((x) => x.id === ev.item.id);
          const items = i >= 0 ? r.items.map((x, j) => (j === i ? ev.item : x)) : [...r.items, ev.item].sort((a, b) => a.seq - b.seq);
          return { ...r, items };
        },
        { revalidate: false },
      );
      if (ev.item.kind === "assistant" || ev.item.kind === "user") {
        const text = ev.item.text.replace(/\s+/g, " ").slice(0, 160);
        void mutate<CodeState>(
          STATE_KEY,
          (s) => (s ? { ...s, threads: s.threads.map((t) => (t.id === ev.threadId ? { ...t, preview: text } : t)) } : s),
          { revalidate: false },
        );
      }
      return;
    }
    case "machine":
      void mutate<CodeState>(
        STATE_KEY,
        (s) => (s ? { ...s, machines: s.machines.some((m) => m.id === ev.machine.id) ? s.machines.map((m) => (m.id === ev.machine.id ? ev.machine : m)) : [...s.machines, ev.machine] } : s),
        { revalidate: false },
      );
      return;
    case "terminal":
      terminalListeners.get(ev.termId)?.(ev.data);
      return;
    case "terminal-exit":
      terminalListeners.get(ev.termId)?.(null);
      return;
  }
}

/** Keeps one live connection open while Opal Code is on screen. */
export function useCodeLive() {
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    const connect = () => {
      es = new EventSource("/api/code/events");
      es.onmessage = (m) => {
        try {
          const ev = JSON.parse(m.data) as CodeLiveEvent | { type: "hello" };
          if (ev.type === "hello") void mutate(STATE_KEY);
          else apply(ev);
        } catch {}
      };
      es.onerror = () => {
        es?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      es?.close();
    };
  }, []);
}

export async function patchThread(id: string, patch: Record<string, unknown>) {
  await apiFetch(threadKey(id), { method: "PATCH", json: patch });
}

/** Snooze presets, T3 Code style. */
export function snoozeOptions(now = new Date()) {
  const at = (d: Date, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x;
  };
  const evening = at(now, 18);
  const tomorrow = at(new Date(now.getTime() + 86_400_000), 9);
  const monday = at(new Date(now.getTime() + (((8 - now.getDay()) % 7) || 7) * 86_400_000), 9);
  return [
    { id: "1h", label: "For an hour", until: new Date(now.getTime() + 3_600_000) },
    ...(evening > now ? [{ id: "evening", label: "Until this evening", until: evening }] : []),
    { id: "tomorrow", label: "Until tomorrow", until: tomorrow },
    { id: "week", label: "Until next week", until: monday },
  ];
}

export function relTime(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Opal Code settings and skills (separate from Opal chat's) ──────────────
export const CODE_SETTINGS_KEY = "/api/code/settings";
export const CODE_SKILLS_KEY = "/api/code/skills";

export function useCodeSettings() {
  return useSWR<{ settings: CodeSettings }>(CODE_SETTINGS_KEY, fetcher, { revalidateOnFocus: false });
}

export async function updateCodeSettings(patch: Partial<CodeSettings>) {
  await mutate<{ settings: CodeSettings }>(
    CODE_SETTINGS_KEY,
    async () => apiFetch<{ settings: CodeSettings }>(CODE_SETTINGS_KEY, { method: "PATCH", json: patch }),
    { optimisticData: (c) => ({ settings: { ...(c?.settings as CodeSettings), ...patch } }), revalidate: false },
  );
}

export function useCodeSkills() {
  return useSWR<{ skills: CodeSkillView[] }>(CODE_SKILLS_KEY, fetcher, { revalidateOnFocus: false });
}
