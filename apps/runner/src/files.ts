// File search for @mentions: the project's files (git's view when it's a repository, otherwise a
// bounded walk that skips the usual heavy folders), ranked by how well the name matches.
import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".venv", "venv", "__pycache__", "target", ".turbo", ".cache", "coverage"]);
const MAX = 20_000;
const cache = new Map<string, { at: number; files: string[] }>();

function gitFiles(cwd: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 15_000 }, (err, out) => {
      if (err) return resolve(null);
      resolve(out.toString().split("\n").filter(Boolean).slice(0, MAX));
    });
  });
}

function walk(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < MAX) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(p);
      } else out.push(relative(root, p).replaceAll("\\", "/"));
    }
  }
  return out;
}

async function files(cwd: string) {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < 20_000) return hit.files;
  const list = (await gitFiles(cwd)) ?? walk(cwd);
  cache.set(cwd, { at: Date.now(), files: list });
  return list;
}

function score(path: string, q: string) {
  const p = path.toLowerCase();
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (!q) return 1 / (1 + p.split("/").length);
  if (base === q) return 100;
  if (base.startsWith(q)) return 60 - base.length / 100;
  if (base.includes(q)) return 40 - base.length / 100;
  if (p.includes(q)) return 20 - p.length / 1000;
  // Letters in order (fuzzy): "rlim" → rate-limit.ts
  let i = 0;
  for (const ch of p) if (ch === q[i]) i++;
  return i === q.length ? 5 - p.length / 1000 : -1;
}

export async function search(a: { cwd: string; q?: string; limit?: number }) {
  const q = (a.q ?? "").toLowerCase().trim();
  const list = await files(a.cwd);
  const ranked = list
    .map((path) => ({ path, s: score(path, q) }))
    .filter((x) => x.s >= 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, Math.min(a.limit ?? 30, 100));
  return { files: ranked.map((x) => x.path), total: list.length };
}
