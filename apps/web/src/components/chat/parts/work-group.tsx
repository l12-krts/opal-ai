"use client";
// Consecutive thinking + tool steps collapse into one quiet row, like a work log:
// while running it shows the current step; when done, a one-line summary you can open.
import { useState } from "react";
import { cn } from "krts.ui";
import { IconChevronRight } from "@tabler/icons-react";
import { getToolName } from "ai";
import { useChatActions } from "../chat-context";
import { Collapse } from "./collapsible";
import { ToolRow, describe } from "./tool";

type AnyPart = { type: string; text?: string; state?: string; input?: unknown };

export function WorkGroup({ parts, active }: { parts: AnyPart[]; active: boolean }) {
  const { nerd } = useChatActions();
  const [open, setOpen] = useState(nerd);
  const tools = parts.filter((p) => p.type !== "reasoning");
  const last = parts[parts.length - 1];
  const current = last.type === "reasoning" ? "Thinking" : describe(getToolName(last as never), (last as { input?: unknown }).input).label;
  const labels = [...new Set(tools.map((p) => verbOf(describe(getToolName(p as never), p.input).label)))];
  const summary = labels.length ? `${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` and ${labels.length - 3} more` : ""}` : "Thought";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable -ml-1 inline-flex max-w-full items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-[13.5px] text-fg-muted hover:text-fg"
      >
        <span className={cn("truncate", active && "shimmer-text")}>{active ? current : summary}</span>
        {!active && tools.length > 0 && <span className="shrink-0 text-[12px] tabular-nums text-fg-subtle">{tools.length} step{tools.length === 1 ? "" : "s"}</span>}
        <IconChevronRight size={13} stroke={1.5} className={cn("shrink-0 transition-transform duration-200", open && "rotate-90")} />
      </button>
      <Collapse open={open}>
        <div className="ml-1 mt-1.5 flex flex-col gap-1.5 border-l border-line pl-3">
          {parts.map((p, i) =>
            p.type === "reasoning" ? (
              p.text?.trim() ? (
                <p key={i} className={cn("whitespace-pre-wrap text-[13px] leading-[1.35rem] text-fg-subtle", !nerd && "line-clamp-3")}>
                  {p.text}
                </p>
              ) : null
            ) : (
              <ToolRow key={i} part={p as never} name={getToolName(p as never)} streaming={active} />
            ),
          )}
        </div>
      </Collapse>
    </div>
  );
}

/** "Searched study material for x" → "Searched study material". */
function verbOf(label: string) {
  return label
    .replace(/ for "[\s\S]*$/, "")
    .replace(/^Ran [\s\S]*/, "Ran commands")
    .replace(/^(Opened|Browser) [\s\S]*/, "Used the browser")
    .replace(/^(Read|Wrote) \S+\.\w+$/, "Worked with files");
}
