"use client";
// Live state of agent runs in the open chat. The server relays each run's UI stream in batches
// (data-agent-chunks); here they are rebuilt into a message per run, so an agent's conversation
// can be watched as it happens. Run status cards (data-agent) are kept by run and by tool call.
import { useSyncExternalStore } from "react";
import { readUIMessageStream, type UIMessageChunk } from "ai";
import type { AgentChunks, AgentRunView, OpalUIMessage } from "./types";

export type LiveRun = { view?: AgentRunView; message?: OpalUIMessage };
type State = { runs: Record<string, LiveRun>; byToolCall: Record<string, string> };

let state: State = { runs: {}, byToolCall: {} };
let generation = 0;
const listeners = new Set<() => void>();
const streams = new Map<string, ReadableStreamDefaultController<UIMessageChunk>>();
const latest = new Map<string, OpalUIMessage>();
const dirty = new Set<string>();
let frame = 0;

function flush() {
  frame = 0;
  if (dirty.size) {
    const runs = { ...state.runs };
    for (const id of dirty) {
      const m = latest.get(id);
      // Copy so memoised renderers see a new message (the reader mutates its snapshot in place).
      if (m) runs[id] = { ...runs[id], message: { ...m, parts: m.parts.map((p) => ({ ...p })) as OpalUIMessage["parts"] } };
    }
    dirty.clear();
    state = { ...state, runs };
  }
  listeners.forEach((l) => l());
}

function schedule() {
  if (frame) return;
  frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
}

function close(runId: string) {
  const c = streams.get(runId);
  if (!c) return;
  streams.delete(runId);
  try {
    c.close();
  } catch {}
}

export function pushRunView(view: AgentRunView) {
  state = {
    runs: { ...state.runs, [view.runId]: { ...state.runs[view.runId], view } },
    byToolCall: view.toolCallId ? { ...state.byToolCall, [view.toolCallId]: view.runId } : state.byToolCall,
  };
  if (view.status !== "running") close(view.runId);
  schedule();
}

export function pushRunChunks({ runId, chunks }: AgentChunks) {
  let c = streams.get(runId);
  if (!c) {
    const gen = generation;
    let ctrl!: ReadableStreamDefaultController<UIMessageChunk>;
    const stream = new ReadableStream<UIMessageChunk>({ start: (x) => void (ctrl = x) });
    streams.set(runId, ctrl);
    c = ctrl;
    void (async () => {
      try {
        for await (const m of readUIMessageStream<OpalUIMessage>({ stream, terminateOnError: false })) {
          if (gen !== generation) return;
          latest.set(runId, m);
          dirty.add(runId);
          schedule();
        }
      } catch {
        // A broken relay only affects the live view; the thread is saved on the server.
      }
    })();
  }
  for (const ch of chunks) {
    try {
      c.enqueue(ch as UIMessageChunk);
    } catch {}
  }
}

export function resetAgentLive() {
  generation++;
  for (const id of [...streams.keys()]) close(id);
  latest.clear();
  dirty.clear();
  state = { runs: {}, byToolCall: {} };
  schedule();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAgentLive(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function useRunByToolCall(toolCallId: string | undefined): LiveRun | undefined {
  const s = useAgentLive();
  const runId = toolCallId ? s.byToolCall[toolCallId] : undefined;
  return runId ? s.runs[runId] : undefined;
}
