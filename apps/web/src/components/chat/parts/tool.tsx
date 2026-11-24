"use client";

import { useState } from "react";
import { cn } from "krts.ui";
import {
  IconAlertTriangle,
  IconBook2,
  IconBrowser,
  IconCheck,
  IconChevronRight,
  IconCode,
  IconFile,
  IconLoader2,
  IconPlugConnected,
  IconSearch,
  IconTerminal2,
  IconTool,
  IconWorld,
  IconBrain,
  IconWand,
} from "@tabler/icons-react";
import Link from "next/link";
import type { ToolUIPart } from "ai";
import { useChatActions } from "../chat-context";
import { Collapse } from "./collapsible";
import { ApprovalCard } from "./approval";
import { SecretRequest } from "./secret-request";
import { AskUser } from "./ask-user";
import { GenUI } from "./genui";
import { QuizArtifact } from "./quiz";
import { FlashcardsArtifact } from "./flashcards";
import { HandwritingArtifact } from "./handwriting-artifact";
import { SharedFile } from "./shared-file";

type AnyToolPart = ToolUIPart & { input?: any; output?: any; errorText?: string; approval?: { id: string; approved?: boolean; reason?: string } };

// These tools show up as agent cards / message lines instead.
export const HIDDEN = new Set(["list_agents", "list_secrets"]);

// Tools that render as their own artifact or card rather than as a step in the work log.
export const CARD_TOOLS = new Set(["request_secret", "ask_user", "render_ui", "create_quiz", "create_flashcards", "write_by_hand", "remember", "forget", "share_file"]);

export function ToolPart({ part, name, streaming }: { part: AnyToolPart; name: string; streaming: boolean }) {
  if (part.state === "approval-requested") return <ApprovalCard part={part} name={name} />;

  switch (name) {
    case "request_secret":
      return <SecretRequest part={part} />;
    case "ask_user":
      return <AskUser part={part} />;
    case "render_ui":
      return <GenUI part={part} />;
    case "create_quiz":
      return <QuizArtifact part={part} />;
    case "create_flashcards":
      return <FlashcardsArtifact part={part} />;
    case "write_by_hand":
      return <HandwritingArtifact part={part} />;
    case "remember":
    case "forget":
      return <MemoryRow part={part} forgot={name === "forget"} />;
    case "share_file":
      return <SharedFile part={part} streaming={streaming} />;
  }

  if (HIDDEN.has(name)) {
    if (part.state === "output-error") return <ToolRow part={part} name={name} streaming={streaming} />;
    return null;
  }
  return <ToolRow part={part} name={name} streaming={streaming} />;
}

export function describe(name: string, input: any): { icon: typeof IconTool; label: string } {
  switch (name) {
    case "browser":
      return {
        icon: IconBrowser,
        label:
          input?.action === "goto" && input?.url
            ? `Opened ${host(input.url)}`
            : ({ read: "Read the page", click: "Clicked on the page", type: "Typed on the page", scroll: "Scrolled", back: "Went back", press: "Pressed a key" } as Record<string, string>)[input?.action] ?? "Used the browser",
      };
    case "terminal": {
      const first = String(input?.command ?? "").split("\n")[0];
      return { icon: IconTerminal2, label: `Ran ${first.slice(0, 60)}${first.length > 60 ? "…" : ""}` };
    }
    case "read_file":
    case "write_file":
    case "list_files":
      return { icon: IconFile, label: name === "write_file" ? `Wrote ${input?.path ?? "file"}` : name === "read_file" ? `Read ${input?.path ?? "file"}` : "Listed files" };
    case "share_file":
      return { icon: IconFile, label: `Attached ${String(input?.path ?? "a file").split("/").pop()}` };
    case "read_webpage":
      return { icon: IconWorld, label: `Read ${host(input?.url)}` };
    case "use_skill":
      return { icon: IconWand, label: `Used the ${input?.name ?? ""} skill` };
    case "remember":
      return { icon: IconBrain, label: "Saved to memory" };
    case "forget":
      return { icon: IconBrain, label: "Removed from memory" };
    case "code_overview":
      return { icon: IconCode, label: "Checked Opal Code" };
    case "code_start":
      return { icon: IconCode, label: `Started a ${input?.agent === "codex" ? "Codex" : "Claude Code"} thread in Opal Code` };
    case "code_message":
      return { icon: IconCode, label: "Messaged a coding thread" };
    case "code_read":
      return { icon: IconCode, label: "Read a coding thread" };
    case "web_search":
      return { icon: IconSearch, label: `Searched ${input?.kind === "news" ? "the news" : "the web"} for "${input?.query ?? ""}"` };
    case "study_search":
      return { icon: IconSearch, label: `Searched study material for "${input?.query ?? ""}"` };
    case "study_browse":
      return { icon: IconBook2, label: "Browsed study material" };
    case "study_read":
      return { icon: IconBook2, label: "Read study material" };
  }
  if (name.startsWith("COMPOSIO_")) {
    const slugs = Array.isArray(input?.tools) ? input.tools.map((t: any) => t?.tool_slug).filter(Boolean) : [];
    const pretty = name.replace("COMPOSIO_", "").toLowerCase().replaceAll("_", " ");
    return { icon: IconPlugConnected, label: slugs.length ? slugs.map(prettySlug).join(", ") : pretty };
  }
  return { icon: IconTool, label: name.replaceAll("_", " ") };
}

export function prettySlug(slug: string) {
  const s = String(slug).toLowerCase().split("_");
  const app = s.shift() ?? "";
  return `${app.charAt(0).toUpperCase()}${app.slice(1)}: ${s.join(" ")}`;
}

function host(u: unknown) {
  try {
    return new URL(String(u)).hostname;
  } catch {
    return "page";
  }
}

export function ToolRow({ part, name, streaming }: { part: AnyToolPart; name: string; streaming: boolean }) {
  const { nerd } = useChatActions();
  const [open, setOpen] = useState(false);
  const { icon: Icon, label } = describe(name, part.input);
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error" || (part.state === "output-available" && part.output?.ok === false);
  const denied = part.state === "output-denied" || (part.state === "approval-responded" && part.approval?.approved === false);
  const stale = running && !streaming;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable -ml-1 inline-flex max-w-full items-center gap-2 rounded-[6px] px-1 py-0.5 text-[13.5px] text-fg-muted hover:text-fg"
      >
        <Icon size={15} stroke={1.5} className="shrink-0" />
        <span className={cn("truncate", running && !stale && "shimmer-text")}>{label}</span>
        {running && !stale && <IconLoader2 size={13} stroke={1.5} className="shrink-0 animate-spin motion-reduce:animate-none" />}
        {failed && <IconAlertTriangle size={13} stroke={1.5} className="shrink-0 text-danger" />}
        {denied && <span className="text-[12px] text-fg-subtle">denied</span>}
        {part.state === "output-available" && !failed && nerd && <IconCheck size={13} stroke={1.75} className="shrink-0 text-success" />}
        <IconChevronRight size={13} stroke={1.5} className={cn("shrink-0 transition-transform duration-200", open && "rotate-90")} />
      </button>
      <Collapse open={open}>
        <div className="ml-6 mt-1.5 flex flex-col gap-1.5">
          {failed && <p className="text-[12.5px] text-danger">{part.errorText ?? part.output?.error ?? "Failed"}</p>}
          {name === "web_search" && Array.isArray(part.output?.results) && <SearchResults results={part.output.results} />}
          {name === "terminal" && part.output?.output && (
            <pre className="max-h-64 overflow-auto rounded-[8px] bg-code p-2.5 font-mono text-[12px] leading-5 text-fg/85">{part.output.output}</pre>
          )}
          {nerd || (name !== "terminal" && name !== "web_search") ? (
            <pre className="max-h-64 overflow-auto rounded-[8px] bg-code p-2.5 font-mono text-[11.5px] leading-[1.15rem] text-fg-muted">
              {JSON.stringify(nerd ? { input: part.input, output: part.output } : summarizeOutput(part.output), null, 2)}
            </pre>
          ) : null}
        </div>
      </Collapse>
    </div>
  );
}

/** "Memory updated": opens to show what was saved or removed. */
function MemoryRow({ part, forgot }: { part: AnyToolPart; forgot: boolean }) {
  const [open, setOpen] = useState(false);
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error" || part.output?.ok === false;
  const fact: string = part.output?.fact ?? part.input?.fact ?? "";
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable -ml-1 inline-flex max-w-full items-center gap-2 rounded-[6px] px-1 py-0.5 text-[13.5px] text-fg-muted hover:text-fg"
      >
        <IconBrain size={15} stroke={1.5} className="shrink-0" />
        <span className={cn("truncate", running && "shimmer-text")}>{failed ? "Couldn't update memory" : forgot ? "Removed from memory" : "Memory updated"}</span>
        <IconChevronRight size={13} stroke={1.5} className={cn("shrink-0 transition-transform duration-200", open && "rotate-90")} />
      </button>
      <Collapse open={open}>
        <div className="ml-1 mt-1.5 flex max-w-[620px] flex-col gap-1.5 border-l border-line pl-3">
          {fact && <p className={cn("text-[13.5px] text-fg/85", forgot && "line-through decoration-fg-subtle")}>{fact}</p>}
          {failed && <p className="text-[12.5px] text-danger">{part.output?.error ?? part.errorText}</p>}
          <Link href="/customization" className="w-fit text-[12.5px] text-fg-muted underline underline-offset-2 hover:text-fg">
            Manage memory
          </Link>
        </div>
      </Collapse>
    </div>
  );
}

function SearchResults({ results }: { results: { title: string; url: string; snippet: string; source: string; age?: string }[] }) {
  if (!results.length) return <p className="text-[12.5px] text-fg-muted">No results.</p>;
  return (
    <ol className="flex max-w-[620px] flex-col gap-2">
      {results.map((r) => (
        <li key={r.url} className="min-w-0">
          <a href={r.url} target="_blank" rel="noreferrer noopener" className="group block rounded-[8px] text-[13px]">
            <span className="block truncate text-fg/90 group-hover:underline group-hover:underline-offset-2">{r.title}</span>
            <span className="block truncate text-[12px] text-fg-subtle">
              {r.source}
              {r.age ? ` · ${r.age}` : ""}
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function summarizeOutput(out: any) {
  if (!out || typeof out !== "object") return out;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string") copy[k] = v.length > 600 ? `${v.slice(0, 600)}…` : v;
    else if (Array.isArray(v)) copy[k] = v.length > 8 ? [...v.slice(0, 8), `…${v.length - 8} more`] : v;
    else copy[k] = v;
  }
  return copy;
}
