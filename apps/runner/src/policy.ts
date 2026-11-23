// "Auto" mode: what may run without asking. Reads, edits inside the thread's folder, and
// commands that only inspect or build/test pass; anything that deletes, installs globally,
// touches the network or leaves the folder waits for the user.
import { isAbsolute, relative, resolve } from "node:path";

const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead", "TodoWrite", "Task", "WebSearch", "WebFetch", "BashOutput", "ListMcpResourcesTool", "ReadMcpResourceTool"]);
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

const SAFE_COMMANDS = [
  /^(ls|dir|pwd|cat|type|head|tail|wc|echo|which|where|file|stat|tree|find|rg|grep|sort|uniq|diff|cut|jq)\b/,
  /^git\s+(status|diff|log|show|branch|rev-parse|remote -v|ls-files|blame|stash list|fetch)\b/,
  /^(npm|pnpm|yarn|bun)\s+(test|run (test|lint|typecheck|build|check|format)|ls|outdated|why)\b/,
  /^(npx|pnpm exec|bunx)\s+(tsc|eslint|prettier|vitest|jest|biome|oxlint)\b/,
  /^(node|python3?|deno)\s+--version\b/,
  /^(cargo\s+(check|test|build|fmt|clippy)|go\s+(build|test|vet|fmt)|pytest|tsc|make\s+(test|check|build))\b/,
];

const RISKY = /(\brm\s|-rf\b|\bdel\s|\brmdir\b|\bsudo\b|\bchmod\b|\bchown\b|\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\bgit\s+(push|reset --hard|clean|checkout --|rebase|commit)|\bnpm\s+(i|install|publish)\s+-g|>\s*\/|\|\s*(sh|bash)\b|\bmkfs\b|\bdd\s)/i;

export function inside(cwd: string, p: string) {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  const rel = relative(cwd, abs);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export function safeCommand(cmd: string): boolean {
  const c = cmd.trim();
  if (!c || RISKY.test(c)) return false;
  // Every part of a pipeline or chain has to be safe on its own.
  return c.split(/\s*(?:&&|\|\||;|\|)\s*/).every((part) => SAFE_COMMANDS.some((re) => re.test(part.trim())));
}

/** Claude tool calls that "auto" lets through without asking. */
export function autoAllows(tool: string, input: Record<string, unknown>, cwd: string): boolean {
  if (READ_TOOLS.has(tool)) return true;
  if (tool.startsWith("mcp__opal-code__")) return true;
  if (EDIT_TOOLS.has(tool)) {
    const p = String(input.file_path ?? input.notebook_path ?? "");
    return Boolean(p) && inside(cwd, p);
  }
  if (tool === "Bash") return safeCommand(String(input.command ?? ""));
  return false;
}
