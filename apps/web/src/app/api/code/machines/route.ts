// POST: make a pairing code for a new machine (valid 15 minutes).
import { randomInt } from "node:crypto";
import { lt } from "drizzle-orm";
import { db } from "@/server/db";
import { codePairing } from "@/server/db/schema";
import { api } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { ARCHES, appImage, reachableOrigins } from "@/server/code/runner-dist";

export const dynamic = "force-dynamic";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const POST = api(
  async ({ req, user }) => {
    await db.delete(codePairing).where(lt(codePairing.expiresAt, new Date()));
    const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    await db.insert(codePairing).values({ code, userId: user.id, expiresAt });
    return {
      code: `${code.slice(0, 4)}-${code.slice(4)}`,
      expiresAt: expiresAt.toISOString(),
      origins: reachableOrigins(req),
      appImage: ARCHES.filter((a) => appImage(a)),
    };
  },
  { limit: LIMITS.write },
);
