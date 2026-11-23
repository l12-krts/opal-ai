import { z } from "zod";
import { api, ApiError, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { composioEnabled, connectToolkit, disconnectAccount, listToolkits } from "@/server/connectors/composio";

export const GET = api(
  async ({ req, user }) => {
    if (!composioEnabled()) return { enabled: false, toolkits: [] };
    const search = req.nextUrl.searchParams.get("q")?.slice(0, 60) ?? undefined;
    try {
      return { enabled: true, toolkits: await listToolkits(user.id, { search }) };
    } catch (err) {
      console.error("[connectors]", err);
      throw new ApiError(502, "composio_error", "Couldn't reach Composio");
    }
  },
  { limit: LIMITS.read },
);

export const POST = api(
  async ({ req, user }) => {
    if (!composioEnabled()) throw new ApiError(503, "disabled", "Connectors are not configured");
    const { toolkit } = await readJson(req, z.object({ toolkit: z.string().regex(/^[a-z0-9_-]{2,60}$/i) }), 1024);
    return connectToolkit(user.id, toolkit);
  },
  { limit: LIMITS.write },
);

export const DELETE = api(
  async ({ req, user }) => {
    const id = req.nextUrl.searchParams.get("account") ?? "";
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new ApiError(400, "invalid", "Invalid account");
    await disconnectAccount(user.id, id);
    return { ok: true };
  },
  { limit: LIMITS.write },
);
