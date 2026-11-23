// Self-hosted agent sandboxes: one Docker container per agent, with its own workspace volume.
//
// Isolation: unprivileged user, all capabilities dropped, no-new-privileges, memory/CPU/PID
// limits, no Docker socket, no published ports, a dedicated bridge network. The in-container
// browser refuses private addresses. On a production Linux host, also add DOCKER-USER iptables
// rules that drop traffic from the sandbox network to RFC1918 ranges and 169.254.169.254.
import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db";
import { sandbox } from "../db/schema";
import { env } from "../env";

const g = globalThis as unknown as { __opalDocker?: Docker; __opalReaper?: NodeJS.Timeout };

export function docker(): Docker {
  if (!g.__opalDocker) g.__opalDocker = new Docker();
  return g.__opalDocker;
}

const IDLE_STOP_MS = 20 * 60_000;
const OUTPUT_LIMIT = 24_000;

function containerName(agentId: string) {
  return `opal-sbx-${agentId.toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
}

async function ensureNetwork() {
  const name = env().OPAL_SANDBOX_NETWORK;
  const nets = await docker().listNetworks({ filters: { name: [name] } });
  if (!nets.some((n) => n.Name === name)) {
    await docker().createNetwork({ Name: name, Driver: "bridge", Labels: { "opal.sandbox": "1" } });
  }
}

export class SandboxUnavailableError extends Error {}

let lastPing: { at: number; ok: boolean } | null = null;

export async function dockerAvailable(): Promise<boolean> {
  if (lastPing && Date.now() - lastPing.at < 30_000) return lastPing.ok;
  let ok = false;
  try {
    await Promise.race([docker().ping(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500))]);
    ok = true;
  } catch {
    ok = false;
  }
  lastPing = { at: Date.now(), ok };
  return ok;
}

let imageCache: { at: number; id: string | null } | null = null;

/** The current sandbox image's id (checked at most once a minute), or null if unknown. */
async function imageId(): Promise<string | null> {
  if (imageCache && Date.now() - imageCache.at < 60_000) return imageCache.id;
  const id = await docker()
    .getImage(env().OPAL_SANDBOX_IMAGE)
    .inspect()
    .then((i) => i.Id)
    .catch(() => null);
  imageCache = { at: Date.now(), id };
  return id;
}

/** Get (or lazily create and start) the sandbox container for an agent. */
export async function ensureSandbox(userId: string, agentId: string): Promise<Docker.Container> {
  if (!(await dockerAvailable())) throw new SandboxUnavailableError("Docker is not running on the Opal server");
  startReaper();
  const name = containerName(agentId);
  const d = docker();
  let container = d.getContainer(name);
  let info: Docker.ContainerInspectInfo | undefined;
  try {
    info = await container.inspect();
  } catch {
    info = undefined;
  }

  if (info && info.Config.Labels?.["opal.user"] !== userId) {
    // Never hand one user's container to another.
    throw new SandboxUnavailableError("Sandbox ownership mismatch");
  }
  const current = info ? await imageId() : null;
  if (info && current && current !== info.Image) {
    // The sandbox image was rebuilt (new tools). The workspace is a named volume, so replacing
    // the container keeps the agent's files.
    await container.remove({ force: true }).catch(() => undefined);
    info = undefined;
  }

  if (!info) {
    await ensureNetwork();
    container = await d.createContainer({
      name,
      Image: env().OPAL_SANDBOX_IMAGE,
      User: "pwuser",
      WorkingDir: "/workspace",
      Labels: { "opal.sandbox": "1", "opal.user": userId, "opal.agent": agentId },
      Env: ["HOME=/home/pwuser", "LANG=C.UTF-8"],
      HostConfig: {
        Memory: 1536 * 1024 * 1024,
        MemorySwap: 1536 * 1024 * 1024,
        NanoCpus: 1_500_000_000,
        PidsLimit: 512,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        ShmSize: 512 * 1024 * 1024,
        NetworkMode: env().OPAL_SANDBOX_NETWORK,
        Mounts: [{ Type: "volume", Source: `opal-ws-${name.slice(9)}`, Target: "/workspace" }],
        Tmpfs: { "/tmp": "rw,noexec,nosuid,size=256m" },
        RestartPolicy: { Name: "no" },
      },
    });
    await container.start();
  } else if (!info.State.Running) {
    await container.start();
  }

  await db
    .insert(sandbox)
    .values({ id: nanoid(), userId, agentId, containerId: name, status: "running" })
    .onConflictDoUpdate({ target: sandbox.agentId, set: { status: "running", lastUsedAt: new Date(), containerId: name } });

  return container;
}

export type ExecResult = { stdout: string; stderr: string; exitCode: number; truncated: boolean };

export async function execIn(
  container: Docker.Container,
  cmd: string[],
  { timeoutSec = 60, stdin, maxOutput = OUTPUT_LIMIT }: { timeoutSec?: number; stdin?: string; maxOutput?: number } = {},
): Promise<ExecResult> {
  const exec = await container.exec({
    Cmd: ["timeout", "-k", "3", String(timeoutSec), ...cmd],
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: stdin !== undefined,
    Tty: false,
    WorkingDir: "/workspace",
    User: "pwuser",
  });
  const stream = await exec.start({ hijack: true, stdin: stdin !== undefined });
  const out = new PassThrough();
  const err = new PassThrough();
  let stdout = "";
  let stderr = "";
  let truncated = false;
  out.on("data", (c: Buffer) => {
    if (stdout.length < maxOutput) stdout += c.toString("utf8");
    else truncated = true;
  });
  err.on("data", (c: Buffer) => {
    if (stderr.length < maxOutput) stderr += c.toString("utf8");
    else truncated = true;
  });
  container.modem.demuxStream(stream, out, err);
  if (stdin !== undefined) {
    stream.write(stdin);
    stream.end();
  }
  await new Promise<void>((resolve) => {
    stream.on("end", resolve);
    stream.on("close", resolve);
    setTimeout(resolve, (timeoutSec + 6) * 1000);
  });
  const { ExitCode } = await exec.inspect();
  return {
    stdout: stdout.slice(0, maxOutput),
    stderr: stderr.slice(0, maxOutput),
    exitCode: ExitCode ?? -1,
    truncated,
  };
}

export async function touchSandbox(agentId: string, patch: { lastScreenshot?: string; lastUrl?: string } = {}) {
  await db
    .update(sandbox)
    .set({ lastUsedAt: new Date(), ...patch })
    .where(eq(sandbox.agentId, agentId));
}

export async function removeSandbox(agentId: string) {
  const name = containerName(agentId);
  try {
    await docker().getContainer(name).remove({ force: true });
  } catch {}
  try {
    await docker().getVolume(`opal-ws-${name.slice(9)}`).remove();
  } catch {}
  await db.delete(sandbox).where(eq(sandbox.agentId, agentId));
}

/** Stops sandboxes nobody has used for a while. Runs once per server process. */
function startReaper() {
  if (g.__opalReaper) return;
  g.__opalReaper = setInterval(async () => {
    try {
      const list = await docker().listContainers({ filters: { label: ["opal.sandbox=1"], status: ["running"] } });
      const rows = await db.select({ agentId: sandbox.agentId, lastUsedAt: sandbox.lastUsedAt }).from(sandbox);
      const last = new Map(rows.map((r) => [r.agentId, r.lastUsedAt.getTime()]));
      for (const c of list) {
        const agentId = c.Labels["opal.agent"];
        const used = last.get(agentId) ?? 0;
        if (Date.now() - used > IDLE_STOP_MS) {
          await docker().getContainer(c.Id).stop({ t: 5 }).catch(() => {});
          await db.update(sandbox).set({ status: "stopped" }).where(eq(sandbox.agentId, agentId));
        }
      }
    } catch {
      // Docker down; try again next tick.
    }
  }, 5 * 60_000);
  g.__opalReaper.unref?.();
}
