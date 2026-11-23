"use client";

// Rendering of a thread's items: messages, the light gray action rows (commands, edits, tools)
// and approval cards.
import { memo, useState } from "react";
import Link from "next/link";
import { Button, cn, toast } from "krts.ui";
import {
  IconAlertTriangle,
  IconBrain,
  IconChevronRight,
  IconFilePencil,
  IconLoader2,
  IconMessageCircle,
  IconShieldQuestion,
  IconTerminal2,
  IconTool,
} from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import type { CodeItem } from "@/lib/code-types";
import { Markdown } from "../chat/parts/markdown";
import { Collapse } from "../chat/parts/collapsible";
import { DiffLines } from "./diff";
import { RichText } from "../rich-text";

function ActionRow({
  icon: Icon,
  label,
  running,
  failed,
  children,
  extra,
}: {
  icon: typeof IconTool;
  label: React.ReactNode;
  running?: boolean;
  failed?: boolean;
  children?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => children && setOpen((o) => !o)}
        aria-expanded={children ? open : undefined}
        className="pressable -ml-1 inline-flex max-w-full items-center gap-2 rounded-[6px] px-1 py-0.5 text-[13.5px] text-fg-muted hover:text-fg"
      >
        <Icon size={15} stroke={1.5} className="shrink-0" />
        <span className={cn("min-w-0 truncate", running && "shimmer-text")}>{label}</span>
        {extra}
        {running && <IconLoader2 size={13} stroke={1.5} className="shrink-0 animate-spin motion-reduce:animate-none" />}
        {failed && <IconAlertTriangle size={13} stroke={1.5} className="shrink-0 text-danger" />}
        {children && <IconChevronRight size={13} stroke={1.5} className={cn("shrink-0 transition-transform duration-200", open && "rotate-90")} />}
      </button>
      {children && (
        <Collapse open={open}>
          <div className="ml-6 mt-1.5">{children}</div>
        </Collapse>
      )}
    </div>
  );
}

const pre = "max-h-72 overflow-auto rounded-[8px] bg-code p-2.5 font-mono text-[12px] leading-5 text-fg/85 whitespace-pre-wrap break-words";

const OPAL_TOOL_LABELS: Record<string, string> = {
  list_threads: "Looked at your other threads",
  read_thread: "Read another thread",
  send_message: "Sent a message to another thread",
  start_thread: "Started a thread",
  wait_thread: "Waited for another thread",
};

function count(diff?: string) {
  if (!diff) return null;
  let add = 0;
  let del = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) add++;
    else if (l.startsWith("-") && !l.startsWith("---")) del++;
  }
  return { add, del };
}

export const ItemView = memo(function ItemView({ item, threadId, streaming }: { item: CodeItem; threadId: string; streaming: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex flex-col items-end gap-1.5">
          {item.from && (
            <span className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
              <IconMessageCircle size={13} stroke={1.5} />
              From{" "}
              {item.from.threadId ? (
                <Link href={`/code/t/${item.from.threadId}`} className="text-fg-muted underline-offset-2 hover:underline">
                  {item.from.title}
                </Link>
              ) : (
                item.from.title
              )}
            </span>
          )}
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble bg-bubble px-4 py-2.5 text-[15px] leading-6">
            <RichText text={item.text} mentions={item.mentions} skill={item.skill} />
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="prose-opal">
          <Markdown text={item.text} streaming={streaming} />
        </div>
      );
    case "reasoning":
      return (
        <ActionRow icon={IconBrain} label="Thought">
          <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg-muted">{item.text}</p>
        </ActionRow>
      );
    case "command":
      return (
        <ActionRow
          icon={IconTerminal2}
          running={item.status === "running" && streaming}
          failed={item.status === "failed" || (item.exitCode != null && item.exitCode !== 0)}
          label={
            <>
              Ran <code className="font-mono text-[12.5px]">{item.command.split("\n")[0].slice(0, 120)}</code>
            </>
          }
        >
          <pre className={pre}>
            <span className="text-fg-subtle">$ {item.command}</span>
            {item.output ? `\n${item.output}` : ""}
            {item.exitCode != null && item.exitCode !== 0 ? `\n(exit ${item.exitCode})` : ""}
          </pre>
        </ActionRow>
      );
    case "edit": {
      const files = item.files;
      const label = files.length === 1 ? `${files[0].change === "add" ? "Created" : files[0].change === "delete" ? "Deleted" : "Edited"} ${files[0].path.split(/[\\/]/).pop()}` : `Edited ${files.length} files`;
      const total = files.reduce((acc, f) => {
        const c = count(f.diff);
        return c ? { add: acc.add + c.add, del: acc.del + c.del } : acc;
      }, { add: 0, del: 0 });
      return (
        <ActionRow
          icon={IconFilePencil}
          running={item.status === "running" && streaming}
          failed={item.status === "failed"}
          label={label}
          extra={
            total.add + total.del > 0 ? (
              <span className="flex shrink-0 gap-1.5 font-mono text-[11.5px]">
                {total.add > 0 && <span className="text-success">+{total.add}</span>}
                {total.del > 0 && <span className="text-danger">−{total.del}</span>}
              </span>
            ) : null
          }
        >
          <div className="flex flex-col gap-2">
            {files.map((f, i) => (
              <div key={i} className="overflow-hidden rounded-[8px] border border-line-subtle">
                <div className="truncate bg-surface px-2.5 py-1 font-mono text-[11.5px] text-fg-muted">{f.path}</div>
                {f.diff && <DiffLines text={f.diff} className="max-h-72" />}
              </div>
            ))}
          </div>
        </ActionRow>
      );
    }
    case "tool": {
      const label = item.server === "opal-code" ? (OPAL_TOOL_LABELS[item.name] ?? item.name) : item.name === "web_search" ? "Searched the web" : `Used ${item.name}`;
      return (
        <ActionRow icon={item.server === "opal-code" ? IconMessageCircle : IconTool} label={label} running={item.status === "running" && streaming} failed={item.status === "failed"}>
          <pre className={pre}>
            {item.input !== undefined ? JSON.stringify(item.input, null, 2) : ""}
            {item.output ? `\n\n${item.output}` : ""}
          </pre>
        </ActionRow>
      );
    }
    case "approval":
      return <ApprovalCard item={item} threadId={threadId} />;
    case "error":
      return (
        <div className="flex items-start gap-2 rounded-[10px] border border-danger/25 bg-danger/5 px-3 py-2 text-[13.5px] text-danger">
          <IconAlertTriangle size={15} stroke={1.5} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap break-words">{item.text}</span>
        </div>
      );
    case "notice":
      return <p className="text-center text-[12px] text-fg-subtle">{item.text}</p>;
  }
});

function ApprovalCard({ item, threadId }: { item: Extract<CodeItem, { kind: "approval" }>; threadId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const pending = item.status === "pending";
  async function decide(decision: "allow" | "allow_session" | "deny") {
    setBusy(decision);
    try {
      await apiFetch(`/api/code/threads/${threadId}/approvals`, { method: "POST", json: { requestId: item.requestId, decision } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (!pending) {
    return (
      <div className="inline-flex items-center gap-2 text-[13.5px] text-fg-muted">
        <IconShieldQuestion size={15} stroke={1.5} />
        <span className="truncate">
          {item.title}
          {item.command ? `: ${item.command.split("\n")[0].slice(0, 80)}` : ""}
        </span>
        <span className="text-[12px] text-fg-subtle">{item.status === "approved" ? "approved" : item.status === "denied" ? "denied" : "expired"}</span>
      </div>
    );
  }
  return (
    <div className="rounded-[18px] border border-line bg-overlay p-1.5 shadow-[0_8px_24px_-14px_rgb(0_0_0/0.3)]">
      <div className="px-2.5 pb-2.5 pt-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-warning">
          <IconShieldQuestion size={13} stroke={2} />
          Approval needed
        </div>
        <div className="mt-1.5 text-[14px] font-medium">{item.title}</div>
        {item.command && <pre className={cn(pre, "mt-2 max-h-40")}>{item.command}</pre>}
        {item.detail && <p className="mt-1.5 break-words text-[13px] text-fg-muted">{item.detail}</p>}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" className="btn-accent h-8 flex-1 rounded-[12px]" isPending={busy === "allow"} onPress={() => decide("allow")}>
          Allow once
        </Button>
        <Button size="sm" variant="secondary" className="h-8 flex-1 rounded-[12px]" isPending={busy === "allow_session"} onPress={() => decide("allow_session")}>
          Allow for this thread
        </Button>
        <Button size="sm" variant="ghost" className="h-8 flex-1 rounded-[12px] text-danger hover:bg-danger/10" isPending={busy === "deny"} onPress={() => decide("deny")}>
          Decline
        </Button>
      </div>
    </div>
  );
}
