"use client";

// Opal Code's sidebar: the Inbox, T3 Code style. One list ordered by what needs you: approvals
// and errors first, then work in progress, then finished work (unread first). Pinned threads sit
// on top; snoozed and settled threads wait in shelves at the bottom.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Button, Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger, WithTooltip, cn, toast } from "krts.ui";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconDots,
  IconEdit,
  IconFilter,
  IconFilterFilled,
  IconFolder,
  IconFolderPlus,
  IconGitBranch,
  IconInbox,
  IconMessageCircle,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconSearch,
  IconServer2,
  IconSettings,
  IconShieldQuestion,
  IconTrash,
  IconZzz,
} from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { patchThread, relTime, snoozeOptions, useCodeLive, useCodeState } from "@/lib/code-client";
import { inboxSection, isUnread, type ThreadView } from "@/lib/code-types";
import { OpalCodeWordmark } from "../brand";
import { Confirm, IconButton } from "../ui";
import { AgentGlyph } from "./agent-glyph";
import { Kbd, openPalette } from "./command-palette";
import { ProjectChip } from "./project-chip";
import { Collapse } from "../chat/parts/collapsible";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const FILTER_KEY = "opal.code.project";
const RANK = { needs: 0, working: 1, done: 2 } as const;

export function CodeSidebar({ onNavigate }: { onNavigate?: () => void }) {
  useCodeLive();
  const pathname = usePathname();
  const router = useRouter();
  const { data } = useCodeState();
  const [project, setProject] = useState<string>(() => {
    try {
      return localStorage.getItem(FILTER_KEY) ?? "all";
    } catch {
      return "all";
    }
  });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  const lists = useMemo(() => {
    const pinned: ThreadView[] = [];
    const inbox: ThreadView[] = [];
    const snoozed: ThreadView[] = [];
    const settled: ThreadView[] = [];
    for (const t of data?.threads ?? []) {
      if (project !== "all" && t.projectId !== project) continue;
      const s = inboxSection(t);
      if (s === "pinned") pinned.push(t);
      else if (s === "snoozed") snoozed.push(t);
      else if (s === "settled") settled.push(t);
      else inbox.push(t);
    }
    inbox.sort((a, b) => {
      const ra = RANK[inboxSection(a) as keyof typeof RANK] * 2 + (inboxSection(a) === "done" && !isUnread(a) ? 1 : 0);
      const rb = RANK[inboxSection(b) as keyof typeof RANK] * 2 + (inboxSection(b) === "done" && !isUnread(b) ? 1 : 0);
      return ra - rb || b.lastActivityAt.localeCompare(a.lastActivityAt);
    });
    return { pinned, inbox, snoozed, settled };
  }, [data, project]);

  const projectName = (id: string | null) => data?.projects.find((p) => p.id === id)?.name;
  const online = data?.machines.filter((m) => m.online).length ?? 0;
  const activeId = pathname.startsWith("/code/t/") ? pathname.split("/")[3] : null;
  const empty = data && !lists.pinned.length && !lists.inbox.length && !lists.snoozed.length && !lists.settled.length;
  const filtered = project !== "all" ? data?.projects.find((p) => p.id === project) : undefined;

  function setFilter(v: string) {
    setProject(v);
    try {
      localStorage.setItem(FILTER_KEY, v);
    } catch {}
  }

  const row = (t: ThreadView) => <ThreadRow key={t.id} t={t} active={t.id === activeId} project={projectName(t.projectId)} onNavigate={onNavigate} />;

  return (
    <nav className="flex h-full w-full min-w-0 flex-col" aria-label="Opal Code">
      <div className="mt-0.75 flex h-12 shrink-0 items-center justify-between pl-[16px] pr-2">
        <Link href="/code" className="pressable flex h-7 items-center rounded-[6px] px-1 text-fg" aria-label="Opal Code home" onClick={onNavigate}>
          <OpalCodeWordmark height={20} />
        </Link>
        <IconButton label="Back to chat" onPress={() => router.push("/")}>
          <IconMessageCircle size={18} stroke={1.5} />
        </IconButton>
      </div>

      <div className="flex items-center gap-0.5 px-2.5 pt-1">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            openPalette();
          }}
          className="pressable flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] pl-[11px] pr-2 text-[13.5px] text-fg-muted hover:bg-surface hover:text-fg"
        >
          <IconSearch size={16} stroke={1.6} className="shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <span className="hidden items-center gap-0.5 md:flex">
            <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        {(data?.projects.length ?? 0) > 1 && (
          <MenuTrigger>
            <WithTooltip content="Filter by project" delay={500}>
              <Button variant="ghost" size="xs" isIconOnly aria-label="Filter by project" className={cn("size-8 text-fg-muted hover:text-fg", filtered && "text-fg")}>
                {filtered ? <IconFilterFilled size={15} /> : <IconFilter size={16} stroke={1.5} />}
              </Button>
            </WithTooltip>
            <Menu placement="bottom end" onAction={(k) => setFilter(String(k))}>
              <MenuSection>
                <MenuItem id="all" icon={project === "all" ? <IconCheck size={15} stroke={1.75} /> : <span className="w-[15px]" />}>
                  All projects
                </MenuItem>
              </MenuSection>
              <MenuSeparator />
              <MenuSection>
                {(data?.projects ?? []).map((p) => (
                  <MenuItem key={p.id} id={p.id} icon={project === p.id ? <IconCheck size={15} stroke={1.75} /> : <ProjectChip name={p.name} />}>
                    {p.name}
                  </MenuItem>
                ))}
              </MenuSection>
            </Menu>
          </MenuTrigger>
        )}
        <IconButton label="New project" onPress={() => (onNavigate?.(), openPalette("project"))} className="size-8">
          <IconFolderPlus size={16} stroke={1.5} />
        </IconButton>
        <IconButton label="New thread" onPress={() => (onNavigate?.(), router.push("/code"))} className={cn("size-8", pathname === "/code" && "bg-surface-hover text-fg")}>
          <IconEdit size={16} stroke={1.5} />
        </IconButton>
      </div>

      {filtered && (
        <div className="px-3.5 pt-1.5">
          <button type="button" onClick={() => setFilter("all")} className="pressable inline-flex items-center gap-1.5 rounded-full bg-surface py-0.5 pl-1 pr-2 text-[12px] text-fg-muted hover:text-fg">
            <ProjectChip name={filtered.name} />
            {filtered.name}
            <span aria-hidden="true" className="text-fg-subtle">
              ×
            </span>
            <span className="sr-only">Show all projects</span>
          </button>
        </div>
      )}

      <LayoutGroup>
      <motion.div layoutScroll className="mt-2 min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {empty && (
          <div className="flex flex-col items-center gap-2 px-4 pt-12 text-center text-[13px] text-fg-subtle">
            <IconInbox size={22} stroke={1.4} />
            {filtered ? `No threads in ${filtered.name}` : "Threads you start show up here."}
          </div>
        )}
        {lists.pinned.length > 0 && (
          <>
            <h3 className="flex h-7 items-center gap-1.5 px-2.5 text-[12px] font-medium text-fg-subtle">
              <IconPin size={12} stroke={1.75} />
              Pinned
            </h3>
            <ul className="mb-2 flex flex-col gap-0.5">
              <AnimatePresence initial={false}>{lists.pinned.map(row)}</AnimatePresence>
            </ul>
          </>
        )}
        <ul className="flex flex-col gap-0.5">
          <AnimatePresence initial={false}>{lists.inbox.map(row)}</AnimatePresence>
        </ul>
        {(["snoozed", "settled"] as const).map((k) => {
          const list = lists[k];
          if (!list.length) return null;
          return (
            <section key={k} className="mt-2">
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}
                className="flex h-8 w-full items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] text-fg-muted hover:bg-surface hover:text-fg"
                aria-expanded={Boolean(open[k])}
              >
                {k === "snoozed" ? <IconZzz size={14} stroke={1.5} /> : <IconInbox size={14} stroke={1.5} />}
                {k === "snoozed" ? "Snoozed" : "Settled"}
                <span className="ml-auto tabular-nums text-fg-subtle">{list.length}</span>
                <IconChevronRight size={13} stroke={1.75} className={cn("text-fg-subtle transition-transform duration-150", open[k] && "rotate-90")} />
              </button>
              <Collapse open={Boolean(open[k])}>
                <ul className="mt-0.5 flex flex-col gap-0.5">{list.map(row)}</ul>
              </Collapse>
            </section>
          );
        })}
      </motion.div>
      </LayoutGroup>

      <div className="flex items-center gap-0.5 border-t border-line-subtle px-2.5 py-2">
        <IconButton label="Projects" onPress={() => (onNavigate?.(), router.push("/code/settings/projects"))} className={cn(pathname.startsWith("/code/settings/projects") && "bg-surface-hover text-fg")}>
          <IconFolder size={17} stroke={1.5} />
        </IconButton>
        <IconButton label={`Machines · ${online} online`} onPress={() => (onNavigate?.(), router.push("/code/settings/machines"))} className={cn("relative", pathname.startsWith("/code/settings/machines") && "bg-surface-hover text-fg")}>
          <IconServer2 size={17} stroke={1.5} />
          {(data?.machines.length ?? 0) > 0 && (
            <span className={cn("absolute right-[5px] top-[5px] size-[7px] rounded-full ring-2 ring-sidebar", online ? "bg-success" : "bg-fg-subtle")} />
          )}
        </IconButton>
        <IconButton
          label="Code settings"
          onPress={() => (onNavigate?.(), router.push("/code/settings"))}
          className={cn(
            (pathname === "/code/settings" || pathname.startsWith("/code/settings/skills")) && "bg-surface-hover text-fg",
          )}
        >
          <IconSettings size={17} stroke={1.5} />
        </IconButton>
      </div>
    </nav>
  );
}

function StatusChip({ t }: { t: ThreadView }) {
  if (t.status === "waiting")
    return (
      <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-warning">
        <IconShieldQuestion size={13} stroke={1.75} />
        Approval
      </span>
    );
  if (t.status === "error")
    return (
      <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-danger">
        <IconAlertTriangle size={13} stroke={1.75} />
        Error
      </span>
    );
  if (t.status === "working") return <span className="shimmer-text shrink-0 text-[12px]">Working</span>;
  if (isUnread(t))
    return (
      <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-success">
        <IconCircleCheck size={13} stroke={1.75} />
        Done
      </span>
    );
  return <span className="shrink-0 text-[12px] tabular-nums text-fg-subtle">{relTime(t.lastActivityAt)}</span>;
}

function ThreadRow({ t, active, project, onNavigate }: { t: ThreadView; active: boolean; project?: string; onNavigate?: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [confirm, setConfirm] = useState(false);
  const unread = isUnread(t) && t.status !== "working";

  async function act(key: string) {
    try {
      if (key === "rename") return setEditing(true);
      if (key === "delete") return setConfirm(true);
      if (key === "pin") return await patchThread(t.id, { pinned: !t.pinnedAt });
      if (key === "settle") return await patchThread(t.id, { settled: !t.settledAt });
      if (key === "wake") return await patchThread(t.id, { snoozedUntil: null });
      if (key.startsWith("snooze:")) {
        const o = snoozeOptions().find((x) => x.id === key.slice(7));
        if (o) {
          await patchThread(t.id, { snoozedUntil: o.until.toISOString() });
          toast(`Snoozed ${o.label.toLowerCase()}`, { action: { label: "Undo", onClick: () => void patchThread(t.id, { snoozedUntil: null }) } } as never);
        }
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function rename() {
    setEditing(false);
    const next = title.trim();
    if (!next || next === t.title) return setTitle(t.title);
    await patchThread(t.id, { title: next }).catch(() => toast.error("Couldn't rename"));
  }

  const snoozed = t.snoozedUntil && new Date(t.snoozedUntil) > new Date();

  return (
    // Rows glide to their new place when a thread changes status (spatial consistency); new
    // threads fade in, removed ones fade out. Positions only, so text never scales.
    <motion.li
      layout="position"
      layoutId={`thread-row-${t.id}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ layout: { duration: 0.25, ease: EASE_OUT }, opacity: { duration: 0.18, ease: EASE_OUT } }}
      className="group relative"
    >
      <Link
        href={`/code/t/${t.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-col gap-[3px] rounded-[12px] px-2.5 py-2 transition-colors duration-100",
          active ? "bg-surface-hover" : "hover:bg-surface",
        )}
      >
        <span className="flex h-4 items-center gap-1.5">
          <ProjectChip name={project ?? "No project"} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">{project ?? "No project"}</span>
          <span className="transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
            <StatusChip t={t} />
          </span>
        </span>
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={rename}
            onClick={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setTitle(t.title);
                setEditing(false);
              }
            }}
            maxLength={120}
            aria-label="Thread title"
            className="-mx-1 h-6 rounded-[6px] border border-line bg-bg px-1 text-[14px] outline-none focus:border-accent-line"
          />
        ) : (
          <span className={cn("truncate text-[14px] leading-5", unread || active ? "font-medium text-fg" : "text-fg/85")}>{t.title}</span>
        )}
        <span className="flex h-4 items-center gap-1 text-[12px] text-fg-subtle">
          {t.branch ? (
            <>
              <IconGitBranch size={12} stroke={1.6} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t.branch}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate">{t.preview ?? ""}</span>
          )}
          <AgentGlyph agent={t.agent} size={13} className="opacity-80" />
        </span>
      </Link>
      <div className={cn("absolute right-1.5 top-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100")}>
        <MenuTrigger>
          <Button variant="ghost" size="xs" isIconOnly aria-label="Thread options" className="size-6 text-fg-muted">
            <IconDots size={15} stroke={1.5} />
          </Button>
          <Menu placement="bottom start" onAction={(k) => void act(String(k))}>
            <MenuItem id="pin" icon={t.pinnedAt ? <IconPinnedOff size={15} stroke={1.5} /> : <IconPin size={15} stroke={1.5} />}>
              {t.pinnedAt ? "Unpin" : "Pin"}
            </MenuItem>
            {snoozed ? (
              <MenuItem id="wake" icon={<IconZzz size={15} stroke={1.5} />}>
                Wake up
              </MenuItem>
            ) : (
              snoozeOptions().map((o) => (
                <MenuItem key={o.id} id={`snooze:${o.id}`} icon={<IconZzz size={15} stroke={1.5} />}>
                  {`Snooze ${o.label.toLowerCase()}`}
                </MenuItem>
              ))
            )}
            <MenuItem id="settle" icon={<IconInbox size={15} stroke={1.5} />}>
              {t.settledAt ? "Back to Inbox" : "Settle"}
            </MenuItem>
            <MenuItem id="rename" icon={<IconPencil size={15} stroke={1.5} />}>
              Rename
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" variant="danger" icon={<IconTrash size={15} stroke={1.5} />}>
              Delete
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <Confirm
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={`Delete "${t.title}"?`}
        description="The thread is removed from Opal and its agent stops. Files and worktrees stay on the machine."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          await apiFetch(`/api/code/threads/${t.id}`, { method: "DELETE" });
          setConfirm(false);
          if (active) router.push("/code");
        }}
      />
    </motion.li>
  );
}
