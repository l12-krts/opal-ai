"use client";
// The Agents tab: a list of agents next to the (collapsed) main sidebar, and the selected
// agent's thread on the right.
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Button, Skeleton, WithTooltip, cn } from "krts.ui";
import { IconPlus } from "@tabler/icons-react";
import { fetcher } from "@/lib/api";
import { useAgents, type AgentRow } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { useMediaQuery } from "@/lib/use-media-query";
import { AgentFace } from "../agent-face";
import { ChatView, ThreadSkeleton } from "../chat/chat-view";
import { AgentEditor, type EditableAgent } from "./agent-editor";

type AgentsUI = { create: () => void; edit: (a: EditableAgent) => void };
const Ctx = createContext<AgentsUI>({ create: () => {}, edit: () => {} });

export function AgentsShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id?: string }>();
  const selected = params?.id;
  const [editor, setEditor] = useState<{ agent?: EditableAgent } | null>(null);

  return (
    <Ctx.Provider value={{ create: () => setEditor({}), edit: (agent) => setEditor({ agent }) }}>
      <div className="flex min-h-0 min-w-0 flex-1">
        <aside
          className={cn(
            "min-h-0 shrink-0 flex-col border-r border-line-subtle bg-bg md:flex md:w-[288px]",
            selected ? "hidden" : "flex w-full",
          )}
        >
          <AgentList selected={selected} />
        </aside>
        <section className={cn("min-h-0 min-w-0 flex-1 md:flex", selected ? "flex" : "hidden")}>{children}</section>
      </div>
      {editor && <AgentEditor agent={editor.agent} onClose={() => setEditor(null)} />}
    </Ctx.Provider>
  );
}

function AgentList({ selected }: { selected?: string }) {
  const { create } = useContext(Ctx);
  const { data } = useAgents({ live: true });
  const agents = data?.agents ?? [];

  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between pl-4 pr-3 max-md:pl-12">
        <h1 className="text-[17px] font-medium tracking-[-0.01em]">{t("agents.title")}</h1>
        <WithTooltip content={t("agents.new")} delay={400}>
          <Button
            variant="secondary"
            size="sm"
            isIconOnly
            aria-label={t("agents.new")}
            onPress={create}
            className="size-8 rounded-full"
          >
            <IconPlus size={16} stroke={1.75} />
          </Button>
        </WithTooltip>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label={t("agents.title")}>
        {!data &&
          [0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-2.5 py-2.5 mb-1">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
            </li>
          ))}
        {data && !agents.length && (
          <li className="px-3 py-4 text-[13px] text-fg-muted mb-1">
            {t("agents.empty")}
            <Button size="sm" variant="secondary" className="mt-3" startContent={<IconPlus size={15} stroke={1.5} />} onPress={create}>
              {t("agents.new")}
            </Button>
          </li>
        )}
        {agents.map((a) => (
          <li key={a.id} className="mb-1">
            <AgentListItem agent={a} active={a.id === selected} />
          </li>
        ))}
      </ul>
    </>
  );
}

function AgentListItem({ agent: a, active }: { agent: AgentRow; active: boolean }) {
  return (
    <Link
      href={`/agents/${a.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "pressable flex items-center gap-3 rounded-[14px] px-2.5 py-2 transition-colors duration-150",
        active ? "bg-surface-hover" : "hover:bg-surface",
      )}
    >
      <AgentFace shape={a.shape} color={a.color} size={40} working={a.running} seed={a.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[14px] font-medium">{a.name}</span>
          <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-fg-subtle">{relTime(a.activityAt)}</span>
        </div>
        <p className={cn("truncate text-[12.5px]", a.running ? "shimmer-text" : "text-fg-muted")}>
          {a.running ? t("agents.working") : a.preview || t("agents.noMessages")}
        </p>
      </div>
    </Link>
  );
}

function relTime(iso: string) {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** /agents: open the most recent agent (on wide screens), or invite to make one. */
export function AgentsIndex() {
  const router = useRouter();
  const { create } = useContext(Ctx);
  const { data } = useAgents({ live: true });
  const wide = useMediaQuery("(min-width: 768px)");
  const first = data?.agents[0]?.id;

  useEffect(() => {
    if (wide && first) router.replace(`/agents/${first}`);
  }, [wide, first, router]);

  if (!data || first) return null;
  return (
    <div className="grid flex-1 place-items-center px-6">
      <div className="flex max-w-[360px] flex-col items-center gap-4 text-center">
        <div className="flex items-end gap-2">
          <AgentFace shape="ghost" color="#3b82f6" size={44} seed="a" />
          <AgentFace shape="cookie" color="#ea6a2a" size={60} seed="b" />
          <AgentFace shape="triangle" color="#22a35a" size={44} seed="c" />
        </div>
        <div>
          <h2 className="text-[18px] font-medium">{t("agents.emptyTitle")}</h2>
          <p className="mt-1 text-[13.5px] text-fg-muted">{t("agents.empty")}</p>
        </div>
        <Button size="sm" variant="primary" startContent={<IconPlus size={15} stroke={1.75} />} onPress={create}>
          {t("agents.new")}
        </Button>
      </div>
    </div>
  );
}

type ThreadResponse = { threadId: string; agent: { id: string; name: string; color: string; shape: string; ephemeral: boolean } };

/** /agents/[id]: the agent's one thread. */
export function AgentThreadPage({ id }: { id: string }) {
  const { edit } = useContext(Ctx);
  const { data, error } = useSWR<ThreadResponse>(`/api/agents/${id}/thread`, fetcher, { revalidateOnFocus: false, shouldRetryOnError: false });
  const { data: list } = useAgents({ live: true });
  const row = list?.agents.find((a) => a.id === id);

  if (error) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-medium">This agent isn&apos;t available</p>
          <p className="mt-1 text-[13px] text-fg-muted">It may have been deleted.</p>
          <Link href="/agents" className="mt-3 inline-block text-[13px] underline underline-offset-2">
            All agents
          </Link>
        </div>
      </div>
    );
  }
  if (!data) return <ThreadSkeleton />;

  const agent = row ? { id, name: row.name, color: row.color, shape: row.shape, ephemeral: false } : data.agent;
  return (
    <ChatView
      key={data.threadId}
      id={data.threadId}
      isNew={false}
      initialMode="chat"
      variant="agent"
      agent={agent}
      onOpenSettings={() => edit({ id: agent.id, name: agent.name, color: agent.color, shape: agent.shape })}
    />
  );
}
