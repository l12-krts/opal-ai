"use client";

// One Opal Code thread: the agent's timeline, a composer, and the Changes / Terminal panels.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Skeleton, cn, toast } from "krts.ui";
import { motion } from "motion/react";
import { IconChevronRight, IconEdit, IconFileDiff, IconGitBranch, IconLayoutSidebarRight, IconPlayerStopFilled, IconTerminal2, IconX } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { patchThread, useCodeState, useThread } from "@/lib/code-client";
import { agentLabel, isUnread, type CodeItem, type CodeMode, type Mention } from "@/lib/code-types";
import { IconButton } from "../ui";
import { Collapse } from "../chat/parts/collapsible";
import { AgentGlyph } from "./agent-glyph";
import { ItemView } from "./items";
import { DiffPanel } from "./diff";
import { TerminalPanel } from "./terminal-panel";
import { Composer, ModePicker, pill } from "./composer";
import { ProjectChip } from "./project-chip";
import { SidePanel } from "./side-panel";

type Panel = "diff" | "terminal" | null;
type Block = { kind: "item"; item: CodeItem } | { kind: "work"; items: CodeItem[]; key: string } | { kind: "changes"; files: Map<string, { add: number; del: number }>; key: string };

const WORK = new Set(["reasoning", "command", "edit", "tool", "notice"]);

function counts(diff?: string) {
  let add = 0;
  let del = 0;
  for (const l of (diff ?? "").split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) add++;
    else if (l.startsWith("-") && !l.startsWith("---")) del++;
  }
  return { add, del };
}

/** Groups runs of tool activity, and adds a "changed files" card at the end of each turn. */
function toBlocks(items: CodeItem[], working: boolean): Block[] {
  const out: Block[] = [];
  let work: CodeItem[] = [];
  let files = new Map<string, { add: number; del: number }>();
  let firstEdit = "";
  const flushWork = () => {
    if (work.length) out.push({ kind: "work", items: work, key: `w_${work[0].id}` });
    work = [];
  };
  const flushTurn = () => {
    flushWork();
    if (files.size) out.push({ kind: "changes", files, key: `c_${firstEdit}` });
    files = new Map();
    firstEdit = "";
  };
  for (const it of items) {
    if (it.kind === "user") {
      if (out.length) flushTurn();
      out.push({ kind: "item", item: it });
      continue;
    }
    if (it.kind === "edit") {
      firstEdit ||= it.id;
      for (const f of it.files) {
        const c = counts(f.diff);
        const prev = files.get(f.path) ?? { add: 0, del: 0 };
        files.set(f.path, { add: prev.add + c.add, del: prev.del + c.del });
      }
    }
    if (WORK.has(it.kind)) work.push(it);
    else {
      flushWork();
      out.push({ kind: "item", item: it });
    }
  }
  if (working) flushWork();
  else flushTurn();
  return out;
}

function duration(items: CodeItem[]) {
  const ms = new Date(items[items.length - 1].updatedAt).getTime() - new Date(items[0].createdAt).getTime();
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function WorkGroup({ items, threadId, live }: { items: CodeItem[]; threadId: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (live || items.length < 2) {
    return (
      <div className="flex flex-col gap-1.5">
        {items.map((it) => (
          <ItemView key={it.id} item={it} threadId={threadId} streaming={live} />
        ))}
      </div>
    );
  }
  const edits = items.filter((i) => i.kind === "edit").length;
  const cmds = items.filter((i) => i.kind === "command").length;
  const failed = items.some((i) => ("status" in i && i.status === "failed") || (i.kind === "command" && i.exitCode != null && i.exitCode !== 0));
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable -ml-1 inline-flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-[13.5px] text-fg-muted hover:text-fg"
      >
        Worked for {duration(items)}
        <span className="text-fg-subtle">
          {[cmds && `${cmds} command${cmds > 1 ? "s" : ""}`, edits && `${edits} edit${edits > 1 ? "s" : ""}`].filter(Boolean).join(", ")}
        </span>
        {failed && <span className="size-1.5 rounded-full bg-danger" aria-label="Something failed" />}
        <IconChevronRight size={13} stroke={1.5} className={cn("transition-transform duration-200", open && "rotate-90")} />
      </button>
      <Collapse open={open}>
        <div className="ml-1 mt-1.5 flex flex-col gap-1.5 border-l border-line-subtle pl-3">
          {items.map((it) => (
            <ItemView key={it.id} item={it} threadId={threadId} streaming={false} />
          ))}
        </div>
      </Collapse>
    </div>
  );
}

function Counts({ add, del }: { add: number; del: number }) {
  return (
    <span className="flex shrink-0 gap-1.5 font-mono text-[12px]">
      {add > 0 && <span className="text-success">+{add}</span>}
      {del > 0 && <span className="text-danger">−{del}</span>}
    </span>
  );
}

function ChangesCard({ files, onOpen }: { files: Map<string, { add: number; del: number }>; onOpen: () => void }) {
  const total = [...files.values()].reduce((a, b) => ({ add: a.add + b.add, del: a.del + b.del }), { add: 0, del: 0 });
  return (
    <div className="overflow-hidden rounded-[14px] border border-line-subtle bg-overlay">
      <div className="flex h-10 items-center gap-2 px-3 text-[13px]">
        <span className="font-medium">
          {files.size} changed file{files.size > 1 ? "s" : ""}
        </span>
        <Counts {...total} />
        <button type="button" onClick={onOpen} className="pressable ml-auto inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-[12.5px] text-fg-muted hover:bg-surface hover:text-fg">
          <IconFileDiff size={14} stroke={1.5} />
          Open diff
        </button>
      </div>
      <ul className="border-t border-line-subtle py-1">
        {[...files.entries()].slice(0, 8).map(([path, c]) => (
          <li key={path} className="flex h-7 items-center gap-2 px-3 font-mono text-[12px] text-fg-muted">
            <span className="min-w-0 flex-1 truncate">{path}</span>
            <Counts {...c} />
          </li>
        ))}
        {files.size > 8 && <li className="px-3 py-1 text-[12px] text-fg-subtle">and {files.size - 8} more</li>}
      </ul>
    </div>
  );
}

const blockKey = (b: Block) => (b.kind === "item" ? b.item.id : b.key);

/** New timeline entries settle in from just below instead of popping (no jarring change). */
function Appear({ fresh, children }: { fresh: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      initial={fresh ? { opacity: 0, transform: "translateY(6px)" } : false}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function ThreadView({ id }: { id: string }) {
  const { data, error } = useThread(id);
  const { data: state } = useCodeState();
  const router = useRouter();
  const [panel, setPanelState] = useState<Panel>(null);
  // Panels opened from the keyboard appear instantly; clicks animate.
  const [instant, setInstant] = useState(false);
  const lastPanel = useRef<Exclude<Panel, null>>("diff");
  if (panel) lastPanel.current = panel;
  const setPanel = (next: Panel | ((p: Panel) => Panel), viaKeyboard = false) => {
    setInstant(viaKeyboard);
    setPanelState(next);
  };
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const ta = useRef<HTMLTextAreaElement>(null);

  const thread = data?.thread;
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const working = thread?.status === "working" || thread?.status === "waiting";
  const blocks = useMemo(() => toBlocks(items, Boolean(working)), [items, working]);
  // Blocks already there when the thread opened render still; later ones ease in.
  const seen = useRef<Set<string> | null>(null);
  if (!seen.current && data) seen.current = new Set(blocks.map(blockKey));
  const project = state?.projects.find((p) => p.id === thread?.projectId);
  const machine = state?.machines.find((m) => m.id === thread?.machineId);
  const parent = state?.threads.find((t) => t.id === thread?.parentThreadId);
  const siblings = thread?.groupId ? (state?.threads.filter((t) => t.groupId === thread.groupId && t.id !== thread.id) ?? []) : [];

  // Opening a thread marks it read, and keeps it read while you watch.
  useEffect(() => {
    if (!thread || !isUnread(thread) || thread.status === "working") return;
    if (document.visibilityState !== "visible") return;
    void patchThread(thread.id, { read: true }).catch(() => {});
  }, [thread?.id, thread?.lastActivityAt, thread?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (e.key === "j") {
        e.preventDefault();
        setPanel((p) => (p === "terminal" ? null : "terminal"), true);
      }
      if (e.key === "d" && e.altKey) {
        e.preventDefault();
        setPanel((p) => (p === "diff" ? null : "diff"), true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send(mentions: Mention[] = []) {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await apiFetch(`/api/code/threads/${id}/messages`, { method: "POST", json: { text: body, mentions } });
      setText("");
      stick.current = true;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
      ta.current?.focus();
    }
  }

  async function stop() {
    await apiFetch(`/api/code/threads/${id}/interrupt`, { method: "POST" }).catch((e: Error) => toast.error(e.message));
  }

  if (error) return <div className="flex flex-1 items-center justify-center text-[14px] text-fg-muted">{(error as Error).message}</div>;
  if (!thread) {
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-4 px-5 pt-20">
        <Skeleton className="ml-auto h-10 w-2/3 rounded-[18px]" />
        <Skeleton className="h-24 rounded-[12px]" />
      </div>
    );
  }

  const lastBlock = blocks[blocks.length - 1];
  const liveWork = lastBlock?.kind === "work" && thread.status === "working";
  const showWorking = thread.status === "working" && !liveWork;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 pl-12 pr-2 md:pl-5">
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-2 text-[14px]">
            {project ? (
              <span className="flex min-w-[64px] max-w-[38%] shrink-0 items-center gap-1.5 text-fg-muted">
                <ProjectChip name={project.name} />
                <span className="truncate">{project.name}</span>
              </span>
            ) : (
              <span className="shrink-0 text-fg-muted">No project</span>
            )}
            <span className="text-fg-subtle" aria-hidden="true">
              /
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{thread.title}</span>
          </nav>
          {thread.branch && (
            <span className={cn("hidden min-w-0 max-w-[220px] items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] text-fg-muted", panel ? "2xl:flex" : "lg:flex")}>
              <IconGitBranch size={13} stroke={1.6} className="shrink-0" />
              <span className="truncate">{thread.branch}</span>
            </span>
          )}
          <IconButton label="Changes" shortcut="Ctrl Alt D" onPress={() => setPanel((p) => (p === "diff" ? null : "diff"))} className={cn(panel === "diff" && "bg-surface-hover text-fg")}>
            <IconFileDiff size={17} stroke={1.5} />
          </IconButton>
          <IconButton label="Terminal" shortcut="Ctrl J" onPress={() => setPanel((p) => (p === "terminal" ? null : "terminal"))} className={cn(panel === "terminal" && "bg-surface-hover text-fg")}>
            <IconTerminal2 size={17} stroke={1.5} />
          </IconButton>
          <IconButton label={panel ? "Hide panel" : "Show changes"} onPress={() => setPanel((p) => (p ? null : "diff"))} className="hidden md:inline-flex">
            <IconLayoutSidebarRight size={17} stroke={1.5} />
          </IconButton>
        </header>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 pb-10 pt-4 md:px-6">
            {(parent || siblings.length > 0) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-subtle">
                {parent && (
                  <span>
                    Started by{" "}
                    <Link href={`/code/t/${parent.id}`} className="text-fg-muted hover:underline">
                      {parent.title}
                    </Link>
                  </span>
                )}
                {siblings.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    Also running:
                    {siblings.map((s) => (
                      <Link key={s.id} href={`/code/t/${s.id}`} className="inline-flex items-center gap-1 text-fg-muted hover:underline">
                        <AgentGlyph agent={s.agent} size={12} />
                        {agentLabel(s.agent)}
                      </Link>
                    ))}
                  </span>
                )}
              </div>
            )}
            {blocks.map((b, i) => (
              <Appear key={blockKey(b)} fresh={!seen.current?.has(blockKey(b))}>
                {b.kind === "item" ? (
                  <ItemView item={b.item} threadId={thread.id} streaming={working} />
                ) : b.kind === "work" ? (
                  <WorkGroup items={b.items} threadId={thread.id} live={liveWork && i === blocks.length - 1} />
                ) : (
                  <ChangesCard files={b.files} onOpen={() => setPanel("diff")} />
                )}
              </Appear>
            ))}
            {showWorking && <p className="opal-fade shimmer-text text-[13.5px]">Working…</p>}
          </div>
        </div>

        <div className="shrink-0 px-3 pb-3 md:px-6">
          <Composer
            ref={ta}
            className="mx-auto w-full max-w-[760px]"
            value={text}
            onChange={setText}
            onSubmit={send}
            threadId={thread.id}
            commands={[
              { id: "diff", label: "Show changes", icon: <IconFileDiff size={16} stroke={1.5} />, run: () => setPanel("diff") },
              { id: "terminal", label: "Open the terminal", icon: <IconTerminal2 size={16} stroke={1.5} />, run: () => setPanel("terminal") },
              ...(working ? [{ id: "stop", label: "Stop the agent", icon: <IconPlayerStopFilled size={14} />, run: () => void stop() }] : []),
              { id: "new", label: "New thread", icon: <IconEdit size={16} stroke={1.5} />, run: () => router.push(`/code${thread.projectId ? `?project=${thread.projectId}` : ""}`) },
            ]}
            canSend={Boolean(text.trim())}
            pending={sending}
            working={working}
            onStop={stop}
            placeholder={working ? "Send a follow-up (it runs after this turn)" : "Reply"}
            controls={
              <>
                <span className={cn(pill, "pointer-events-none")}>
                  <AgentGlyph agent={thread.agent} size={15} />
                  <span className="truncate">
                    {agentLabel(thread.agent)}
                    {thread.model && thread.model !== "default" ? ` · ${thread.model}` : ""}
                  </span>
                </span>
                <ModePicker value={thread.mode} onChange={(m: CodeMode) => void patchThread(thread.id, { mode: m })} />
                {machine && !machine.online && <span className="truncate px-2 text-[12px] text-warning">{machine.name} is offline</span>}
              </>
            }
          />
        </div>
      </div>

      <SidePanel open={Boolean(panel)} instant={instant} contentKey={lastPanel.current}>
        <div className="absolute right-2 top-1.5 z-10">
          <IconButton label="Close panel" onPress={() => setPanel(null)}>
            <IconX size={16} stroke={1.5} />
          </IconButton>
        </div>
        {lastPanel.current === "terminal" ? <TerminalPanel threadId={thread.id} /> : <DiffPanel thread={thread} />}
      </SidePanel>
    </div>
  );
}
