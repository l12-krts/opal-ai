"use client";

// New thread: describe the task, pick the agent(s) and approval mode in the composer, and where
// it runs (project, local folder or a new worktree) in the toolbar under it.
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Skeleton, cn, toast } from "krts.ui";
import { IconGitBranch, IconServer2 } from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { useCodeSettings, useCodeState } from "@/lib/code-client";
import { CODE_AGENTS, type CodeMode, type Mention } from "@/lib/code-types";
import { AgentPicker, Composer, ModePicker, ProjectPicker, pill, type AgentPick } from "@/components/code/composer";
import { openPalette } from "@/components/code/command-palette";
import { needsSignIn, openSignIn } from "@/lib/code-signin";

const PREFS = "opal.code.new";
type Prefs = { where?: string; agents?: AgentPick[]; mode?: CodeMode; worktree?: boolean };

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS) ?? "{}");
  } catch {
    return {};
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...loadPrefs(), ...p }));
  } catch {}
}

export default function NewThreadPage() {
  return (
    <Suspense fallback={null}>
      <NewThread />
    </Suspense>
  );
}

function NewThread() {
  const router = useRouter();
  const params = useSearchParams();
  const { data } = useCodeState();
  const [text, setText] = useState("");
  const [where, setWhere] = useState<string>("");
  const [agents, setAgents] = useState<AgentPick[]>([{ agent: "claude", model: "default" }]);
  const [mode, setMode] = useState<CodeMode>("auto");
  const [worktree, setWorktree] = useState(false);
  const [pending, setPending] = useState(false);

  // Code settings give the defaults; what you last picked here wins over them.
  const { data: codeSettings } = useCodeSettings();
  useEffect(() => {
    const p = loadPrefs();
    const d = codeSettings?.settings;
    if (p.agents?.length) setAgents(p.agents);
    else if (d) setAgents([{ agent: d.defaultAgent, model: "default" }]);
    if (p.mode) setMode(p.mode);
    else if (d) setMode(d.defaultMode);
    if (p.worktree !== undefined) setWorktree(p.worktree);
    else if (d) setWorktree(d.worktreeByDefault);
    if (p.where) setWhere(p.where);
  }, [codeSettings]);

  // ?project=<id> (from the command palette) picks the project.
  const wanted = params.get("project");
  useEffect(() => {
    if (wanted) {
      setWhere(`p:${wanted}`);
      savePrefs({ where: `p:${wanted}` });
    }
  }, [wanted]);

  const options = useMemo(() => (data ? [...data.projects.map((p) => `p:${p.id}`), ...data.machines.map((m) => `m:${m.id}`)] : []), [data]);
  const selected = options.includes(where) ? where : (options[0] ?? "");
  const project = selected.startsWith("p:") ? data?.projects.find((p) => p.id === selected.slice(2)) : undefined;
  const machine = data?.machines.find((m) => m.id === (project ? project.machineId : selected.slice(2)));
  const agentOk = (id: string) => machine?.agents.find((a) => a.id === id)?.ok ?? false;
  const multi = agents.length > 1;
  const blocked = agents.filter((a) => !agentOk(a.agent));
  const canSend = Boolean(text.trim() && machine?.online && !blocked.length);

  async function submit(mentions: Mention[] = []) {
    if (!canSend || pending) return;
    setPending(true);
    try {
      const { threads } = await apiFetch<{ threads: string[] }>("/api/code/threads", {
        method: "POST",
        json: {
          projectId: project?.id ?? null,
          machineId: machine?.id ?? null,
          agents: agents.map((a) => ({ agent: a.agent, model: a.model === "default" ? null : a.model })),
          mode,
          worktree: Boolean(project?.isGit && worktree),
          text: text.trim(),
          mentions,
        },
      });
      if (threads.length > 1) toast.success(`Started ${threads.length} threads`);
      setText("");
      router.push(`/code/t/${threads[0]}`);
    } catch (e) {
      toast.error((e as Error).message);
      setPending(false);
    }
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-[740px] px-5 pt-[24vh]">
        <Skeleton className="mx-auto mb-6 h-7 w-64 rounded-[8px]" />
        <Skeleton className="h-[120px] rounded-[22px]" />
      </div>
    );
  }

  if (!data.machines.length) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-[360px] flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-[14px] border border-line-subtle bg-overlay text-fg-muted shadow-sm">
            <IconServer2 size={22} stroke={1.5} />
          </span>
          <h1 className="mt-1 text-[19px] font-medium tracking-[-0.01em]">Connect a machine</h1>
          <p className="text-[13.5px] leading-5 text-fg-muted">Opal Code runs Claude Code and Codex on your own computers. Connect one to start.</p>
          <Link href="/code/settings/machines" className="btn-accent pressable mt-2 inline-flex h-9 items-center rounded-[12px] px-4 text-[13.5px] font-medium">
            Connect a machine
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[740px] flex-1 flex-col justify-center px-4 pb-[14vh] pt-16">
        <h1 className="mb-6 text-center text-[24px] font-medium tracking-[-0.015em]">
          What should we build{project ? <span className="text-fg-subtle"> in {project.name}</span> : ""}?
        </h1>

        <Composer
          autoFocus
          value={text}
          onChange={setText}
          onSubmit={submit}
          projectId={project?.id ?? null}
          canSend={canSend}
          pending={pending}
          minHeight={84}
          placeholder={multi ? "Describe the task. Each agent gets its own thread and worktree." : "Describe the task"}
          controls={
            <>
              <AgentPicker
                value={agents}
                isOk={agentOk}
                onChange={(v) => {
                  setAgents(v);
                  savePrefs({ agents: v });
                }}
              />
              <ModePicker
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  savePrefs({ mode: m });
                }}
              />
            </>
          }
        />

        <div className="mt-2 flex flex-wrap items-center gap-0.5 px-1.5">
          <ProjectPicker
            value={selected}
            projects={data.projects}
            machines={data.machines}
            onChange={(v) => {
              setWhere(v);
              savePrefs({ where: v });
            }}
            onNewProject={() => openPalette("project")}
          />
          {project?.isGit && (
            <div className="ml-1 inline-flex h-8 items-center rounded-[16px] bg-surface p-0.5" role="radiogroup" aria-label="Where the agent works">
              {[
                { id: false, label: "Local" },
                { id: true, label: "New worktree" },
              ].map((o) => {
                const on = (multi ? true : worktree) === o.id;
                return (
                  <button
                    key={String(o.id)}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={multi}
                    onClick={() => {
                      setWorktree(o.id);
                      savePrefs({ worktree: o.id });
                    }}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-[14px] px-2.5 text-[12.5px] transition-colors",
                      on ? "bg-overlay text-fg shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {o.id && <IconGitBranch size={13} stroke={1.6} />}
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
          <span className="ml-auto flex items-center gap-1.5 pr-1 text-[12px] text-fg-subtle">
            {machine && <span className={cn("size-1.5 rounded-full", machine.online ? "bg-success" : "bg-fg-subtle")} />}
            {machine && (machine.online ? machine.name : `${machine.name} is offline`)}
          </span>
        </div>

        {machine?.online &&
          blocked.map((a) => {
            const info = machine.agents.find((x) => x.id === a.agent);
            return (
              <div key={a.agent} className="mt-3 flex items-center gap-3 px-3 text-[12.5px] leading-5 text-warning">
                <p className="min-w-0 flex-1">
                  {CODE_AGENTS.find((x) => x.id === a.agent)?.label} on {machine.name}: {info?.note ?? "not set up"}
                </p>
                {needsSignIn(info) && (
                  <Button size="sm" variant="secondary" onPress={() => openSignIn({ machineId: machine.id, agent: a.agent as "claude" | "codex" })}>
                    Sign in
                  </Button>
                )}
              </div>
            );
          })}
        {!data.projects.length && (
          <div className="mt-6 flex justify-center">
            <Button variant="ghost" size="sm" className={pill} onPress={() => openPalette("project")}>
              Create your first project
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
