// Tools that pause for the user. They have no `execute`: the client renders a form and answers
// with addToolOutput, then the conversation continues. The server only accepts those answers
// for the tool names listed in CLIENT_TOOLS, and re-checks them (see chat.ts).
import { tool } from "ai";
import { z } from "zod";
import { listSecrets } from "../../vault";
import type { RunContext } from "../context";

export const CLIENT_TOOLS = ["request_secret", "ask_user"] as const;

export function interactiveTools(ctx: RunContext) {
  return {
    list_secrets: tool({
      description:
        "List the names of secrets saved in the user's vault. Values are never shown. Use a secret by writing {{secret:NAME}} inside a browser or terminal tool call.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await listSecrets(ctx.userId);
        return { secrets: rows.map((r) => ({ name: r.name, label: r.label, description: r.description })) };
      },
    }),

    request_secret: tool({
      description:
        "Ask the user to store a secret (password, API key, token) in their encrypted vault. The user types it into a secure form; you never see the value. After it is saved you get back a placeholder like {{secret:NAME}} to use in browser or terminal tools. Check list_secrets first.",
      inputSchema: z.object({
        name: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]{1,63}$/)
          .describe("UPPER_SNAKE_CASE identifier, for example ECLASS_PASSWORD"),
        label: z.string().max(80).describe("Short human label, for example 'eClass password'"),
        reason: z.string().max(300).describe("Why it is needed, shown to the user"),
      }),
      outputSchema: z.object({ status: z.enum(["saved", "declined"]), placeholder: z.string().optional() }),
    }),

    ask_user: tool({
      description:
        "Ask the user a quick multiple-choice question when you need a decision to continue. Prefer this over guessing when the choice matters.",
      inputSchema: z.object({
        question: z.string().max(300),
        options: z.array(z.string().max(100)).min(2).max(6),
        allowOther: z.boolean().optional(),
      }),
      outputSchema: z.object({ answer: z.string() }),
    }),
  };
}
