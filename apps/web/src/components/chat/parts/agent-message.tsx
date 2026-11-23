"use client";
// Quiet rows for agent messages, styled like tool steps:
//   "Sent message to Scout"      (opens to show who and what was sent)
//   "Received message from Scout" (the reply)
// Clicking the agent or the message opens the full conversation between the two.
import { useState } from "react";
import { cn } from "krts.ui";
import { IconAlertTriangle, IconChevronRight, IconMessage } from "@tabler/icons-react";
import type { AgentRunView, AgentSender, OpalUIMessage } from "@/lib/types";
import { useRunByToolCall } from "@/lib/agent-live";
import { AgentFace, SenderFace } from "../../agent-face";
import { Collapse } from "./collapsible";
import { Markdown } from "./markdown";
import { useOpenExchange, useOwner, type AgentIdentity, type ExchangeTarget } from "../exchange-context";

type AnyToolPart = { type: string; toolCallId: string; state: string; input?: any; output?: any; errorText?: string };

export const AGENT_TOOLS = new Set(["message_agent", "spawn_agent", "study_helper", "delegate", "ask_agent"]);

const GRAY = "#8a8a8a";

function targetName(name: string, input: any): string {
  if (name === "study_helper") return "Study AI";
  return String(input?.to ?? input?.name ?? input?.agent ?? "agent").replace(/^@/, "");
}

function sentText(input: any): string {
  return String(input?.text ?? input?.task ?? input?.request ?? input?.question ?? "");
}

export function AgentMessageTool({
  part,
  name,
  streaming,
  persisted,
}: {
  part: AnyToolPart;
  name: string;
  streaming: boolean;
  /** The run card saved in the same message, if any. */
  persisted?: AgentRunView;
}) {
  const owner = useOwner();
  const live = useRunByToolCall(part.toolCallId);
  const view = live?.view ?? persisted;
  const out = part.state === "output-available" ? part.output : undefined;
  const outAgent = out && typeof out.agent === "object" ? (out.agent as AgentIdentity) : undefined;
  const identity: AgentIdentity = outAgent ??
    (view ? { id: view.agentId, name: view.name, color: view.color, shape: view.shape, ephemeral: view.ephemeral } : { id: "", name: targetName(name, part.input), color: GRAY });
  const text = sentText(part.input);
  const reply: string | undefined = out?.reply ?? out?.report ?? (view && view.status !== "running" ? view.result : undefined);
  const inputPending = part.state === "input-streaming" || part.state === "input-available";
  const running = inputPending && streaming && view?.status !== "done" && view?.status !== "error";
  const failed = part.state === "output-error" || out?.ok === false;
  const error: string | undefined = part.errorText ?? (out?.ok === false ? out?.error : undefined);
  const delivered = out?.status === "delivered";

  const target: ExchangeTarget = {
    agent: identity,
    threadId: out?.threadId ?? view?.threadId,
    from: view?.from ?? owner,
    runId: out?.runId ?? view?.runId,
    task: text,
    reply,
  };

  if (part.state === "input-streaming" && !text) {
    return (
      <Row icon={<IconMessage size={15} stroke={1.5} />} active>
        <span className="shimmer-text">Writing to {identity.name}</span>
      </Row>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Disclosure
        label={
          <>
            <span className="shrink-0">Sent message to</span>
            <Who agent={identity} working={running} />
          </>
        }
        trailing={
          running ? (
            <span className="shimmer-text min-w-0 truncate text-[12.5px]">{view?.current ?? "Working"}</span>
          ) : failed && !reply ? (
            <IconAlertTriangle size={13} stroke={1.5} className="shrink-0 text-danger" />
          ) : null
        }
      >
        <MessageCard target={target} direction="To" who={{ kind: "agent", ...identity }} body={text} />
        {failed && error && <p className="mt-1.5 text-[12.5px] text-danger">{error}</p>}
        {delivered && out?.note && <p className="mt-1.5 text-[12.5px] text-fg-subtle">{out.note}</p>}
      </Disclosure>

      {reply && !failed && (
        <Disclosure
          label={
            <>
              <span className="shrink-0">Received message from</span>
              <Who agent={identity} />
            </>
          }
        >
          <MessageCard target={target} direction="From" who={{ kind: "agent", ...identity }} body={reply} markdown />
        </Disclosure>
      )}
    </div>
  );
}

/** In an agent's own thread: a message it got from Opal or another agent. */
export function InboundMessage({ message }: { message: OpalUIMessage }) {
  const owner = useOwner();
  const from = message.metadata?.from as AgentSender;
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n");
  const target: ExchangeTarget = {
    agent: { id: owner.agentId ?? "", name: owner.name, color: owner.color ?? GRAY, shape: owner.shape },
    threadId: owner.threadId,
    from,
    runId: message.metadata?.run?.runId,
    task: text,
  };
  return (
    <Disclosure
      label={
        <>
          <span className="shrink-0">Received message from</span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <SenderFace sender={from} size={15} />
            <span className="truncate font-medium text-fg/80">{from.name}</span>
          </span>
        </>
      }
    >
      <MessageCard target={target} direction="From" who={from} body={text} sameThread />
    </Disclosure>
  );
}

function Who({ agent, working }: { agent: AgentIdentity; working?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <AgentFace shape={agent.shape} color={agent.color} size={15} working={working} seed={agent.name} />
      <span className="truncate font-medium text-fg/80">{agent.name}</span>
    </span>
  );
}

function Row({ icon, children, active }: { icon: React.ReactNode; children: React.ReactNode; active?: boolean }) {
  return (
    <div className={cn("-ml-1 inline-flex max-w-full items-center gap-2 px-1 py-0.5 text-[13.5px] text-fg-muted", active && "text-fg-muted")}>
      <span className="shrink-0">{icon}</span>
      {children}
    </div>
  );
}

function Disclosure({ label, trailing, children }: { label: React.ReactNode; trailing?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable -ml-1 inline-flex max-w-full items-center gap-2 rounded-[6px] px-1 py-0.5 text-[13.5px] text-fg-muted hover:text-fg"
      >
        <IconMessage size={15} stroke={1.5} className="shrink-0" />
        <span className="flex min-w-0 items-center gap-1.5">{label}</span>
        {trailing}
        <IconChevronRight size={13} stroke={1.5} className={cn("shrink-0 transition-transform duration-200", open && "rotate-90")} />
      </button>
      <Collapse open={open}>
        <div className="ml-1 mt-1.5 border-l border-line pl-3">{children}</div>
      </Collapse>
    </div>
  );
}

/** The other side (who it went to, or came from) and the message. Both open the full conversation. */
function MessageCard({
  target,
  direction,
  who,
  body,
  markdown,
  sameThread,
}: {
  target: ExchangeTarget;
  direction: "To" | "From";
  who: { kind?: string; name: string; color?: string; shape?: string | null };
  body: string;
  markdown?: boolean;
  sameThread?: boolean;
}) {
  const open = useOpenExchange();
  const canOpen = Boolean(open && (target.threadId || target.agent.id || sameThread));
  const go = (e: React.SyntheticEvent<HTMLElement>) => {
    if (!open || !canOpen) return;
    const card = (e.currentTarget.closest("[data-message-card]") as HTMLElement | null) ?? e.currentTarget;
    open(target, card);
  };
  // The body can hold its own controls (a table's copy button, links), so it can't be a <button>.
  // It acts like one instead, and leaves clicks on those controls to them.
  const onBodyClick = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, summary")) return;
    if (window.getSelection()?.toString()) return; // selecting text, not opening
    go(e);
  };
  const onBodyKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    go(e);
  };
  return (
    <div data-message-card className="flex max-w-[620px] flex-col gap-1.5 rounded-[12px] bg-surface/60 px-3 py-2.5">
      <button
        type="button"
        onClick={go}
        disabled={!canOpen}
        className="pressable inline-flex w-fit items-center gap-1.5 rounded-[6px] text-[13px] font-medium text-fg/90 enabled:hover:underline enabled:hover:underline-offset-2"
      >
        <span className="font-normal text-fg-muted">{direction}</span>
        <SenderFace sender={who} size={18} />
        {who.name}
      </button>
      <div
        role={canOpen ? "button" : undefined}
        tabIndex={canOpen ? 0 : undefined}
        onClick={canOpen ? onBodyClick : undefined}
        onKeyDown={canOpen ? onBodyKey : undefined}
        aria-label={canOpen ? `Open the conversation with ${target.agent.name}` : undefined}
        className={cn("block w-full rounded-[6px] text-left", canOpen && "cursor-pointer")}
      >
        {markdown ? (
          <div className="line-clamp-[10] text-[14px] [&_.prose-opal]:text-[14px]">
            <Markdown text={body} />
          </div>
        ) : (
          <p className="line-clamp-[10] whitespace-pre-wrap break-words text-[14px] leading-[1.55] text-fg/85">{body}</p>
        )}
      </div>
    </div>
  );
}
