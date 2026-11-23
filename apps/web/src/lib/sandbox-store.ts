"use client";
// Live frames from agents' computers, pushed through transient stream parts.
import { useSyncExternalStore } from "react";
import type { SandboxFrame } from "./types";

type State = { frames: Record<string, SandboxFrame & { terminalLog: SandboxFrame["terminal"][] }>; open: boolean; focus?: string };

let state: State = { frames: {}, open: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function pushFrame(f: SandboxFrame) {
  const prev = state.frames[f.agentId];
  const terminalLog = [...(prev?.terminalLog ?? []), ...(f.terminal ? [f.terminal] : [])].slice(-30);
  state = {
    ...state,
    focus: state.focus ?? f.agentId,
    frames: {
      ...state.frames,
      [f.agentId]: {
        ...prev,
        ...f,
        screenshot: f.screenshot ?? prev?.screenshot,
        url: f.url ?? prev?.url,
        title: f.title ?? prev?.title,
        terminalLog,
      },
    },
  };
  emit();
}

export function setPanel(open: boolean, focus?: string) {
  state = { ...state, open, focus: focus ?? state.focus };
  emit();
}

export function resetSandboxes() {
  state = { frames: {}, open: false };
  emit();
}

export function useSandboxes() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state,
  );
}
