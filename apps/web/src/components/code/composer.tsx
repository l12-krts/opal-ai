"use client";

// The Opal Code composer and its pill controls. Corners are concentric: the card is 22px round
// with 6px of padding, so everything sitting in its inner edge is 16px round (22 − 6).
//
// "@" mentions project files, other threads and Opal agents; "/" runs Code skills and a few
// commands. Picked mentions are drawn as chips behind the text and sent with the message.
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Dialog as AriaDialog, DialogTrigger } from "react-aria-components";
import { Button, Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger, Popover, cn } from "krts.ui";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconFile,
  IconFolderPlus,
  IconLock,
  IconLockOpen,
  IconPlayerStopFilled,
  IconShieldCheck,
  IconWand,
} from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { useAgents } from "@/lib/hooks";
import { useCodeSkills, useCodeState } from "@/lib/code-client";
import { CODE_AGENTS, leadingSkill, type CodeAgentId, type CodeMode, type MachineView, type Mention, type ProjectView } from "@/lib/code-types";
import { SuggestList, type SuggestItem } from "../chat/composer/suggest-list";
import { AgentFace } from "../agent-face";
import { AgentGlyph } from "./agent-glyph";
import { ProjectChip } from "./project-chip";

export const pill =
  "pressable inline-flex h-8 min-w-0 items-center gap-1.5 rounded-[16px] px-2.5 text-[13px] text-fg-muted outline-none transition-colors hover:bg-surface hover:text-fg data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent-line data-[pressed]:bg-surface-hover";

export type ComposerCommand = { id: string; label: string; icon: React.ReactNode; run: () => void; keywords?: string };

type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (mentions: Mention[]) => void;
  placeholder: string;
  canSend: boolean;
  pending?: boolean;
  working?: boolean;
  onStop?: () => void;
  autoFocus?: boolean;
  minHeight?: number;
  /** Pills on the left of the bottom row. */
  controls?: React.ReactNode;
  className?: string;
  /** Where @file search looks: the thread's folder, else the project's. */
  threadId?: string | null;
  projectId?: string | null;
  /** Built-in "/" commands besides Code skills. */
  commands?: ComposerCommand[];
};

type Trigger = { kind: "slash" | "mention"; query: string; start: number; end: number };

function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const slash = /^\/([\p{L}\p{N} _.-]{0,40})$/u.exec(before);
  if (slash && !text.slice(caret).trim()) return { kind: "slash", query: slash[1].toLowerCase(), start: 0, end: caret };
  const at = /(^|\s)@([^\s@]{0,80})$/u.exec(before);
  if (at) return { kind: "mention", query: at[2].toLowerCase(), start: caret - at[2].length - 1, end: caret };
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Item = SuggestItem & { run: () => void };

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  { value, onChange, onSubmit, placeholder, canSend, pending, working, onStop, autoFocus, minHeight = 52, controls, className, threadId, projectId, commands = [] },
  ref,
) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ta.current as HTMLTextAreaElement);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const { data: state } = useCodeState();
  const { data: skillsData } = useCodeSkills();
  const { data: agentsData } = useAgents();
  const skillNames = useMemo(() => (skillsData?.skills ?? []).filter((s) => s.enabled).map((s) => s.name), [skillsData]);

  // A sent (cleared) message forgets its mentions.
  useEffect(() => {
    if (!value) setMentions([]);
  }, [value]);

  const trigger = useMemo(() => detectTrigger(value, caret), [value, caret]);
  const key = trigger ? `${trigger.kind}:${trigger.start}` : null;
  const open = Boolean(trigger) && key !== dismissed;
  const mentionQuery = open && trigger?.kind === "mention" ? trigger.query : null;

  // File search runs on the machine; debounce it.
  useEffect(() => {
    if (mentionQuery === null || (!threadId && !projectId)) {
      setFiles([]);
      return;
    }
    const id = setTimeout(() => {
      const qs = new URLSearchParams({ q: mentionQuery, ...(threadId ? { thread: threadId } : { project: projectId! }) });
      apiFetch<{ files: string[] }>(`/api/code/files?${qs}`).then(
        (r) => setFiles(r.files),
        () => setFiles([]),
      );
    }, 120);
    return () => clearTimeout(id);
  }, [mentionQuery, threadId, projectId]);

  function replaceTrigger(insert: string) {
    if (!trigger) return;
    const next = value.slice(0, trigger.start) + insert + value.slice(trigger.end);
    const pos = trigger.start + insert.length;
    onChange(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    });
  }

  function addMention(m: Mention) {
    setMentions((cur) => (cur.some((x) => x.kind === m.kind && x.id === m.id) ? cur : [...cur, m]));
    replaceTrigger(`@${m.label} `);
  }

  const items: Item[] = (() => {
    if (!open || !trigger) return [];
    const q = trigger.query;
    if (trigger.kind === "slash") {
      const skills = (skillsData?.skills ?? [])
        .filter((s) => s.enabled)
        .map((s) => ({
          id: `skill:${s.id}`,
          label: `/${s.name}`,
          hint: s.description || "Skill",
          icon: <IconWand size={16} stroke={1.5} />,
          keywords: `${s.name} ${s.description}`.toLowerCase(),
          run: () => replaceTrigger(`/${s.name} `),
        }));
      const builtins = commands.map((c) => ({
        id: `cmd:${c.id}`,
        label: `/${c.id}`,
        hint: c.label,
        icon: c.icon,
        keywords: `${c.id} ${c.label} ${c.keywords ?? ""}`.toLowerCase(),
        run: () => {
          replaceTrigger("");
          c.run();
        },
      }));
      return [...skills, ...builtins].filter((c) => !q || c.keywords.includes(q)).slice(0, 12);
    }
    const out: Item[] = files.slice(0, 7).map((path) => ({
      id: `file:${path}`,
      label: path,
      hint: "File",
      icon: <IconFile size={16} stroke={1.5} />,
      run: () => addMention({ kind: "file", id: path, label: path }),
    }));
    for (const t of (state?.threads ?? []).filter((t) => t.id !== threadId && (!q || t.title.toLowerCase().includes(q))).slice(0, 4))
      out.push({ id: `thread:${t.id}`, label: t.title, hint: "Thread", icon: <AgentGlyph agent={t.agent} size={15} />, run: () => addMention({ kind: "thread", id: t.id, label: t.title }) });
    for (const a of (agentsData?.agents ?? []).filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 4))
      out.push({
        id: `agent:${a.id}`,
        label: a.name,
        hint: "Opal agent",
        icon: <AgentFace shape={a.shape} color={a.color} size={16} seed={a.name} />,
        run: () => addMention({ kind: "agent", id: a.id, label: a.name }),
      });
    return out;
  })();

  useEffect(() => setActive(0), [key, trigger?.query]);

  // Chips behind the text: the picked mentions and a leading /skill.
  const highlighted = useMemo(() => {
    const labels = mentions.map((m) => `@${m.label}`).filter((l) => value.includes(l));
    const skill = leadingSkill(value, skillNames);
    if (!labels.length && !skill) return null;
    const out: React.ReactNode[] = [];
    let rest = value;
    let offset = 0;
    if (skill) {
      out.push(
        <mark key="skill" className="opal-mention">
          {value.slice(0, skill.length + 1)}
        </mark>,
      );
      rest = value.slice(skill.length + 1);
      offset = skill.length + 1;
    }
    if (labels.length) {
      const re = new RegExp(labels.sort((a, b) => b.length - a.length).map(escapeRe).join("|"), "g");
      let last = 0;
      for (const m of rest.matchAll(re)) {
        out.push(rest.slice(last, m.index));
        out.push(
          <mark key={offset + m.index!} className="opal-mention">
            {m[0]}
          </mark>,
        );
        last = m.index! + m[0].length;
      }
      out.push(rest.slice(last));
    } else out.push(rest);
    return out;
  }, [value, mentions, skillNames]);

  const send = () => onSubmit(mentions.filter((m) => value.includes(`@${m.label}`)));
  const pad = "px-2.5 pb-1 pt-2 text-[15px] leading-6";

  return (
    <div className={cn("relative", className)}>
      {open && (items.length > 0 || trigger?.kind === "mention") && (
        <SuggestList
          id={listId}
          title={trigger?.kind === "slash" ? "Skills and commands" : "Mention a file, thread or Opal agent"}
          items={items}
          active={active}
          onPick={(it) => (it as Item).run()}
          onHover={setActive}
        />
      )}
      <form
        className="rounded-[22px] border border-line bg-overlay p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_10px_28px_-14px_rgb(0_0_0/0.22)] transition-[border-color,box-shadow] duration-150 focus-within:border-line-strong focus-within:shadow-[0_0_0_3px_rgb(0_0_0/0.035),0_10px_28px_-14px_rgb(0_0_0/0.25)] dark:focus-within:shadow-[0_0_0_3px_rgb(255_255_255/0.05),0_10px_28px_-14px_rgb(0_0_0/0.6)]"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="relative">
          {highlighted && (
            <div ref={backdrop} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent", pad)}>
              {highlighted}
            </div>
          )}
          <textarea
            ref={ta}
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setCaret(e.target.selectionStart);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onScroll={(e) => {
              if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onKeyDown={(e) => {
              if (open && items.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  items[active]?.run();
                  return;
                }
              }
              if (open && e.key === "Escape") {
                e.preventDefault();
                setDismissed(key);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={placeholder}
            aria-label="Message"
            aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && items.length ? `${listId}-${active}` : undefined}
            style={{ minHeight }}
            className={cn("relative block max-h-[38vh] w-full resize-none bg-transparent outline-none [field-sizing:content] placeholder:text-fg-subtle", pad)}
          />
        </div>
        <div className="flex min-w-0 items-center gap-0.5">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">{controls}</div>
          {working && onStop && (
            <Button size="sm" isIconOnly aria-label="Stop" variant="secondary" className="size-8 shrink-0 rounded-full" onPress={onStop}>
              <IconPlayerStopFilled size={13} />
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            isIconOnly
            aria-label="Send"
            isPending={pending}
            className={cn("size-8 shrink-0 rounded-full transition-colors", canSend ? "btn-accent" : "bg-surface text-fg-subtle")}
          >
            <IconArrowUp size={17} stroke={2} />
          </Button>
        </div>
      </form>
    </div>
  );
});

// ─── Agent / model picker ───────────────────────────────────────────────────

export type AgentPick = { agent: CodeAgentId; model: string };

const modelLabel = (agent: string, model: string) => CODE_AGENTS.find((a) => a.id === agent)?.models.find((m) => m.id === model)?.label ?? model;

export function AgentPicker({ value, onChange, isOk }: { value: AgentPick[]; onChange: (v: AgentPick[]) => void; isOk: (id: string) => boolean }) {
  const label =
    value.length > 1
      ? value.map((v) => CODE_AGENTS.find((a) => a.id === v.agent)?.label).join(" + ")
      : `${CODE_AGENTS.find((a) => a.id === value[0]?.agent)?.label ?? ""}${value[0] && value[0].model !== "default" ? ` · ${modelLabel(value[0].agent, value[0].model)}` : ""}`;

  function choose(agent: CodeAgentId, model: string, add: boolean) {
    const has = value.find((v) => v.agent === agent);
    if (add) {
      if (has && has.model === model && value.length > 1) return onChange(value.filter((v) => v.agent !== agent));
      return onChange(has ? value.map((v) => (v.agent === agent ? { agent, model } : v)) : [...value, { agent, model }]);
    }
    onChange([{ agent, model }]);
  }

  return (
    <DialogTrigger>
      <Button variant="ghost" className={pill} aria-label="Agent and model">
        <span className="flex -space-x-1">
          {value.map((v) => (
            <AgentGlyph key={v.agent} agent={v.agent} size={15} className="rounded-full bg-overlay" />
          ))}
        </span>
        <span className="truncate">{label}</span>
        <IconChevronDown size={13} stroke={1.75} className="shrink-0 text-fg-subtle" />
      </Button>
      <Popover placement="top start" className="w-[280px] overflow-hidden rounded-[16px] border border-line bg-overlay p-1.5 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.3)]">
        <AriaDialog aria-label="Agent and model" className="outline-none">
          {({ close }) => (
            <div className="flex flex-col">
              {CODE_AGENTS.map((a, i) => (
                <div key={a.id} className={cn(i > 0 && "mt-1 border-t border-line-subtle pt-1")}>
                  <div className="flex h-7 items-center gap-1.5 px-2 text-[12px] font-medium text-fg-subtle">
                    <AgentGlyph agent={a.id} size={13} />
                    {a.label}
                    {!isOk(a.id) && <span className="ml-auto font-normal text-warning">not set up</span>}
                  </div>
                  {a.models.map((m) => {
                    const on = value.some((v) => v.agent === a.id && v.model === m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={!isOk(a.id)}
                        onClick={(e) => {
                          choose(a.id, m.id, e.shiftKey || e.metaKey || e.ctrlKey);
                          if (!(e.shiftKey || e.metaKey || e.ctrlKey)) close();
                        }}
                        className={cn(
                          "flex h-8 w-full items-center gap-2 rounded-[10px] px-2 text-left text-[13.5px] outline-none hover:bg-surface focus-visible:bg-surface disabled:opacity-40",
                          on ? "text-fg" : "text-fg/80",
                        )}
                      >
                        <span className="flex-1">{m.label}</span>
                        {on && <IconCheck size={14} stroke={1.75} />}
                      </button>
                    );
                  })}
                </div>
              ))}
              <p className="mt-1 border-t border-line-subtle px-2 pb-0.5 pt-1.5 text-[11.5px] leading-4 text-fg-subtle">Shift-click to add another agent; each runs in its own thread and worktree.</p>
            </div>
          )}
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  );
}

// ─── Approval mode ──────────────────────────────────────────────────────────

export const MODES: { id: CodeMode; label: string; hint: string; icon: typeof IconLock }[] = [
  { id: "auto", label: "Auto", hint: "Safe steps run on their own; risky ones wait for you", icon: IconShieldCheck },
  { id: "ask", label: "Ask", hint: "Every edit and command waits for your OK", icon: IconLock },
  { id: "full", label: "Full access", hint: "Runs anything without asking", icon: IconLockOpen },
];

export function ModePicker({ value, onChange }: { value: CodeMode; onChange: (m: CodeMode) => void }) {
  const m = MODES.find((x) => x.id === value) ?? MODES[0];
  return (
    <MenuTrigger>
      <Button variant="ghost" className={cn(pill, value === "full" && "text-warning hover:text-warning")} aria-label={`Approvals: ${m.label}`}>
        <m.icon size={15} stroke={1.5} className="shrink-0" />
        <span className="truncate">{m.label}</span>
        <IconChevronDown size={13} stroke={1.75} className="shrink-0 text-fg-subtle" />
      </Button>
      <Menu placement="top start" onAction={(k) => onChange(k as CodeMode)} className="w-[280px]">
        {MODES.map((x) => (
          <MenuItem key={x.id} id={x.id} icon={<x.icon size={15} stroke={1.5} />} description={x.hint}>
            <span className="flex items-center gap-2">
              {x.label}
              {x.id === value && <IconCheck size={14} stroke={1.75} className="ml-auto" />}
            </span>
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

// ─── Where it runs ──────────────────────────────────────────────────────────

export function ProjectPicker({
  value,
  projects,
  machines,
  onChange,
  onNewProject,
}: {
  value: string;
  projects: ProjectView[];
  machines: MachineView[];
  onChange: (v: string) => void;
  onNewProject: () => void;
}) {
  const project = value.startsWith("p:") ? projects.find((p) => p.id === value.slice(2)) : undefined;
  const machine = machines.find((m) => m.id === (project ? project.machineId : value.slice(2)));
  const label = project?.name ?? "No project";
  return (
    <MenuTrigger>
      <Button variant="ghost" className={pill} aria-label="Project">
        <ProjectChip name={label} />
        <span className="truncate text-fg/85">{label}</span>
        {machines.length > 1 && machine && <span className="truncate text-fg-subtle">{machine.name}</span>}
        <IconChevronDown size={13} stroke={1.75} className="shrink-0 text-fg-subtle" />
      </Button>
      <Menu
        placement="bottom start"
        className="max-h-[50vh] w-[280px]"
        onAction={(k) => {
          if (k === "new") onNewProject();
          else onChange(String(k));
        }}
      >
        {machines.map((m) => (
          <MenuSection key={m.id} title={machines.length > 1 ? m.name : undefined}>
            {projects
              .filter((p) => p.machineId === m.id)
              .map((p) => (
                <MenuItem key={p.id} id={`p:${p.id}`} icon={<ProjectChip name={p.name} />}>
                  <span className="flex items-center gap-2">
                    <span className="truncate">{p.name}</span>
                    {value === `p:${p.id}` && <IconCheck size={14} stroke={1.75} className="ml-auto shrink-0" />}
                  </span>
                </MenuItem>
              ))}
            <MenuItem id={`m:${m.id}`} icon={<ProjectChip name="No project" />} description="A scratch folder on this machine">
              No project
            </MenuItem>
          </MenuSection>
        ))}
        <MenuSeparator />
        <MenuItem id="new" icon={<IconFolderPlus size={15} stroke={1.5} />} shortcut="">
          New project…
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
