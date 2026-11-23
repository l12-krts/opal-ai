import { z } from "zod";
import { api, readJson } from "@/server/http";
import { send } from "@/server/code/hub";
import { ownedTerminal, terminals } from "@/server/code/terminals";

export const dynamic = "force-dynamic";

const Id = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/);

/** Keystrokes and resizes. Not rate limited per request: typing sends many small writes. */
export const POST = api<{ id: string }>(async ({ req, user, params }) => {
  const termId = Id.parse(params.id);
  const t = ownedTerminal(user.id, termId);
  const body = await readJson(req, z.object({ input: z.string().max(64 * 1024).optional(), cols: z.number().int().min(10).max(500).optional(), rows: z.number().int().min(4).max(200).optional() }));
  if (body.input) send(t.machineId, "terminal.input", { termId, data: body.input });
  if (body.cols && body.rows) send(t.machineId, "terminal.resize", { termId, cols: body.cols, rows: body.rows });
  return { ok: true };
});

export const DELETE = api<{ id: string }>(async ({ user, params }) => {
  const termId = Id.parse(params.id);
  const t = ownedTerminal(user.id, termId);
  terminals.delete(termId);
  try {
    send(t.machineId, "terminal.close", { termId });
  } catch {}
  return { ok: true };
});
