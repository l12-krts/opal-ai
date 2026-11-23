// Live Opal Code updates for the browser (threads, items, machines, terminal output).
import { api } from "@/server/http";
import { sseResponse, subscribe } from "@/server/code/hub";

export const dynamic = "force-dynamic";
export const maxDuration = 86400;

export const GET = api(async ({ req, user }) => sseResponse(req.signal, (write) => subscribe(user.id, write)));
