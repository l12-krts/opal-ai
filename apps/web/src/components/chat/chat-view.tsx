"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Drawer, Skeleton, toast } from "krts.ui";
import { motion } from "motion/react";
import { IconArrowLeft, IconDeviceDesktop, IconLayoutSidebarRight } from "@tabler/icons-react";
import type { ChatMode, OpalUIMessage } from "@/lib/types";
import { apiFetch, fetcher } from "@/lib/api";
import { patchConversationTitle, refreshAgents, refreshConversations, useSettings } from "@/lib/hooks";
import { pushFrame, resetSandboxes, setPanel, useSandboxes } from "@/lib/sandbox-store";
import { pushRunChunks, pushRunView, resetAgentLive, useAgentLive } from "@/lib/agent-live";
import { t } from "@/lib/i18n";
import { OpalMark } from "../brand";
import { AgentFace } from "../agent-face";
import { IconButton } from "../ui";
import { AgentDetails } from "../agents/agent-details";
import { Composer, type ComposerMessage, type ComposerTools } from "./composer";
import { Thread } from "./thread";
import { SandboxPanel } from "./sandbox-panel";
import { ChatActionsProvider } from "./chat-context";
import { ExchangeOpenProvider, OwnerProvider, type AgentIdentity, type ExchangeTarget, type Owner } from "./exchange-context";
import { clipFrom, ExchangeStack, type ExchangeLayer } from "./exchange-view";
import { useMediaQuery } from "@/lib/use-media-query";

type ConversationResponse = {
  conversation: {
    id: string;
    title: string;
    mode: ChatMode;
    pinned: boolean;
    agent: { id: string; name: string; color: string; shape?: string; ephemeral?: boolean } | null;
  };
  messages: OpalUIMessage[];
};

export type ChatVariant = "chat" | "agent";

export function ChatView({
  id,
  isNew,
  initialMode,
  autoPrompt,
  variant = "chat",
  agent,
  onOpenSettings,
}: {
  id: string;
  isNew: boolean;
  initialMode: ChatMode;
  autoPrompt?: string;
  /** "agent": the agent's one thread, shown in the Agents tab. */
  variant?: ChatVariant;
  agent?: AgentIdentity;
  onOpenSettings?: () => void;
}) {
  const { data, error } = useSWR<ConversationResponse>(isNew ? null : `/api/conversations/${id}`, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  useEffect(() => {
    resetSandboxes();
    resetAgentLive();
  }, [id]);

  if (!isNew && error) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-medium">This chat isn't available</p>
          <p className="mt-1 text-[13px] text-fg-muted">It may have been deleted.</p>
        </div>
      </div>
    );
  }
  if (!isNew && !data) return <ThreadSkeleton />;

  const convAgent = data?.conversation.agent;
  return (
    <ChatSession
      id={id}
      isNew={isNew}
      initialMessages={data?.messages ?? []}
      initialTitle={data?.conversation.title}
      initialMode={data?.conversation.mode ?? initialMode}
      autoPrompt={autoPrompt}
      variant={variant}
      agent={agent ?? (convAgent ? { ...convAgent } : undefined)}
      onOpenSettings={onOpenSettings}
    />
  );
}

export function ThreadSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-6 px-5 pt-20">
      <Skeleton className="ml-auto h-10 w-[45%] rounded-[18px]" />
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-[92%]" />
        <Skeleton className="h-4 w-[85%]" />
        <Skeleton className="h-4 w-[60%]" />
      </div>
    </div>
  );
}

const DETAILS_KEY = "opal.agentDetails";

function ChatSession({
  id,
  isNew,
  initialMessages,
  initialTitle,
  initialMode,
  autoPrompt,
  variant,
  agent,
  onOpenSettings,
}: {
  id: string;
  isNew: boolean;
  initialMessages: OpalUIMessage[];
  initialTitle?: string;
  initialMode: ChatMode;
  autoPrompt?: string;
  variant: ChatVariant;
  agent?: AgentIdentity;
  onOpenSettings?: () => void;
}) {
  const { data: settings } = useSettings();
  const nerd = settings?.settings.nerdMode ?? false;
  const isAgent = variant === "agent" && Boolean(agent);
  const [mode, setMode] = useState<ChatMode>(initialMode);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [model, setModel] = useState<string | null>(null);
  const [tools, setTools] = useState<ComposerTools>({ agents: false, handwriting: false });
  const [queued, setQueued] = useState<ComposerMessage | null>(null);
  const [errorTick, setErrorTick] = useState(0);
  const [layers, setLayers] = useState<ExchangeLayer[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try {
      return localStorage.getItem(DETAILS_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const started = useRef(!isNew);
  const pendingApprovals = useRef(new Set<string>());
  const pendingOutputs = useRef(new Set<string>());
  const extra = useRef({ mode, model, tools });
  extra.current = { mode, model, tools };
  const column = useRef<HTMLDivElement>(null);

  const sandboxes = useSandboxes();
  const live = useAgentLive();
  const wide = useMediaQuery("(min-width: 1024px)");

  const transport = useMemo(
    () =>
      new DefaultChatTransport<OpalUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, trigger }) => {
          const base = { conversationId: id, model: extra.current.model ?? undefined };
          if (trigger === "regenerate-message") return { body: { ...base, regenerate: true } };
          const last = messages[messages.length - 1];
          if (last?.role === "user") {
            return {
              body: {
                ...base,
                mode: extra.current.mode,
                tools: extra.current.tools,
                message: {
                  id: last.id,
                  role: "user",
                  parts: last.parts.flatMap((p): Record<string, unknown>[] =>
                    p.type === "text"
                      ? [{ type: "text", text: p.text }]
                      : p.type === "file"
                        ? [{ type: "file", url: p.url, mediaType: p.mediaType, filename: p.filename }]
                        : [],
                  ),
                },
              },
            };
          }
          const approvals: { approvalId: string; approved: boolean; reason?: string }[] = [];
          const toolOutputs: { toolCallId: string; tool: string; output: unknown }[] = [];
          for (const p of (last?.parts ?? []) as any[]) {
            if (p.state === "approval-responded" && pendingApprovals.current.has(p.approval?.id)) {
              approvals.push({ approvalId: p.approval.id, approved: p.approval.approved, reason: p.approval.reason });
              pendingApprovals.current.delete(p.approval.id);
            }
            if (p.state === "output-available" && pendingOutputs.current.has(p.toolCallId)) {
              toolOutputs.push({ toolCallId: p.toolCallId, tool: String(p.type).replace(/^tool-/, ""), output: p.output });
              pendingOutputs.current.delete(p.toolCallId);
            }
          }
          return { body: { ...base, approvals, toolOutputs } };
        },
      }),
    [id],
  );

  const chat = useChat<OpalUIMessage>({
    id,
    messages: initialMessages,
    transport,
    throttle: 40,
    // A reply keeps running on the server when the chat is left; opening it again reconnects.
    resume: !isNew,
    sendAutomaticallyWhen: ({ messages }) => {
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant") return false;
      const parts = last.parts as any[];
      if (parts.some((p) => p.state === "approval-requested")) return false;
      if (parts.some((p) => (p.type === "tool-request_secret" || p.type === "tool-ask_user") && p.state === "input-available")) return false;
      return (
        parts.some((p) => p.state === "approval-responded" && pendingApprovals.current.has(p.approval?.id)) ||
        parts.some((p) => p.state === "output-available" && pendingOutputs.current.has(p.toolCallId))
      );
    },
    onData: (part) => {
      if (part.type === "data-sandbox") pushFrame(part.data);
      if (part.type === "data-agent") pushRunView(part.data);
      if (part.type === "data-agent-chunks") pushRunChunks(part.data);
      if (part.type === "data-title") {
        setTitle(part.data.title);
        patchConversationTitle(id, part.data.title);
      }
    },
    onFinish: () => {
      refreshConversations();
      if (isAgent) refreshAgents();
    },
    onError: (err) => {
      let msg = err.message;
      try {
        msg = JSON.parse(err.message).message ?? msg;
      } catch {}
      toast.error(t("chat.error"), { description: msg.slice(0, 200) });
      setErrorTick((n) => n + 1);
    },
  });

  const { messages, status, sendMessage, stop: stopLocal, regenerate, addToolApprovalResponse, addToolOutput, setMessages } = chat;
  const busy = status === "submitted" || status === "streaming";
  // Leaving the chat no longer cancels the reply, so Stop has to tell the server.
  const stop = useCallback(() => {
    void stopLocal();
    void apiFetch(`/api/chat/${id}/stream`, { method: "DELETE" }).catch(() => {});
  }, [stopLocal, id]);

  // Auto picks a model for a chat's first reply; the chat then stays on it.
  const lockedModel = useMemo(() => {
    if (isAgent) return null;
    const first = messages.find((m) => m.role === "assistant");
    const route = first?.parts.find((p) => p.type === "data-route") as { data?: { model?: string; auto?: string } } | undefined;
    return route?.data?.auto && route.data.model ? route.data.model : null;
  }, [messages, isAgent]);

  // An agent's thread also receives messages from other chats (Opal and agents messaging it).
  // While idle, pick those up.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useEffect(() => {
    if (!isAgent || busy) return;
    const size = (m?: OpalUIMessage) => (m ? JSON.stringify(m.parts).length : 0);
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { messages: server } = await fetcher<ConversationResponse>(`/api/conversations/${id}`);
        const local = messagesRef.current;
        const a = server[server.length - 1];
        const b = local[local.length - 1];
        const changed = server.length !== local.length || a?.id !== b?.id || size(a) !== size(b);
        if (changed && !busyRef.current) setMessages(server);
      } catch {}
    };
    const timer = setInterval(tick, 4000);
    return () => clearInterval(timer);
  }, [isAgent, busy, id, setMessages]);

  const dispatch = useCallback(
    ({ text, files }: ComposerMessage) => {
      if (!started.current) {
        started.current = true;
        window.history.replaceState(null, "", `/c/${id}`);
        // Show the new chat in the sidebar right away.
        setTimeout(refreshConversations, 600);
      }
      void sendMessage({ parts: [...files, ...(text ? [{ type: "text" as const, text }] : [])] });
    },
    [id, sendMessage],
  );

  // Typing is never blocked: a message sent while Opal is answering waits its turn.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const submit = useCallback(
    (m: ComposerMessage) => {
      if (busyRef.current) setQueued(m);
      else dispatch(m);
    },
    [dispatch],
  );
  useEffect(() => {
    if (!busy && queued) {
      setQueued(null);
      dispatch(queued);
    }
  }, [busy, queued, dispatch]);

  const send = useCallback((text: string) => submit({ text, files: [] }), [submit]);

  const autoSent = useRef(false);
  useEffect(() => {
    if (autoPrompt && !autoSent.current && messages.length === 0) {
      autoSent.current = true;
      send(autoPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeMode = useCallback(
    (m: ChatMode) => {
      setMode(m);
      if (started.current) void apiFetch(`/api/conversations/${id}`, { method: "PATCH", json: { mode: m } }).catch(() => {});
    },
    [id],
  );

  const actions = useMemo(
    () => ({
      nerd,
      send,
      approve: (approvalId: string, approved: boolean) => {
        pendingApprovals.current.add(approvalId);
        void addToolApprovalResponse({ id: approvalId, approved });
      },
      answerTool: (tool: "request_secret" | "ask_user", toolCallId: string, output: Record<string, unknown>) => {
        pendingOutputs.current.add(toolCallId);
        void addToolOutput({ tool, toolCallId, output } as never);
      },
      regenerate: () => void regenerate(),
      openSandbox: (agentId: string) => setPanel(true, agentId),
    }),
    [nerd, send, addToolApprovalResponse, addToolOutput, regenerate],
  );

  // ── Agent conversations that grow out of the message that was clicked ──
  const openExchange = useCallback((target: ExchangeTarget, origin?: HTMLElement | null) => {
    const clip = clipFrom(origin, column.current);
    setLayers((ls) => [...ls, { ...target, key: `${target.agent.id || target.agent.name}-${target.runId ?? ""}-${ls.length}`, clip }]);
  }, []);
  const back = useCallback(() => setLayers((ls) => ls.slice(0, -1)), []);
  useEffect(() => setLayers([]), [id]);

  const owner: Owner = useMemo(
    () =>
      isAgent && agent
        ? { key: `agent:${agent.id}`, kind: "agent", name: agent.name, color: agent.color, shape: agent.shape, agentId: agent.id, threadId: id }
        : { key: `opal:${id}`, kind: "opal", name: "Opal" },
    [isAgent, agent, id],
  );

  const empty = messages.length === 0;
  const hasFrames = Object.keys(sandboxes.frames).length > 0;
  const working = busy || Object.values(live.runs).some((r) => r.view?.agentId === agent?.id && r.view?.status === "running");
  const streamingId = status === "streaming" ? messages[messages.length - 1]?.id : undefined;
  // Wide screens remember whether the details column is open. Narrow ones show it as a drawer,
  // only when asked.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const showDetails = isAgent && ((wide ? detailsOpen : drawerOpen) || sandboxes.open);
  const toggleDetails = () => {
    const next = !showDetails;
    if (!next) setPanel(false);
    if (!wide) return setDrawerOpen(next);
    setDetailsOpen(next);
    try {
      localStorage.setItem(DETAILS_KEY, next ? "1" : "0");
    } catch {}
  };

  const details =
    isAgent && agent ? (
      <AgentDetails
        agent={agent}
        messages={messages}
        streamingId={streamingId}
        working={working}
        onClose={() => {
          setPanel(false);
          if (!wide) return setDrawerOpen(false);
          setDetailsOpen(false);
          try {
            localStorage.setItem(DETAILS_KEY, "0");
          } catch {}
        }}
        onOpenSettings={onOpenSettings}
      />
    ) : null;

  return (
    <ChatActionsProvider value={actions}>
      <ExchangeOpenProvider value={openExchange}>
        <OwnerProvider value={owner}>
          <div className="flex min-h-0 min-w-0 flex-1">
            <div ref={column} className="relative flex min-w-0 flex-1 flex-col">
              <header className="flex h-12 shrink-0 items-center justify-center gap-2 px-14">
                {isAgent && agent ? (
                  <>
                    <Link
                      href="/agents"
                      aria-label="All agents"
                      className="pressable absolute left-2 top-2 grid size-8 place-items-center rounded-[8px] text-fg-muted hover:bg-surface hover:text-fg md:hidden"
                    >
                      <IconArrowLeft size={18} stroke={1.5} />
                    </Link>
                    <span className="flex min-w-0 items-center gap-2">
                      <AgentFace shape={agent.shape} color={agent.color} size={20} working={working} seed={agent.name} />
                      <h1 className="truncate text-[14px] font-medium">{agent.name}</h1>
                    </span>
                    <div className="absolute right-2 top-2">
                      <IconButton label={showDetails ? "Hide details" : "Show details"} onPress={toggleDetails}>
                        <IconLayoutSidebarRight size={18} stroke={1.5} />
                      </IconButton>
                    </div>
                  </>
                ) : (
                  <>
                    {!empty && title && <h1 className="truncate text-[13.5px] text-fg/80">{title}</h1>}
                    {hasFrames && (
                      <div className="absolute right-2 top-2">
                        <IconButton label="Agent computers" onPress={() => setPanel(!sandboxes.open)}>
                          <IconDeviceDesktop size={18} stroke={1.5} />
                        </IconButton>
                      </div>
                    )}
                  </>
                )}
              </header>

              {empty ? <Welcome agent={isAgent ? agent : undefined} userName={settings?.user.name} /> : <Thread messages={messages} status={status} />}

              {/* One composer for both states: it starts centred and slides down after the first message. */}
              <motion.div
                layout="position"
                layoutDependency={empty}
                transition={{ duration: 0.38, ease: [0.23, 1, 0.32, 1] }}
                className="relative z-10 px-4 pb-4 pt-1"
              >
                <div className="mx-auto w-full max-w-[760px]">
                  <Composer
                    onSend={submit}
                    onStop={stop}
                    busy={busy}
                    mode={mode}
                    onModeChange={changeMode}
                    tools={tools}
                    onToolsChange={setTools}
                    agentName={isAgent ? agent?.name : undefined}
                    model={lockedModel ?? model}
                    onModelChange={setModel}
                    modelLocked={Boolean(lockedModel)}
                    autoFocus
                    showIdeas={empty && !isAgent}
                    queued={queued}
                    onCancelQueued={() => setQueued(null)}
                    errorTick={errorTick}
                  />
                </div>
              </motion.div>
              {empty && <div aria-hidden="true" className="flex-[1.2]" />}

              <ExchangeStack layers={layers} onBack={back} />
            </div>

            {isAgent ? (
              wide ? (
                <motion.aside
                  initial={false}
                  animate={{ width: showDetails ? (sandboxes.open ? 480 : 320) : 0 }}
                  transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
                  className="shrink-0 overflow-hidden border-l border-line-subtle bg-bg"
                  style={{ borderLeftWidth: showDetails ? 1 : 0 }}
                  aria-hidden={!showDetails}
                >
                  <div className="h-full" style={{ width: sandboxes.open ? 480 : 320 }}>
                    {showDetails && details}
                  </div>
                </motion.aside>
              ) : (
                <Drawer
                  side="right"
                  isOpen={showDetails}
                  onOpenChange={(o) => {
                    if (!o) {
                      setPanel(false);
                      setDrawerOpen(false);
                    }
                  }}
                  className="w-[min(92vw,380px)] p-0"
                >
                  {details}
                </Drawer>
              )
            ) : (
              <>
                {sandboxes.open && wide && <SandboxPanel />}
                {!wide && (
                  <Drawer side="right" isOpen={sandboxes.open} onOpenChange={(o) => setPanel(o)} className="w-[min(92vw,480px)] p-0">
                    <SandboxPanel variant="drawer" />
                  </Drawer>
                )}
              </>
            )}
          </div>
        </OwnerProvider>
      </ExchangeOpenProvider>
    </ChatActionsProvider>
  );
}

function Welcome({ agent, userName }: { agent?: AgentIdentity; userName?: string }) {
  // Name and time of day only. Anything more personal feels like being watched.
  const [greeting] = useState(() => {
    const h = new Date().getHours();
    const key = h < 5 ? "welcome.night" : h < 12 ? "welcome.morning" : h < 18 ? "welcome.afternoon" : h < 23 ? "welcome.evening" : "welcome.night";
    const first = (userName ?? "").trim().split(/\s+/)[0] ?? "";
    return t(key, { name: first }).replace(/,\s*$/, "");
  });
  if (agent) {
    return (
      <div className="flex flex-1 flex-col items-center justify-end gap-3 px-4 pb-7 text-center">
        <AgentFace shape={agent.shape} color={agent.color} size={64} seed={agent.name} />
        <div>
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-fg/90">{t("welcome.agent", { name: agent.name })}</h1>
          <p className="mt-1 text-[13.5px] text-fg-muted">{t("agents.welcomeHint", { name: agent.name })}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-end px-4 pb-7">
      <div className="flex items-center gap-2.5">
        <OpalMark size={26} className="text-fg" />
        <h1 className="text-[22px] font-medium tracking-[-0.01em] text-fg/90">{greeting}</h1>
      </div>
    </div>
  );
}
