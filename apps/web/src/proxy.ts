// Next.js 16 proxy (formerly middleware). First line of defence:
//  1. Site lock: nothing but /unlock works without a valid gate token.
//  2. Signed-out users are sent to /login (pages only; APIs check the session themselves).
import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, GATE_HEADER, verifyGateToken } from "@/server/gate";

// Runner endpoints authenticate with their own machine token (server/code/runner-auth.ts).
const GATE_FREE = ["/unlock", "/api/gate", "/api/code/runner"];
const AUTH_FREE = ["/login", "/api/auth", "/desktop/callback"];

function startsWithAny(path: string, prefixes: string[]) {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (startsWithAny(pathname, GATE_FREE)) return NextResponse.next();

  const gate = req.cookies.get(GATE_COOKIE)?.value ?? req.headers.get(GATE_HEADER);
  if (!verifyGateToken(gate)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "locked", message: "Opal is locked" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/unlock";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/api/") || startsWithAny(pathname, AUTH_FREE)) return NextResponse.next();

  // Cheap presence check; pages and APIs verify the session for real.
  const hasSession =
    req.cookies.has("opal.session_token") || req.cookies.has("__Secure-opal.session_token");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|fonts/|robots.txt).*)"],
};
