"use client";

import { createContext, useContext } from "react";

export type ChatActions = {
  nerd: boolean;
  send: (text: string) => void;
  approve: (approvalId: string, approved: boolean) => void;
  answerTool: (tool: "request_secret" | "ask_user", toolCallId: string, output: Record<string, unknown>) => void;
  regenerate: () => void;
  openSandbox: (agentId: string) => void;
};

const Ctx = createContext<ChatActions | null>(null);

export const ChatActionsProvider = Ctx.Provider;

export function useChatActions(): ChatActions {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChatActions outside ChatActionsProvider");
  return v;
}
