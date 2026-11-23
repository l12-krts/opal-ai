"use client";
// Right-edge panel in an agent's thread: who it is, its computer, and what it has done.
import { useMemo } from "react";
import useSWR from "swr";
import { cn } from "krts.ui";
import { getToolName, isToolUIPart } from "ai";
import { IconDeviceDesktop, IconMessage, IconSettings, IconX } from "@tabler/icons-react";
import type { OpalUIMessage } from "@/lib/types";
import { fetcher } from "@/lib/api";
import { setPanel, useSandboxes } from "@/lib/sandbox-store";
import { AgentFace } from "../agent-face";
import { IconButton, SmallButton } from "../ui";
import { describe, HIDDEN } from "../chat/parts/tool";
import { AGENT_TOOLS } from "../chat/parts/agent-message";
import { SandboxPanel } from "../chat/sandbox-panel";
import type { AgentIdentity } from "../chat/exchange-context";

type SandboxResponse = { sandbox: null | { status: string; lastUrl: string | null; lastScreenshot: string | null } };

type Activity = { id: string; icon: typeof IconMessage; label: string; state: "running" | "done" | "error" };

function activityOf(messages: OpalUIMessage[], streamingId?: string): Activity[] {
  const out: Activity[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts) {
      if (!isToolUIPart(p)) continue;
      const name = getToolName(p);
      if (HIDDEN.has(name)) continue;
      const part = p as { toolCallId: string; state: string; input?: any; output?: any };
      const failed = part.state === "output-error" || part.state === "output-denied" || part.output?.ok === false;
      const done = part.state === "output-available" || m.id !== streamingId;
      if (AGENT_TOOLS.has(name)) {
        const to = name === "study_helper" ? "Study AI" : (part.input?.to ?? part.input?.name ?? "an agent");
        out.push({ id: part.toolCallId, icon: IconMessage, label: `Sent message to ${to}`, state: failed ? "error" : done ? "done" : "running" });
      } else {
        const d = describe(name, part.input);
        out.push({ id: part.toolCallId, icon: d.icon, label: d.label, state: failed ? "error" : done ? "done" : "running" });
      }
    }
  }
  return out.reverse().slice(0, 80);
}

export function AgentDetails({
  agent,
  messages,
  streamingId,
  working,
  onClose,
  onOpenSettings,
}: {
  agent: AgentIdentity;
  messages: OpalUIMessage[];
  streamingId?: string;
  working: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const sandboxes = useSandboxes();
  const activity = useMemo(() => activityOf(messages, streamingId), [messages, streamingId]);

  if (sandboxes.open) return <SandboxPanel variant="drawer" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-end px-2">
        <IconButton label="Close details" onPress={onClose}>
          <IconX size={17} stroke={1.5} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="flex flex-col items-center gap-2.5 pb-5 pt-1 text-center">
          <AgentFace shape={agent.shape} color={agent.color} size={72} working={working} seed={agent.name} />
          <div>
            <h2 className="text-[16px] font-medium">{agent.name}</h2>
            <p className={cn("text-[12.5px]", working ? "shimmer-text" : "text-fg-muted")}>{working ? "Working" : "Ready"}</p>
          </div>
          <div className="flex gap-1.5">
            {onOpenSettings && (
              <SmallButton variant="secondary" startContent={<IconSettings size={15} stroke={1.5} />} onPress={onOpenSettings}>
                Settings
              </SmallButton>
            )}
            <SmallButton variant="secondary" startContent={<IconDeviceDesktop size={15} stroke={1.5} />} onPress={() => setPanel(true, agent.id)}>
              Computer
            </SmallButton>
          </div>
        </div>

        <Section title="Computer">
          <ComputerPreview agentId={agent.id} name={agent.name} />
        </Section>

        <Section title="Activity">
          {activity.length ? (
            <ol className="flex flex-col">
              {activity.map((a) => (
                <li key={a.id} className="flex h-8 items-center gap-2.5 text-[13px]">
                  <a.icon size={15} stroke={1.5} className="shrink-0 text-fg-muted" />
                  <span className={cn("min-w-0 flex-1 truncate", a.state === "running" ? "shimmer-text" : a.state === "error" ? "text-danger" : "text-fg/85")}>
                    {a.label}
                  </span>
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      a.state === "running" ? "status-pulse bg-fg-subtle" : a.state === "error" ? "bg-danger" : "bg-success",
                    )}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-fg-muted">Tools {agent.name} uses show up here.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line-subtle py-4">
      <h3 className="mb-2.5 text-[12px] font-medium text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}

function ComputerPreview({ agentId, name }: { agentId: string; name: string }) {
  const { frames } = useSandboxes();
  const frame = frames[agentId];
  const { data } = useSWR<SandboxResponse>(`/api/sandbox/${agentId}`, fetcher, { refreshInterval: 15_000, revalidateOnFocus: false });
  const shot = frame?.screenshot ?? data?.sandbox?.lastScreenshot ?? undefined;
  const url = frame?.url ?? data?.sandbox?.lastUrl ?? undefined;
  const live = Boolean(frame && Date.now() - frame.at < 60_000);
  const status = data?.sandbox?.status;

  return (
    <button
      type="button"
      onClick={() => setPanel(true, agentId)}
      aria-label={`Open ${name}'s computer`}
      className="pressable group relative block aspect-[16/10] w-full overflow-hidden rounded-[12px] border border-line-subtle bg-[#101010] text-left"
    >
      {shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot} alt="" className="absolute inset-0 size-full object-cover object-top transition-transform duration-300 ease-out group-hover:scale-[1.02]" />
      ) : (
        <span className="absolute inset-0 grid place-items-center">
          <span className="flex flex-col items-center gap-1.5 text-[12px] text-[#9a9a9a]">
            <IconDeviceDesktop size={22} stroke={1.25} />
            {status === "running" ? "Nothing on screen yet" : status ? "Asleep" : "Not started yet"}
          </span>
        </span>
      )}
      {(url || live) && (
        <span className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 rounded-[8px] bg-black/60 px-2 py-1 font-mono text-[11px] text-white/90 backdrop-blur-sm">
          {live && <span className="status-pulse size-1.5 shrink-0 rounded-full bg-[#4ade80]" />}
          <span className="truncate">{url ?? "Live"}</span>
        </span>
      )}
    </button>
  );
}
