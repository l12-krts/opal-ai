// Site lock ("gate"): until launch, every page and API call needs a signed unlock token.
// The token is an HMAC-signed expiry, so verifying it needs no database round trip.
import { createHmac, timingSafeEqual } from "node:crypto";

export const GATE_COOKIE = "opal_gate";
export const GATE_HEADER = "x-opal-gate";
const TTL_SECONDS = 60 * 60 * 24 * 14;

function secret(): string {
  const s = process.env.OPAL_GATE_SECRET;
  if (!s || s.length < 32) throw new Error("OPAL_GATE_SECRET is not set");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueGateToken(now = Date.now()): { token: string; maxAge: number } {
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ v: 1, exp })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, maxAge: TTL_SECONDS };
}

export function verifyGateToken(token: string | null | undefined, now = Date.now()): boolean {
  if (!token || token.length > 512) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { v, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return v === 1 && typeof exp === "number" && exp * 1000 > now;
  } catch {
    return false;
  }
}
