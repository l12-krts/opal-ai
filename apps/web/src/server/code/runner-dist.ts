import "server-only";
// The runner AppImages Opal hands out (built by `npm run appimage` in apps/runner), and the
// pairing-code check that guards downloading them.
import { existsSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { and, eq, gt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "../db";
import { codePairing } from "../db/schema";
import { ApiError, clientIp } from "../http";
import { rateLimit } from "../rate-limit";

export const ARCHES = ["aarch64", "x86_64"] as const;
export type Arch = (typeof ARCHES)[number];

/** Folder with opal-runner-<arch>.AppImage. OPAL_RUNNER_DIST overrides the repo's apps/runner/dist. */
export function distDir() {
  return process.env.OPAL_RUNNER_DIST || resolve(process.cwd(), "..", "runner", "dist");
}

export function appImage(arch: Arch): { path: string; size: number } | null {
  const path = join(distDir(), `opal-runner-${arch}.AppImage`);
  if (!existsSync(path)) return null;
  return { path, size: statSync(path).size };
}

/** Throws unless `code` is a live pairing code. Doesn't use it up: pairing does that. */
export async function checkPairingCode(req: NextRequest, raw: string | null) {
  const r = rateLimit(`runner-dl:${clientIp(req)}`, 30, 15 * 60_000);
  if (!r.ok) throw new ApiError(429, "rate_limited", "Too many attempts. Wait a few minutes.");
  const code = (raw ?? "").trim().toUpperCase().replace("-", "");
  if (!/^[A-Z0-9]{8}$/.test(code)) throw new ApiError(400, "bad_code", "Missing or malformed pairing code.");
  const [p] = await db
    .select({ code: codePairing.code })
    .from(codePairing)
    .where(and(eq(codePairing.code, code), gt(codePairing.expiresAt, new Date())))
    .limit(1);
  if (!p) throw new ApiError(400, "bad_code", "That code is wrong or expired. Make a new one in Opal → Code → Machines.");
}

/** The address this request reached Opal at, as the client sees it (works behind a proxy too). */
export function publicOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/**
 * Addresses another machine can reach Opal at, for the pairing instructions. When you're using
 * Opal at its public address, that's the one. At localhost, it's this computer's network
 * addresses (Tailscale first), since "localhost" on the other machine means that machine.
 */
export function reachableOrigins(req: NextRequest): { origin: string; label: string }[] {
  const origin = publicOrigin(req);
  const url = new URL(origin);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return [{ origin, label: "This address" }];
  const out: { origin: string; label: string }[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      // vEthernet (WSL, Hyper-V) and Docker bridges aren't reachable from other machines.
      if (/vethernet|docker|br-|virbr|wsl/i.test(name)) continue;
      const tailscale = a.address.startsWith("100.") && /tailscale/i.test(name);
      out.push({ origin: `${url.protocol}//${a.address}${url.port ? `:${url.port}` : ""}`, label: tailscale ? "Tailscale" : "Local network" });
    }
  }
  out.sort((a, b) => Number(b.label === "Tailscale") - Number(a.label === "Tailscale"));
  return out.length ? out : [{ origin, label: "This address" }];
}
