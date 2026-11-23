"use client";

// Opal Code's command palette (⌘K / Ctrl K), modelled on T3 Code's: jump to any thread, start a
// thread in a project, and create a project without leaving the keyboard. "New project" turns
// the search box into the project name; pick the machine and press Enter. It opens and closes
// instantly: something summoned by a shortcut many times a day shouldn't make you wait.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { mutate } from "swr";
import { cn, toast } from "krts.ui";
import {
  IconArrowLeft,
  IconCornerDownLeft,
  IconEdit,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconMessageCircle,
  IconMoon,
  IconSearch,
  IconServer2,
  IconSettings,
  IconSun,
  IconWand,
} from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { STATE_KEY, relTime, useCodeState } from "@/lib/code-client";
import type { ProjectView } from "@/lib/code-types";
import { useTheme } from "../providers";
import { AgentGlyph } from "./agent-glyph";
import { ProjectChip } from "./project-chip";

type Mode = "root" | "project";
let state: { open: boolean; mode: Mode } = { open: false, mode: "root" };
const subs = new Set<() => void>();
const set = (next: Partial<typeof state>) => {
  state = { ...state, ...next };
  subs.forEach((f) => f());
};
export const openPalette = (mode: Mode = "root") => set({ open: true, mode });
const usePalette = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
    () => state,
  );

/** Long paths keep their end, which is the part that matters. */
export const tail = (p: string, max = 64) => (p.length > max ? `…${p.slice(-(max - 1))}` : p);
const looksLikePath = (s: string) => /^(~|\/|[a-zA-Z]:[\\/]|\\\\)/.test(s.trim());
const baseName = (p: string) => p.trim().replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

export function CommandPalette() {
  const { open, mode } = usePalette();
  const router = useRouter();
  const { data } = useCodeState();
  const { setTheme } = useTheme();
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (state.open) set({ open: false });
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  useEffect(() => setQ(""), [mode]);

  const go = (href: string) => {
    set({ open: false });
    router.push(href);
  };

  const projectName = (id: string | null) => data?.projects.find((p) => p.id === id)?.name;
  const machineName = (id: string) => data?.machines.find((m) => m.id === id)?.name ?? "";
  const threads = useMemo(() => (data?.threads ?? []).slice(0, 200), [data?.threads]);

  async function createProject(machineId: string, existingPath?: string) {
    const name = existingPath ? baseName(existingPath) : q.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const { project } = await apiFetch<{ project: ProjectView }>("/api/code/projects", {
        method: "POST",
        json: { machineId, name, git: true, ...(existingPath ? { existingPath: existingPath.trim() } : {}) },
      });
      await mutate(STATE_KEY);
      toast.success(`${project.name} is ready`);
      go(`/code?project=${project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const machines = data?.machines ?? [];
  const isPath = looksLikePath(q);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(o) => set({ open: o })}
      label="Command palette"
      shouldFilter={mode === "root"}
      loop
      overlayClassName="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-[14vh] z-50 w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[20px] border border-line bg-overlay shadow-[0_24px_64px_-12px_rgb(0_0_0/0.35)] outline-none"
    >
      <div className="relative flex h-[52px] items-center gap-2.5 border-b border-line-subtle px-4">
        {mode === "project" ? (
          <button type="button" aria-label="Back" onClick={() => set({ mode: "root" })} className="pressable -ml-1 grid size-7 place-items-center rounded-[8px] text-fg-muted hover:bg-surface hover:text-fg">
            <IconArrowLeft size={16} stroke={1.75} />
          </button>
        ) : (
          <IconSearch size={17} stroke={1.6} className="shrink-0 text-fg-subtle" />
        )}
        <Command.Input
          value={q}
          onValueChange={setQ}
          autoFocus
          placeholder={mode === "project" ? "Project name, or a folder path to add" : "Search threads and projects, or run a command"}
          onKeyDown={(e) => {
            if (mode === "project" && e.key === "Backspace" && !q) {
              e.preventDefault();
              set({ mode: "root" });
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-subtle"
        />
        {mode === "project" && (
          <span className="shrink-0 rounded-[6px] bg-surface px-1.5 py-0.5 text-[11.5px] font-medium text-fg-muted">New project</span>
        )}
      </div>

      <Command.List className="max-h-[min(440px,60vh)] overflow-y-auto overscroll-contain p-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle">
        <Command.Empty className="px-3 py-8 text-center text-[13.5px] text-fg-subtle">Nothing found</Command.Empty>

        {mode === "root" ? (
          <>
            <Command.Group heading="Actions">
              <Item icon={IconEdit} onSelect={() => go("/code")} keywords={["create", "start", "task"]}>
                New thread
              </Item>
              <Item icon={IconFolderPlus} onSelect={() => set({ mode: "project" })} keywords={["create", "add", "folder", "repo"]}>
                New project…
              </Item>
              <Item icon={IconServer2} onSelect={() => go("/code/settings/machines")} keywords={["connect", "pair", "computer", "runner"]}>
                Connect a machine
              </Item>
              <Item icon={IconFolder} onSelect={() => go("/code/settings/projects")} keywords={["manage"]}>
                All projects
              </Item>
              <Item icon={IconWand} onSelect={() => go("/code/settings/skills")} keywords={["skill", "command", "slash", "instructions"]}>
                Code skills
              </Item>
              <Item icon={IconSettings} onSelect={() => go("/code/settings")} keywords={["preferences", "default", "settle"]}>
                Code settings
              </Item>
              <Item
                icon={dark ? IconSun : IconMoon}
                onSelect={() => {
                  setTheme(dark ? "light" : "dark");
                  set({ open: false });
                }}
                keywords={["theme", "dark", "light", "appearance"]}
              >
                {dark ? "Light theme" : "Dark theme"}
              </Item>
              <Item icon={IconMessageCircle} onSelect={() => go("/")} keywords={["opal", "back", "chat"]}>
                Back to chat
              </Item>
            </Command.Group>

            {threads.length > 0 && (
              <Command.Group heading="Threads">
                {threads.map((t) => (
                  <Command.Item
                    key={t.id}
                    value={`thread ${t.id} ${t.title}`}
                    keywords={[projectName(t.projectId) ?? "", t.branch ?? "", t.agent]}
                    onSelect={() => go(`/code/t/${t.id}`)}
                    className={itemClass}
                  >
                    <AgentGlyph agent={t.agent} size={15} />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.projectId && <span className="truncate text-[12px] text-fg-subtle">{projectName(t.projectId)}</span>}
                    <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-fg-subtle">{relTime(t.lastActivityAt)}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {(data?.projects.length ?? 0) > 0 && (
              <Command.Group heading="Start a thread in">
                {data!.projects.map((p) => (
                  <Command.Item key={p.id} value={`project ${p.id} ${p.name}`} keywords={[machineName(p.machineId), p.path]} onSelect={() => go(`/code?project=${p.id}`)} className={itemClass}>
                    <ProjectChip name={p.name} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="truncate text-[12px] text-fg-subtle">{machineName(p.machineId)}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </>
        ) : (
          <Command.Group heading={machines.length ? (isPath ? "Add this folder on" : "Create on") : undefined}>
            {!machines.length && (
              <Item icon={IconServer2} onSelect={() => go("/code/settings/machines")}>
                Connect a machine first
              </Item>
            )}
            {machines.map((m) => {
              const sep = m.os === "win32" ? "\\" : "/";
              const name = isPath ? baseName(q) : q.trim();
              return (
                <Command.Item
                  key={m.id}
                  value={`machine ${m.id}`}
                  disabled={!m.online || !name || busy}
                  onSelect={() => void createProject(m.id, isPath ? q : undefined)}
                  className={cn(itemClass, "h-auto py-2")}
                >
                  {isPath ? <IconFolderOpen size={16} stroke={1.5} className="shrink-0 text-fg-muted" /> : <IconServer2 size={16} stroke={1.5} className="shrink-0 text-fg-muted" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {m.name}
                      {!m.online && <span className="text-[12px] text-fg-subtle">offline</span>}
                    </span>
                    <span className="block truncate font-mono text-[11.5px] text-fg-subtle">{tail(isPath ? q.trim() : `${m.projectsRoot}${sep}${name || "name"}`)}</span>
                  </span>
                  <IconCornerDownLeft size={14} stroke={1.5} className="shrink-0 text-fg-subtle opacity-0 group-data-[selected=true]:opacity-100" />
                </Command.Item>
              );
            })}
          </Command.Group>
        )}
      </Command.List>

      <div className="flex h-9 items-center gap-3 border-t border-line-subtle px-4 text-[11.5px] text-fg-subtle">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> to {mode === "project" ? "create" : "open"}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd>esc</Kbd> to close
        </span>
      </div>
    </Command.Dialog>
  );
}

const itemClass =
  "group flex h-10 cursor-default select-none items-center gap-3 rounded-[12px] px-2.5 text-[14px] text-fg/85 outline-none data-[disabled=true]:opacity-45 data-[selected=true]:bg-surface-hover data-[selected=true]:text-fg";

function Item({
  icon: Icon,
  children,
  onSelect,
  keywords,
  hint,
}: {
  icon: typeof IconEdit;
  children: React.ReactNode;
  onSelect: () => void;
  keywords?: string[];
  hint?: string;
}) {
  return (
    <Command.Item onSelect={onSelect} keywords={keywords} className={itemClass}>
      <Icon size={16} stroke={1.5} className="shrink-0 text-fg-muted group-data-[selected=true]:text-fg" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[12px] text-fg-subtle">{hint}</span>}
    </Command.Item>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-[5px] border border-line bg-surface px-1 font-sans text-[10.5px] text-fg-muted">{children}</kbd>;
}
