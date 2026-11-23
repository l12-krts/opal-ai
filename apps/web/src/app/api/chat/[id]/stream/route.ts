// Reconnect to a reply that is still running (the chat was left and opened again), or stop it.
import { api, idSchema } from "@/server/http";
import { replayLive, stopLive } from "@/server/ai/live-streams";

export const maxDuration = 800;

export const GET = api<{ id: string }>(async ({ user, params }) => {
  const id = idSchema.parse(params.id);
  const stream = replayLive(id, user.id);
  if (!stream) return new Response(null, { status: 204 });
  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
      "x-accel-buffering": "no",
    },
  });
});

export const DELETE = api<{ id: string }>(async ({ user, params }) => {
  const id = idSchema.parse(params.id);
  return { stopped: stopLive(id, user.id) };
});
