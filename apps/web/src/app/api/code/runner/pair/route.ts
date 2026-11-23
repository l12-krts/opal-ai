// A runner trades a short pairing code (shown in Opal → Code → Machines) for a machine token.
import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { codeMachine, codePairing } from "@/server/db/schema";
import { ApiError, clientIp, errorResponse, readJson } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { hashToken } from "@/server/code/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const r = rateLimit(`runner-pair:${clientIp(req)}`, 10, 15 * 60_000);
    if (!r.ok) throw new ApiError(429, "rate_limited", "Too many pairing attempts. Wait a few minutes.");
    const body = await readJson(
      req,
      z.object({
        code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/),
        name: z.string().trim().min(1).max(60),
        os: z.string().max(40).default(""),
        hostname: z.string().max(120).default(""),
        projectsRoot: z.string().trim().min(1).max(500),
      }),
      8 * 1024,
    );
    const code = body.code.replace("-", "");
    const [p] = await db.select().from(codePairing).where(and(eq(codePairing.code, code), gt(codePairing.expiresAt, new Date()))).limit(1);
    if (!p) throw new ApiError(400, "bad_code", "That code is wrong or expired. Make a new one in Opal → Code → Machines.");
    await db.delete(codePairing).where(eq(codePairing.code, code));
    const token = `opr_${randomBytes(32).toString("base64url")}`;
    const id = nanoid();
    await db.insert(codeMachine).values({
      id,
      userId: p.userId,
      name: body.name,
      os: body.os,
      hostname: body.hostname,
      projectsRoot: body.projectsRoot,
      tokenHash: hashToken(token),
    });
    return Response.json({ machineId: id, token });
  } catch (e) {
    return errorResponse(e);
  }
}
