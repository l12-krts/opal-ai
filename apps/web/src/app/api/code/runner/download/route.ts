// GET ?code=XXXX-XXXX&arch=aarch64|x86_64: the runner AppImage. Needs a live pairing code, since
// these routes skip the site gate (the machine has no browser session).
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/server/http";
import { ARCHES, appImage, checkPairingCode, type Arch } from "@/server/code/runner-dist";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await checkPairingCode(req, req.nextUrl.searchParams.get("code"));
    const arch = req.nextUrl.searchParams.get("arch") as Arch;
    if (!ARCHES.includes(arch)) throw new ApiError(400, "bad_arch", `Unsupported architecture. Use one of: ${ARCHES.join(", ")}.`);
    const file = appImage(arch);
    if (!file) throw new ApiError(404, "not_built", `No runner build for ${arch} on this Opal server yet. Run \`npm run appimage\` in apps/runner.`);
    return new Response(Readable.toWeb(createReadStream(file.path)) as ReadableStream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(file.size),
        "Content-Disposition": `attachment; filename="opal-runner-${arch}.AppImage"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
