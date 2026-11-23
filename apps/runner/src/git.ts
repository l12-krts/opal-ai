// Git for threads: worktrees, status, diff (including new files), commit, push, pull requests (gh).
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { WORKTREES } from "./config.js";

function git(cwd: string, args: string[], timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim()));
      else resolve(stdout.toString());
    });
  });
}

function gh(cwd: string, args: string[], timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { cwd, timeout, windowsHide: true, shell: process.platform === "win32" }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim() || "gh failed. Install the GitHub CLI and run `gh auth login`."));
      else resolve(stdout.toString().trim());
    });
  });
}

export async function isRepo(cwd: string) {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).then((o) => o.trim() === "true", () => false);
}

/** True when `cwd` is the top of its own repository (not just a folder inside a bigger one). */
export async function isRepoRoot(cwd: string) {
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]).then((o) => o.trim(), () => "");
  if (!top) return false;
  const norm = (p: string) => realpathSync.native(p).replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  try {
    return norm(top) === norm(cwd);
  } catch {
    return false;
  }
}

async function currentBranch(cwd: string): Promise<string | null> {
  // symbolic-ref also works in a repository with no commits yet.
  return git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]).then((o) => o.trim() || null, () => null);
}

async function defaultBase(cwd: string): Promise<string> {
  const head = await git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "");
  if (head.trim()) return head.trim().replace(/^origin\//, "");
  return (await currentBranch(cwd)) ?? "main";
}

export async function worktree(a: { repo: string; project: string; branch: string; base?: string | null }) {
  const base = a.base || (await currentBranch(a.repo)) || (await defaultBase(a.repo));
  const dir = join(WORKTREES, a.project.replace(/[^\w.-]/g, "_"));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, a.branch.replace(/[^\w.-]/g, "-"));
  if (existsSync(path)) return { path, branch: a.branch, base };
  // A repo with no commits can't have worktrees; make an empty first commit.
  const hasHead = await git(a.repo, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
  if (!hasHead) await git(a.repo, ["commit", "--allow-empty", "-m", "Initial commit"]);
  await git(a.repo, ["worktree", "add", "-b", a.branch, path, base], 120_000);
  return { path, branch: a.branch, base };
}

export async function status(a: { cwd: string; base?: string | null }) {
  if (!(await isRepo(a.cwd))) return { branch: null, base: null, ahead: 0, behind: 0, dirty: false, hasRemote: false, files: [] };
  const branch = await currentBranch(a.cwd);
  const remotes = (await git(a.cwd, ["remote"]).catch(() => "")).trim();
  const porcelain = await git(a.cwd, ["status", "--porcelain=v1", "--untracked-files=all", "--", "."], 30_000);
  const numstat = await git(a.cwd, ["diff", "HEAD", "--numstat"]).catch(() => "");
  const counts = new Map<string, [number, number]>();
  for (const l of numstat.split("\n")) {
    const [add, del, p] = l.split("\t");
    if (p) counts.set(p, [Number(add) || 0, Number(del) || 0]);
  }
  const files = porcelain
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const path = l.slice(3).replace(/^"|"$/g, "");
      const [additions, deletions] = counts.get(path) ?? [0, 0];
      return { path, status: l.slice(0, 2).trim() || "M", additions, deletions };
    });
  let ahead = 0;
  let behind = 0;
  if (a.base && branch) {
    const lr = await git(a.cwd, ["rev-list", "--left-right", "--count", `${a.base}...HEAD`]).catch(() => "");
    const [b, f] = lr.trim().split(/\s+/).map(Number);
    behind = b || 0;
    ahead = f || 0;
  }
  return { branch, base: a.base ?? null, ahead, behind, dirty: files.length > 0, hasRemote: Boolean(remotes), files };
}

/** Uncommitted changes, plus commits since `base` when given. New files are included. */
export async function diff(a: { cwd: string; base?: string | null }) {
  if (!(await isRepo(a.cwd))) return { diff: "", truncated: false };
  const untracked = (await git(a.cwd, ["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean);
  if (untracked.length) await git(a.cwd, ["add", "--intent-to-add", "--", ...untracked]).catch(() => {});
  const hasHead = await git(a.cwd, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
  const from = a.base ? (await git(a.cwd, ["merge-base", a.base, "HEAD"]).catch(() => "")).trim() || "HEAD" : "HEAD";
  // Before the first commit, compare the working tree with the index (new files are intent-to-add).
  let out = hasHead ? await git(a.cwd, ["diff", from, "--no-color", "--no-ext-diff"]) : await git(a.cwd, ["diff", "--no-color", "--no-ext-diff"]).catch(() => "");
  const MAX = 2_000_000;
  const truncated = out.length > MAX;
  if (truncated) out = out.slice(0, MAX);
  return { diff: out, truncated };
}

export async function commit(a: { cwd: string; message: string }) {
  await git(a.cwd, ["add", "-A"]);
  await git(a.cwd, ["commit", "-m", a.message]);
  return { sha: (await git(a.cwd, ["rev-parse", "--short", "HEAD"])).trim() };
}

export async function push(a: { cwd: string }) {
  const branch = await currentBranch(a.cwd);
  if (!branch) throw new Error("Not on a branch");
  await git(a.cwd, ["push", "-u", "origin", branch], 120_000);
  return { ok: true };
}

export async function pr(a: { cwd: string; title: string; body: string; base?: string | null }) {
  const existing = await gh(a.cwd, ["pr", "view", "--json", "url", "-q", ".url"]).catch(() => "");
  if (existing.startsWith("http")) return { url: existing };
  const args = ["pr", "create", "--title", a.title, "--body", a.body];
  if (a.base) args.push("--base", a.base);
  const out = await gh(a.cwd, args);
  const url = out.split("\n").find((l) => l.startsWith("http")) ?? out;
  return { url };
}

export async function prState(a: { cwd: string; url?: string | null }) {
  const state = await gh(a.cwd, ["pr", "view", ...(a.url ? [a.url] : []), "--json", "state", "-q", ".state"]);
  return { state: state.trim() };
}

export async function branches(a: { cwd: string }) {
  const out = await git(a.cwd, ["branch", "--format=%(refname:short)"]).catch(() => "");
  return { branches: out.split("\n").filter(Boolean), current: await currentBranch(a.cwd) };
}

export async function init(cwd: string) {
  await git(cwd, ["init", "-b", "main"]).catch(() => git(cwd, ["init"]));
}
