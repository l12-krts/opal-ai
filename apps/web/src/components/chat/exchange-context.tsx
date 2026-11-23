"use client";
// Who "speaks" in the thread being rendered (Opal, or the agent whose thread it is), and how to
// open the full conversation between two of them.
import { createContext, useContext } from "react";
import type { AgentSender } from "@/lib/types";

export type AgentIdentity = { id: string; name: string; color: string; shape?: string; ephemeral?: boolean };

export type ExchangeTarget = {
  /** The agent that was messaged. */
  agent: AgentIdentity;
  /** Its thread. */
  threadId?: string;
  /** Who messaged it: the other side of the conversation. */
  from: AgentSender;
  runId?: string;
  /** Fallbacks when the thread can't be loaded. */
  task?: string;
  reply?: string;
};

type Open = (target: ExchangeTarget, origin?: HTMLElement | null) => void;

const OpenCtx = createContext<Open | null>(null);
/** The speaker of the thread being rendered; `threadId` is set when it is an agent's thread. */
export type Owner = AgentSender & { threadId?: string };

const OwnerCtx = createContext<Owner>({ key: "opal:", kind: "opal", name: "Opal" });

export const ExchangeOpenProvider = OpenCtx.Provider;
export const OwnerProvider = OwnerCtx.Provider;
export const useOpenExchange = () => useContext(OpenCtx);
export const useOwner = () => useContext(OwnerCtx);
