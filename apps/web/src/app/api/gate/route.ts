// For native clients (iOS, desktop) that can't use the cookie form:
// POST { password } → { token } to send as `x-opal-gate` on every request.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyGatePassword } from "@/server/password-hash";
import { env } from "@/server/env";
import { issueGateToken } from "@/server/gate";
import { clientIp, errorResponse, readJson, ApiError } from "@/server/http";
import { LIMITS, rateLimit } from "@/server/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const r = rateLimit(`gate:${clientIp(req)}`, LIMITS.gate.max, LIMITS.gate.windowMs);
    if (!r.ok) throw new ApiError(429, "rate_limited", "Too many attempts", { retryAfter: r.retryAfter });
    const { password } = await readJson(req, z.object({ password: z.string().min(1).max(256) }), 2048);
    if (!verifyGatePassword(password, env().OPAL_GATE_PASSWORD_HASH)) {
      throw new ApiError(401, "wrong_password", "Wrong password");
    }
    const { token, maxAge } = issueGateToken();
    return NextResponse.json({ token, expiresIn: maxAge });
  } catch (err) {
    return errorResponse(err);
  }
}
