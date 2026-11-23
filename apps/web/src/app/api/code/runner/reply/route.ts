import { z } from "zod";
import { readJson } from "@/server/http";
import { resolveReply } from "@/server/code/hub";
import { runnerRoute } from "@/server/code/runner-auth";

export const dynamic = "force-dynamic";

export const POST = runnerRoute(async (req) => {
  const body = await readJson(req, z.object({ id: z.string().max(64), ok: z.boolean(), result: z.unknown().optional(), error: z.string().max(4000).optional() }), 8 * 1024 * 1024);
  resolveReply(body.id, body.ok, body.result, body.error);
  return { ok: true };
});
