// Secrets vault API. Values go in, never come out: GET returns names and labels only.
import { z } from "zod";
import { api, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { deleteSecret, listSecrets, putSecret, SECRET_NAME } from "@/server/vault";

export const GET = api(async ({ user }) => ({ secrets: await listSecrets(user.id) }), { limit: LIMITS.read });

export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(
      req,
      z.object({
        name: z.string().regex(SECRET_NAME),
        label: z.string().trim().min(1).max(80),
        description: z.string().max(300).optional(),
        value: z.string().min(1).max(8192),
      }),
      16 * 1024,
    );
    await putSecret(user.id, body);
    return { ok: true, name: body.name };
  },
  { limit: LIMITS.secrets, limitKey: "secrets" },
);

export const DELETE = api(
  async ({ req, user }) => {
    const name = req.nextUrl.searchParams.get("name") ?? "";
    if (!SECRET_NAME.test(name)) return { ok: false };
    await deleteSecret(user.id, name);
    return { ok: true };
  },
  { limit: LIMITS.secrets, limitKey: "secrets" },
);
