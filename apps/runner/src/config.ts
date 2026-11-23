import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = process.env.OPAL_RUNNER_HOME || join(homedir(), ".opal-runner");
export const CONFIG_PATH = join(HOME, "config.json");
export const WORKTREES = join(HOME, "worktrees");
export const SCRATCH = join(HOME, "scratch");
export const VERSION = "0.1.0";

export type Config = { serverUrl: string; machineId: string; token: string; name: string; projectsRoot: string };

export function loadConfig(): Config | null {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
  } catch {
    return null;
  }
}

export function saveConfig(c: Config) {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2), { mode: 0o600 });
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {}
}
