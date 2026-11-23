"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyGatePassword } from "./password-hash";
import { env, isProd } from "./env";
import { GATE_COOKIE, issueGateToken } from "./gate";
import { LIMITS, rateLimit } from "./rate-limit";

export type UnlockState = { error?: "wrong" | "limited" } | undefined;

function safeNext(next: unknown): string {
  // Only allow same-site relative paths (no protocol-relative or absolute URLs).
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

export async function unlockAction(_prev: UnlockState, form: FormData): Promise<UnlockState> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limit = rateLimit(`gate:${ip}`, LIMITS.gate.max, LIMITS.gate.windowMs);
  if (!limit.ok) return { error: "limited" };

  const password = String(form.get("password") ?? "").slice(0, 256);
  if (!password || !verifyGatePassword(password, env().OPAL_GATE_PASSWORD_HASH)) {
    return { error: "wrong" };
  }

  const { token, maxAge } = issueGateToken();
  (await cookies()).set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  redirect(safeNext(form.get("next")));
}
