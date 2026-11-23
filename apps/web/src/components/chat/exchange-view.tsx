"use client";
// The full conversation between two agents (or Opal and an agent). It grows out of the message
// that was clicked and shrinks back into it on Back. Layers stack: an agent's own messages to
// other agents open further layers on top.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "krts.ui";
import { IconArrowLeft, IconArrowUpRight, IconBookmark, IconDeviceDesktop } from "@tabler/icons-react";
import type { AgentRunView, OpalUIMessage } from "@/lib/types";
import { fetcher, apiFetch } from "@/lib/api";
import { useAgentLive, type LiveRun } from "@/lib/agent-live";
import { refreshAgents } from "@/lib/hooks";
import { setPanel } from "@/lib/sandbox-store";
import { AgentFace, SenderFace } from "../agent-face";
import { IconButton } from "../ui";
import { AssistantMessage } from "./message";
import { OwnerProvider, type ExchangeTarget, type Owner } from "./exchange-context";

export type ExchangeLayer = ExchangeTarget & { key: string; clip: string };

const FULL = "inset(0px 0px 0px 0px round 0px)";
const EASE = [0.32, 0.72, 0, 1] as const;

/** clip-path that covers just `el` inside `container`: where a layer grows from and returns to. */
export function clipFrom(el: HTMLElement | null | undefined, container: HTMLElement | null): string {
  if (!el || !container) return "inset(42% 18% 42% 18% round 14px)";
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  const z = (n: number) => Math.max(0, Math.round(n));
  return `inset(${z(r.top - c.top)}px ${z(c.right - r.right)}px ${z(c.bottom - r.bottom)}px ${z(r.left - c.left)}px round 12px)`;
}

export function ExchangeStack({ layers, onBack }: { layers: ExchangeLayer[]; onBack: () => void }) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!layers.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Leave Escape to menus and dialogs that are open on top.
      if (document.querySelector("[role=dialog], [role=menu], [role=listbox]")) return;
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layers.length, onBack]);

  return (
    <AnimatePresence>
      {layers.map((l) => (
        <motion.section
          key={l.key}
          aria-label={`Conversation between ${l.from.name} and ${l.agent.name}`}
          className="absolute inset-0 z-30 flex flex-col bg-bg"
          initial={reduce ? { opacity: 0 } : { clipPath: l.clip, opacity: 0.5 }}
          animate={reduce ? { opacity: 1 } : { clipPath: FULL, opacity: 1 }}
          exit={
            reduce
              ? { opacity: 0, transition: { duration: 0.15 } }
              : { clipPath: l.clip, opacity: 0, transition: { duration: 0.36, ease: EASE, opacity: { duration: 0.16, delay: 0.2 } } }
          }
          transition={{ duration: 0.44, ease: EASE, opacity: { duration: 0.18 } }}
        >
          <ExchangeView layer={l} onBack={onBack} />
        </motion.section>
      ))}
    </AnimatePresence>
  );
}

type ConversationResponse = {
  conversation: { id: string; agent: { id: string; name: string; color: string; shape?: string; ephemeral?: boolean } | null };
  messages: OpalUIMessage[];
};

function ExchangeView({ layer, onBack }: { layer: ExchangeLayer; onBack: () => void }) {
  const { agent, threadId, from } = layer;
  const live = useAgentLive();
  const runs = useMemo(
    () => Object.values(live.runs).filter((r): r is LiveRun & { view: AgentRunView } => Boolean(r.view && r.view.threadId === threadId && r.view.from?.key === from.key)),
    [live.runs, threadId, from.key],
  );
  const running = runs.filter((r) => r.view.status === "running");
  const finished = runs.length - running.length;

  const { data, mutate } = useSWR<ConversationResponse>(threadId ? `/api/conversations/${threadId}` : null, fetcher, {
    refreshInterval: running.length ? 3000 : 0,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  // The thread is saved when a run ends; fetch it again then.
  useEffect(() => {
    if (finished) void mutate();
  }, [finished, mutate]);

  const messages = useMemo(() => exchangeMessages(data?.messages ?? [], runs, layer), [data?.messages, runs, layer]);
  const info = data?.conversation.agent;
  const self = { ...agent, ...(info ?? {}) };
  const owner: Owner = { key: `agent:${self.id}`, kind: "agent", name: self.name, color: self.color, shape: self.shape, agentId: self.id, threadId };
  const runningIds = new Set(running.map((r) => r.view.runId));
  const current = running[running.length - 1]?.view.current;
  const lastInbound = [...messages].reverse().find((m) => m.role === "user");
  const awaiting =
    lastInbound && running.some((r) => r.view.runId === lastInbound.metadata?.run?.runId) && !messages.some((m) => m.id === `run_${lastInbound.metadata?.run?.runId}`);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(running.length > 0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const anchor = layer.runId ? el.querySelector<HTMLElement>(`[data-run="${layer.runId}"]`) : null;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else if (anchor) el.scrollTop = Math.max(0, anchor.offsetTop - 16);
    // only when the view opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(data)]);
  useEffect(() => {
    const el = scroller.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  return (
    <OwnerProvider value={owner}>
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line-subtle px-2">
        <IconButton label="Back" shortcut="Esc" onPress={onBack}>
          <IconArrowLeft size={18} stroke={1.5} />
        </IconButton>
        <AgentFace shape={self.shape} color={self.color} size={24} working={running.length > 0} seed={self.name} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[14px] font-medium">{self.name}</p>
          <p className="flex items-center gap-1 truncate text-[12px] text-fg-muted">
            with <SenderFace sender={from} size={12} /> {from.name}
          </p>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-0.5">
          {running.length > 0 && <span className="shimmer-text mr-2 hidden truncate text-[12.5px] sm:inline">{current ?? "Working"}</span>}
          {self.id && (
            <IconButton label={`${self.name}'s computer`} onPress={() => setPanel(true, self.id)}>
              <IconDeviceDesktop size={17} stroke={1.5} />
            </IconButton>
          )}
          {self.id && self.ephemeral && <SaveAgent agent={self} />}
          {self.id && self.ephemeral === false && (
            <Link
              href={`/agents/${self.id}`}
              className="pressable inline-flex h-7 items-center gap-1 rounded-[8px] px-2 text-[13px] text-fg-muted hover:bg-surface hover:text-fg"
            >
              Open {self.name}
              <IconArrowUpRight size={14} stroke={1.5} />
            </Link>
          )}
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current!;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.08, ease: [0.23, 1, 0.32, 1] }}
          className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-5 pb-12 pt-6"
        >
          {threadId && !data && !messages.length && <p className="text-[13px] text-fg-muted">Loading the conversation…</p>}
          {messages.map((m) =>
            m.role === "user" ? (
              <Sent key={m.id} message={m} />
            ) : (
              <div key={m.id} className="flex flex-col gap-2">
                <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
                  <AgentFace shape={self.shape} color={self.color} size={15} seed={self.name} />
                  {self.name}
                </span>
                <AssistantMessage message={m} isLast={false} streaming={runningIds.has(m.metadata?.run?.runId ?? "")} errored={false} />
              </div>
            ),
          )}
          {awaiting && (
            <span className="flex items-center gap-2 text-[14px]">
              <AgentFace shape={self.shape} color={self.color} size={16} working seed={self.name} />
              <span className="shimmer-text">{current ?? `${self.name} is thinking`}</span>
            </span>
          )}
        </motion.div>
      </div>
    </OwnerProvider>
  );
}

/** A message the orchestrator sent: on the right, like the user's own messages, with who sent it. */
function Sent({ message }: { message: OpalUIMessage }) {
  const from = message.metadata?.from;
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n");
  return (
    <div data-run={message.metadata?.run?.runId} className="flex flex-col items-end gap-1.5">
      {from && (
        <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
          <SenderFace sender={from} size={15} />
          {from.name}
        </span>
      )}
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble bg-bubble px-4 py-2.5 text-[15px] leading-6">{text}</div>
    </div>
  );
}

/** The thread's messages between these two, with live runs merged in. */
function exchangeMessages(saved: OpalUIMessage[], runs: (LiveRun & { view: AgentRunView })[], layer: ExchangeLayer): OpalUIMessage[] {
  const key = layer.from.key;
  const all = [...saved];
  for (const r of runs) {
    const v = r.view;
    const run = { runId: v.runId, fromKey: v.from?.key ?? key };
    if (!all.some((m) => m.id === `in_${v.runId}`)) {
      all.push({ id: `in_${v.runId}`, role: "user", parts: [{ type: "text", text: v.task }], metadata: { from: v.from, run } });
    }
    if (r.message) {
      const reply = { ...r.message, metadata: { ...r.message.metadata, run } };
      const i = all.findIndex((m) => m.id === reply.id);
      if (i >= 0) all[i] = reply;
      else all.push(reply);
    }
  }
  const between = all.filter((m) => (m.role === "user" ? m.metadata?.from?.key : m.metadata?.run?.fromKey) === key);
  if (between.length) return between;
  // Nothing saved yet (or an older chat): show what the message row knew.
  if (layer.task) {
    const out: OpalUIMessage[] = [{ id: "task", role: "user", parts: [{ type: "text", text: layer.task }], metadata: { from: layer.from } }];
    if (layer.reply) out.push({ id: "reply", role: "assistant", parts: [{ type: "text", text: layer.reply }], metadata: {} });
    return out;
  }
  return all;
}

function SaveAgent({ agent }: { agent: { id: string; name: string; color: string; shape?: string } }) {
  const [saved, setSaved] = useState(false);
  if (saved) return null;
  return (
    <IconButton
      label="Save to your agents"
      onPress={async () => {
        try {
          await apiFetch("/api/agents", {
            method: "POST",
            json: { fromEphemeralId: agent.id, name: agent.name, color: agent.color, shape: agent.shape ?? "circle" },
          });
          setSaved(true);
          refreshAgents();
          toast.success(`${agent.name} saved to your agents`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    >
      <IconBookmark size={17} stroke={1.5} />
    </IconButton>
  );
}
