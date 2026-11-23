"use client";

// Diff rendering: colored unified-diff lines, and a full panel with per-file sections and the
// thread's git actions (commit, push, pull request).
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Button, Skeleton, TextField, cn, toast } from "krts.ui";
import { IconChevronRight, IconExternalLink, IconGitBranch, IconRefresh } from "@tabler/icons-react";
import { apiFetch, fetcher } from "@/lib/api";
import type { ThreadView } from "@/lib/code-types";
import { IconButton } from "../ui";
import { Collapse } from "../chat/parts/collapsible";

export function DiffLines({ text, className }: { text: string; className?: string }) {
  return (
    <pre className={cn("overflow-auto bg-code py-1 font-mono text-[11.5px] leading-[1.15rem]", className)}>
      {text.split("\n").map((l, i) => {
        const tone =
          l.startsWith("+") && !l.startsWith("+++")
            ? "bg-success/10 text-fg"
            : l.startsWith("-") && !l.startsWith("---")
              ? "bg-danger/10 text-fg"
              : l.startsWith("@@")
                ? "text-accent-line"
                : "text-fg/70";
        return (
          <div key={i} className={cn("whitespace-pre px-2.5", tone)}>
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}

type FileDiff = { path: string; text: string; add: number; del: number; isNew: boolean; isDeleted: boolean };

export function parseDiff(diff: string): FileDiff[] {
  const out: FileDiff[] = [];
  for (const chunk of diff.split(/^diff --git /m).slice(1)) {
    const header = chunk.split("\n", 1)[0];
    const m = header.match(/ b\/(.+)$/);
    const body = chunk.slice(chunk.indexOf("@@") >= 0 ? chunk.indexOf("@@") : chunk.length);
    let add = 0;
    let del = 0;
    for (const l of body.split("\n")) {
      if (l.startsWith("+") && !l.startsWith("+++")) add++;
      else if (l.startsWith("-") && !l.startsWith("---")) del++;
    }
    out.push({ path: m?.[1] ?? header, text: body.trimEnd(), add, del, isNew: /^new file/m.test(chunk), isDeleted: /^deleted file/m.test(chunk) });
  }
  return out;
}

type GitResponse = {
  status: { branch: string | null; base: string | null; ahead: number; dirty: boolean; hasRemote: boolean; files: { path: string }[] };
  diff: string;
  truncated: boolean;
  prUrl: string | null;
};

export function DiffPanel({ thread }: { thread: ThreadView }) {
  const { data, error, isLoading, mutate } = useSWR<GitResponse>(`/api/code/threads/${thread.id}/git`, fetcher, { revalidateOnFocus: true });
  const files = useMemo(() => parseDiff(data?.diff ?? ""), [data?.diff]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  // Refresh when the agent finishes a turn.
  useEffect(() => {
    if (thread.status !== "working") void mutate();
  }, [thread.status, mutate]);

  async function run(action: "commit" | "push" | "pr" | "commit_push" | "commit_push_pr") {
    setBusy(action);
    try {
      const r = await apiFetch<{ sha?: string; prUrl?: string; message?: string }>(`/api/code/threads/${thread.id}/git`, { method: "POST", json: { action, message: message.trim() || undefined } });
      if (r.prUrl) toast.success("Pull request ready", { action: { label: "Open", onClick: () => window.open(r.prUrl, "_blank", "noopener") } } as never);
      else if (r.sha) toast.success(`Committed ${r.sha}`);
      else toast.success("Pushed");
      setMessage("");
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const s = data?.status;
  const prUrl = data?.prUrl ?? thread.prUrl;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle pl-4 pr-11">
        <span className="text-[13.5px] font-medium">Changes</span>
        {s?.branch && (
          <span className="flex min-w-0 items-center gap-1 text-[12px] text-fg-muted">
            <IconGitBranch size={13} stroke={1.5} />
            <span className="truncate">{s.branch}</span>
          </span>
        )}
        <div className="ml-auto">
          <IconButton label="Refresh" onPress={() => void mutate()}>
            <IconRefresh size={15} stroke={1.5} />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <Skeleton className="m-3 h-24 rounded-[10px]" />}
        {error && <p className="p-3 text-[13px] text-danger">{(error as Error).message}</p>}
        {data && !files.length && <p className="p-6 text-center text-[13px] text-fg-subtle">{s?.branch === null && !s?.files.length ? "Not a Git repository" : "No changes"}</p>}
        {files.map((f) => (
          <FileSection key={f.path} f={f} defaultOpen={files.length <= 6} />
        ))}
        {data?.truncated && <p className="p-3 text-[12px] text-fg-subtle">The diff is too large to show in full.</p>}
      </div>

      {s && s.branch !== null && (
        <div className="shrink-0 border-t border-line-subtle p-3">
          {s.dirty && (
            <TextField size="sm" aria-label="Commit message" placeholder="Commit message (Opal writes one if empty)" value={message} onChange={setMessage} className="mb-2" />
          )}
          <div className="flex flex-wrap gap-1.5">
            {s.dirty && (
              <Button size="xs" variant="secondary" isPending={busy === "commit"} onPress={() => run("commit")}>
                Commit
              </Button>
            )}
            {s.hasRemote && (s.ahead > 0 || s.dirty) && (
              <Button size="xs" variant="secondary" isPending={busy === "push" || busy === "commit_push"} onPress={() => run(s.dirty ? "commit_push" : "push")}>
                {s.dirty ? "Commit & push" : "Push"}
              </Button>
            )}
            {s.hasRemote &&
              (prUrl ? (
                <a href={prUrl} target="_blank" rel="noopener noreferrer" className="pressable inline-flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-[12.5px] text-accent-line hover:bg-surface">
                  Pull request <IconExternalLink size={13} stroke={1.5} />
                </a>
              ) : (
                <Button size="xs" className="btn-accent" isPending={busy === "pr" || busy === "commit_push_pr"} onPress={() => run(s.dirty ? "commit_push_pr" : "pr")}>
                  Create PR
                </Button>
              ))}
            {!s.hasRemote && <span className="self-center text-[12px] text-fg-subtle">No remote, so push and PRs are off.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function FileSection({ f, defaultOpen }: { f: FileDiff; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line-subtle">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface/60">
        <IconChevronRight size={13} stroke={1.5} className={cn("shrink-0 text-fg-muted transition-transform duration-200", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{f.path}</span>
        {f.isNew && <span className="text-[11px] text-success">new</span>}
        {f.isDeleted && <span className="text-[11px] text-danger">deleted</span>}
        <span className="flex shrink-0 gap-1.5 font-mono text-[11.5px]">
          {f.add > 0 && <span className="text-success">+{f.add}</span>}
          {f.del > 0 && <span className="text-danger">−{f.del}</span>}
        </span>
      </button>
      <Collapse open={open}>
        <DiffLines text={f.text} className="max-h-[60vh]" />
      </Collapse>
    </div>
  );
}
