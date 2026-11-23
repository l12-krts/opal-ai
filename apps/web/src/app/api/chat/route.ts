import { api, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { ChatBody, handleChat } from "@/server/ai/chat";

export const maxDuration = 800;

export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(req, ChatBody, 200 * 1024);
    return handleChat(req, user, body);
  },
  { limit: LIMITS.chat, limitKey: "chat" },
);
