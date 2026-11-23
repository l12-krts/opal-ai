// Shared guard rails for every API route: gate check, session check, same-origin check for
// cookie-authenticated writes, rate limiting, body size limits, zod validation, and error
// responses that never leak internals.
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { auth } from "./auth";
import { env } from "./env";
import { GATE_COOKIE, GATE_HEADER, verifyGateToken } from "./gate";
import { rateLimit, type LIMITS } from "./rate-limit";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export type AuthedUser = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  role: string;
};

type Ctx<P> = { req: NextRequest; user: AuthedUser; params: P };

type Options = {
  limit?: (typeof LIMITS)[keyof typeof LIMITS];
  limitKey?: string;
  /** Skip the session check (still requires the gate). */
  public?: boolean;
};

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function clientIp(req: NextRequest): string {
  // Behind a reverse proxy, only trust the first hop it sets. Locally there is none.
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export function assertGate(req: NextRequest) {
  const token = req.cookies.get(GATE_COOKIE)?.value ?? req.headers.get(GATE_HEADER);
  if (!verifyGateToken(token)) throw new ApiError(401, "locked", "Opal is locked");
}

/**
 * Requests authenticated by cookie must come from our own origin (CSRF protection).
 * Bearer-token clients (iOS, desktop) don't send cookies, so CSRF doesn't apply to them.
 */
export function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  if (req.headers.get("authorization")?.startsWith("Bearer ")) return;
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  const allowed = new URL(env().BETTER_AUTH_URL).origin;
  if (origin) {
    if (origin !== allowed) throw new ApiError(403, "bad_origin", "Cross-origin request blocked");
    return;
  }
  if (site && site !== "same-origin" && site !== "none") {
    throw new ApiError(403, "bad_origin", "Cross-origin request blocked");
  }
  if (!site) throw new ApiError(403, "bad_origin", "Missing origin");
}

export async function getUser(req: NextRequest): Promise<AuthedUser | null> {
  const s = await auth.api.getSession({ headers: req.headers });
  if (!s?.user) return null;
  const u = s.user as typeof s.user & { role?: string | null; banned?: boolean | null };
  if (u.banned) return null;
  return { id: u.id, email: u.email, name: u.name, image: u.image, role: u.role ?? "user" };
}

export function api<P = Record<string, string>>(
  handler: (ctx: Ctx<P>) => Promise<Response | unknown>,
  opts: Options = {},
) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    try {
      assertGate(req);
      assertSameOrigin(req);
      const user = opts.public ? ({ id: "", email: "", name: "", role: "anon" } as AuthedUser) : await getUser(req);
      if (!user) throw new ApiError(401, "unauthorized", "Sign in required");
      if (opts.limit) {
        const key = `${opts.limitKey ?? req.nextUrl.pathname}:${user.id || clientIp(req)}`;
        const r = rateLimit(key, opts.limit.max, opts.limit.windowMs);
        if (!r.ok) throw new ApiError(429, "rate_limited", "Too many requests", { retryAfter: r.retryAfter });
      }
      const params = (await route?.params) ?? ({} as P);
      const out = await handler({ req, user, params });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (err.status === 429 && err.extra?.retryAfter) headers["Retry-After"] = String(err.extra.retryAfter);
    return NextResponse.json({ error: err.code, message: err.message, ...err.extra }, { status: err.status, headers });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: "invalid_input", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  console.error("[api]", err);
  return NextResponse.json({ error: "internal", message: "Something went wrong" }, { status: 500 });
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>, maxBytes = 256 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new ApiError(413, "too_large", "Request body too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, "too_large", "Request body too large");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Body must be JSON");
  }
  return schema.parse(data);
}

/** IDs we generate are 21-char nanoids. Reject anything else before it reaches a query. */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/, "Invalid id");
