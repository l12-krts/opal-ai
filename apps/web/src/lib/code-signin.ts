"use client";
// Which agent sign-in the side panel shows, if any. Any "Sign in" button in Opal Code opens it.
import { useSyncExternalStore } from "react";

export type SignInTarget = { machineId: string; agent: "claude" | "codex" };

let state: SignInTarget | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openSignIn(t: SignInTarget) {
  state = t;
  emit();
}

export function closeSignIn() {
  state = null;
  emit();
}

export function useSignIn() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => null,
  );
}

/** Installed but signed out: the case a "Sign in" button can fix. */
export const needsSignIn = (a?: { id: string; signedIn?: boolean }) => a?.signedIn === false && (a.id === "claude" || a.id === "codex");
