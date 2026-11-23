"use client";
// Approval card with a generative preview of the action (an email looks like an email, a
// message like a message, anything else as a clean field list).
import { Button } from "krts.ui";
import { IconMail, IconMessage, IconCalendarEvent, IconPlugConnected } from "@tabler/icons-react";
import { t } from "@/lib/i18n";
import { useChatActions } from "../chat-context";
import { prettySlug } from "./tool";

type Call = { slug: string; args: Record<string, any> };

function callsFrom(name: string, input: any): Call[] {
  if (Array.isArray(input?.tools)) {
    return input.tools.map((t: any) => ({ slug: String(t?.tool_slug ?? t?.slug ?? name), args: (t?.arguments ?? t?.input ?? {}) as Record<string, any> }));
  }
  return [{ slug: name, args: (input ?? {}) as Record<string, any> }];
}

export function ApprovalCard({ part, name }: { part: any; name: string }) {
  const { approve } = useChatActions();
  const calls = callsFrom(name, part.input);

  return (
    <div className="rounded-card border border-line bg-overlay">
      <div className="flex items-center gap-2 border-b border-line-subtle px-3.5 py-2.5">
        <IconPlugConnected size={16} stroke={1.5} className="text-fg-muted" />
        <span className="text-[13.5px] font-medium">{t("tool.approvalTitle")}</span>
      </div>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        {calls.map((c, i) => (
          <Preview key={i} call={c} />
        ))}
        {part.approval?.requestReason && <p className="text-[12.5px] text-fg-subtle">{part.approval.requestReason}</p>}
      </div>
      <div className="flex justify-end gap-2 px-3.5 pb-3">
        <Button size="xs" variant="ghost" onPress={() => approve(part.approval.id, false)}>
          {t("tool.deny")}
        </Button>
        <Button size="xs" className="btn-accent" onPress={() => approve(part.approval.id, true)}>
          {t("tool.approve")}
        </Button>
      </div>
    </div>
  );
}

function Preview({ call }: { call: Call }) {
  const slug = call.slug.toUpperCase();
  const a = call.args;

  if (/MAIL|EMAIL/.test(slug) && (a.subject || a.body || a.recipient_email || a.to)) {
    return (
      <div className="rounded-[10px] border border-line-subtle">
        <div className="flex items-center gap-2 border-b border-line-subtle px-3 py-2 text-[12.5px] text-fg-muted">
          <IconMail size={14} stroke={1.5} /> {prettySlug(call.slug)}
        </div>
        <dl className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 px-3 py-2 text-[13px]">
          <dt className="text-fg-subtle">To</dt>
          <dd className="truncate">{String(a.recipient_email ?? a.to ?? a.recipients ?? "")}</dd>
          {a.cc && (
            <>
              <dt className="text-fg-subtle">Cc</dt>
              <dd className="truncate">{String(a.cc)}</dd>
            </>
          )}
          <dt className="text-fg-subtle">Subject</dt>
          <dd className="font-medium">{String(a.subject ?? "")}</dd>
        </dl>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-line-subtle px-3 py-2.5 text-[13.5px] leading-6">{String(a.body ?? a.message_body ?? "")}</p>
      </div>
    );
  }

  if (/SLACK|DISCORD|TELEGRAM|WHATSAPP|MESSAGE|POST/.test(slug) && (a.text || a.content || a.message)) {
    return (
      <div className="rounded-[10px] border border-line-subtle px-3 py-2.5">
        <div className="mb-1.5 flex items-center gap-2 text-[12.5px] text-fg-muted">
          <IconMessage size={14} stroke={1.5} /> {prettySlug(call.slug)} {a.channel ? `in ${a.channel}` : ""}
        </div>
        <p className="whitespace-pre-wrap text-[13.5px] leading-6">{String(a.text ?? a.content ?? a.message)}</p>
      </div>
    );
  }

  if (/CALENDAR|EVENT/.test(slug) && (a.summary || a.title || a.start_datetime || a.start)) {
    return (
      <div className="rounded-[10px] border border-line-subtle px-3 py-2.5">
        <div className="mb-1.5 flex items-center gap-2 text-[12.5px] text-fg-muted">
          <IconCalendarEvent size={14} stroke={1.5} /> {prettySlug(call.slug)}
        </div>
        <p className="text-[14px] font-medium">{String(a.summary ?? a.title ?? "Event")}</p>
        <p className="text-[13px] text-fg-muted">{[a.start_datetime ?? a.start, a.end_datetime ?? a.end].filter(Boolean).join("  to  ")}</p>
        {a.attendees && <p className="mt-1 text-[12.5px] text-fg-subtle">{JSON.stringify(a.attendees)}</p>}
      </div>
    );
  }

  const entries = Object.entries(a).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return (
    <div className="rounded-[10px] border border-line-subtle px-3 py-2.5">
      <p className="mb-1.5 text-[13px] font-medium">{prettySlug(call.slug)}</p>
      {entries.length === 0 ? (
        <p className="text-[12.5px] text-fg-subtle">No parameters</p>
      ) : (
        <dl className="grid grid-cols-[minmax(80px,auto)_1fr] gap-x-3 gap-y-1 text-[13px]">
          {entries.slice(0, 12).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-subtle">{k.replaceAll("_", " ")}</dt>
              <dd className="break-words">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
