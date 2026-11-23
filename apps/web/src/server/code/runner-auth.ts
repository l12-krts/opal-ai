// Runner endpoints skip the site gate (see proxy.ts) and authenticate with the machine token.
import "server-only";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "../db";
import { codeMachine, type CodeMachine } from "../db/schema";
import { ApiError, clientIp, errorResponse } from "../http";
import { rateLimit } from "../rate-limit";
import { hashToken } from "./store";

export async function runnerMachine(req: NextRequest): Promise<CodeMachine> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.length < 20) throw new ApiError(401, "unauthorized", "Missing runner token");
  const [m] = await db.select().from(codeMachine).where(eq(codeMachine.tokenHash, hashToken(token))).limit(1);
  if (!m) throw new ApiError(401, "unauthorized", "Unknown runner token. Pair this machine again.");
  return m;
}

/** Wraps a runner route: rate limit per machine/IP and uniform errors. */
export function runnerRoute(handler: (req: NextRequest, machine: CodeMachine) => Promise<Response | unknown>, max = 2400) {
  return async (req: NextRequest) => {
    try {
      const ip = clientIp(req);
      const r = rateLimit(`runner:${req.nextUrl.pathname}:${ip}`, max, 60_000);
      if (!r.ok) throw new ApiError(429, "rate_limited", "Too many requests");
      const machine = await runnerMachine(req);
      const out = await handler(req, machine);
      if (out instanceof Response) return out;
      return Response.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
