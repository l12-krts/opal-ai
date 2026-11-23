"use client";

import { memo, useLayoutEffect, useRef } from "react";
import { CopyButton, cn } from "krts.ui";
import { IconFileText, IconFileTypePdf, IconRefresh } from "@tabler/icons-react";
import { getToolName, isToolUIPart, type FileUIPart } from "ai";
import type { OpalUIMessage } from "@/lib/types";
import { landFlight } from "@/lib/flight";
import { t } from "@/lib/i18n";
import { OpalMark } from "../brand";
import { IconButton } from "../ui";
import { useChatActions } from "./chat-context";
import { Markdown } from "./parts/markdown";
import { Reasoning } from "./parts/reasoning";
import { RouteChip } from "./parts/route-chip";
import type { AgentRunView } from "@/lib/types";
import { AGENT_TOOLS, AgentMessageTool, InboundMessage } from "./parts/agent-message";
import { CARD_TOOLS, HIDDEN, ToolPart } from "./parts/tool";
import { WorkGroup } from "./parts/work-group";
import { ChatText } from "../rich-text";

function textOf(m: OpalUIMessage) {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n");
}

export const UserMessage = memo(function UserMessage({ message }: { message: OpalUIMessage }) {
  if (message.metadata?.from) return <InboundMessage message={message} />;
  return <OwnUserMessage message={message} />;
});

const OwnUserMessage = memo(function OwnUserMessage({ message }: { message: OpalUIMessage }) {
  const ref = useRef<HTMLDivElement>(null);
  const text = textOf(message);
  useLayoutEffect(() => {
    if (ref.current) landFlight(text, ref.current);
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const files = message.parts.filter((p): p is FileUIPart => p.type === "file");
  const images = files.filter((f) => f.mediaType.startsWith("image/"));
  const docs = files.filter((f) => !f.mediaType.startsWith("image/"));
  return (
    <div className="group flex flex-col items-end gap-1">
      {images.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {images.map((f) => (
            <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[14px] border border-line-subtle">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={f.url}
                alt={f.filename ?? "Image"}
                className={cn("block object-cover", images.length === 1 ? "max-h-[260px] max-w-[320px]" : "size-28")}
              />
            </a>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {docs.map((f) => (
            <a
              key={f.url}
              href={f.url}
              className="flex h-12 max-w-[240px] items-center gap-2.5 rounded-[12px] border border-line-subtle bg-overlay py-1.5 pl-1.5 pr-3 hover:bg-surface"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-surface text-fg-muted">
                {f.mediaType === "application/pdf" ? <IconFileTypePdf size={17} stroke={1.5} /> : <IconFileText size={17} stroke={1.5} />}
              </span>
              <span className="truncate text-[13px]">{f.filename ?? "File"}</span>
            </a>
          ))}
        </div>
      )}
      {text && (
        <div
          ref={ref}
          className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble bg-bubble px-4 py-2.5 text-[15px] leading-6"
        >
          <ChatText text={text} />
        </div>
      )}
      {text && (
        <div className="flex h-7 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <CopyButton value={text} size="xs" variant="ghost" isIconOnly label={t("chat.copy")} className="text-fg-muted" />
        </div>
      )}
    </div>
  );
});

export const AssistantMessage = memo(function AssistantMessage({
  message,
  isLast,
  streaming,
  errored,
}: {
  message: OpalUIMessage;
  isLast: boolean;
  streaming: boolean;
  errored: boolean;
}) {
  const { nerd, regenerate } = useChatActions();
  const text = textOf(message);
  const meta = message.metadata ?? {};
  const parts = message.parts;
  const lastTextIndex = parts.map((p) => p.type).lastIndexOf("text");
  const hasVisible = parts.some((p) => p.type === "text" || p.type === "reasoning" || isToolUIPart(p));
  // Agent run cards saved with this message, by the tool call that started them.
  const runs = new Map<string, AgentRunView>();
  for (const p of parts) if (p.type === "data-agent" && p.data.toolCallId) runs.set(p.data.toolCallId, p.data);
  // The router only predicts delegation; the chip reflects whether a subagent was actually used.
  const delegated = parts.some((p) => isToolUIPart(p) && AGENT_TOOLS.has(getToolName(p)));

  return (
    <div className="group flex flex-col gap-3">
      {groupParts(parts).map((g) => {
        const key = `${message.id}-${g.start}`;
        if (g.kind === "work") {
          const onlyThinking = g.parts.every((p) => p.type === "reasoning");
          if (onlyThinking && g.parts.length === 1) {
            const p = g.parts[0] as { text: string };
            return <Reasoning key={key} text={p.text} streaming={streaming && g.end === parts.length - 1} defaultOpen={nerd} />;
          }
          return <WorkGroup key={key} parts={g.parts as never} active={streaming && g.end === parts.length - 1} />;
        }
        if (g.kind === "agents") {
          return (
            <div key={key} className="flex flex-col gap-1.5">
              {g.parts.map((p) => {
                const tp = p as unknown as { toolCallId: string; state: string };
                return (
                  <AgentMessageTool
                    key={tp.toolCallId}
                    part={p as never}
                    name={getToolName(p as never)}
                    streaming={streaming}
                    persisted={runs.get(tp.toolCallId)}
                  />
                );
              })}
            </div>
          );
        }
        const part = g.part;
        const i = g.start;
        if (part.type === "data-route") return <RouteChip key={key} data={part.data} delegated={delegated} />;
        if (part.type === "text") return <Markdown key={key} text={part.text} streaming={streaming && i === lastTextIndex} />;
        if (isToolUIPart(part)) return <ToolPart key={key} part={part as never} name={getToolName(part)} streaming={streaming} />;
        return null;
      })}

      {streaming && !hasVisible && <Thinking />}

      {errored && (
        <div className="flex items-center gap-2 text-[13px] text-danger">
          {t("chat.error")}
          <button type="button" onClick={regenerate} className="pressable underline underline-offset-2">
            {t("chat.errorRetry")}
          </button>
        </div>
      )}

      {!streaming && (text || nerd) && (
        <div className="-ml-1.5 flex h-7 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {text && <CopyButton value={text} size="xs" variant="ghost" isIconOnly label={t("chat.copy")} className="text-fg-muted" />}
          {isLast && (
            <IconButton label={t("chat.retry")} onPress={regenerate}>
              <IconRefresh size={15} stroke={1.5} />
            </IconButton>
          )}
          {nerd && (
            <span className="ml-2 font-mono text-[11.5px] tabular-nums text-fg-subtle">
              {[
                meta.model?.split(":").slice(1).join(":"),
                meta.inputTokens != null && `${meta.inputTokens} in`,
                meta.outputTokens != null && `${meta.outputTokens} out`,
                meta.reasoningTokens ? `${meta.reasoningTokens} reasoning` : null,
                meta.finishedAt && meta.startedAt && `${((meta.finishedAt - meta.startedAt) / 1000).toFixed(1)}s`,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

function Thinking() {
  return (
    <div className="flex h-6 items-center gap-2 text-[14px]">
      <span className="shimmer-text">{t("chat.thinking")}</span>
    </div>
  );
}

export function PendingAssistant({ error }: { error?: boolean }) {
  const { regenerate } = useChatActions();
  return (
    <div className="flex items-center gap-2.5 text-[14px]">
      <OpalMark size={16} className={cn("text-fg-muted", !error && "status-pulse")} />
      {error ? (
        <span className="text-danger">
          {t("chat.error")}.{" "}
          <button type="button" onClick={regenerate} className="pressable underline underline-offset-2">
            {t("chat.errorRetry")}
          </button>
        </span>
      ) : (
        <span className="shimmer-text">{t("chat.thinking")}</span>
      )}
    </div>
  );
}

type Group =
  | { kind: "work"; parts: OpalUIMessage["parts"]; start: number; end: number }
  | { kind: "agents"; parts: OpalUIMessage["parts"]; start: number; end: number }
  | { kind: "single"; part: OpalUIMessage["parts"][number]; start: number; end: number };

/** Folds runs of reasoning + plain tool steps into one work group; everything else stays as is. */
function groupParts(parts: OpalUIMessage["parts"]): Group[] {
  const out: Group[] = [];
  parts.forEach((part, i) => {
    const isStep =
      part.type === "reasoning" ||
      (isToolUIPart(part) &&
        !CARD_TOOLS.has(getToolName(part)) &&
        !HIDDEN.has(getToolName(part)) &&
        (part as { state?: string }).state !== "approval-requested");
    if (part.type === "step-start" || part.type === "data-agent" || part.type === "data-agent-msg") return;
    if (isToolUIPart(part) && AGENT_TOOLS.has(getToolName(part)) && (part as { state?: string }).state !== "approval-requested") {
      const prev = out[out.length - 1];
      if (prev?.kind === "agents") {
        prev.parts.push(part);
        prev.end = i;
      } else out.push({ kind: "agents", parts: [part], start: i, end: i });
      return;
    }
    if (isToolUIPart(part) && HIDDEN.has(getToolName(part)) && (part as { state?: string }).state !== "output-error") return;
    const last = out[out.length - 1];
    if (isStep && last?.kind === "work") {
      last.parts.push(part);
      last.end = i;
    } else if (isStep) {
      out.push({ kind: "work", parts: [part], start: i, end: i });
    } else {
      out.push({ kind: "single", part, start: i, end: i });
    }
  });
  return out;
}
