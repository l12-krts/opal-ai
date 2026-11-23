// The chat turn. History always comes from the database, never from the client: the client
// sends only the new user message, or answers to approvals / secure forms for the last
// assistant message, and the server applies those to its own stored copy.
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  streamText,
  toUIMessageStream,
  type ToolSet,
} from "ai";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { ChatMode, OpalMetadata, OpalUIMessage, Route } from "@/lib/types";
import { db } from "../db";
import { agent as agentTable, conversation, message, usageDaily, userSettings } from "../db/schema";
import { ApiError, idSchema, type AuthedUser } from "../http";
import { listSecrets } from "../vault";
import { composioEnabled } from "../connectors/composio";
import { dockerAvailable } from "../sandbox/docker";
import { approvalFor, buildToolset, type AgentLike } from "./agents";
import { AgentBus } from "./bus";
import { trimOldToolResults } from "./context-trim";
import { labelInbound, saveMessage } from "./threads";
import { expandSkillCommands, loadPersonal, personalPrompt } from "./personal";
import type { RunContext } from "./context";
import {
  availableModels,
  fastModelId,
  getModel,
  AUTO_MODEL,
  isAllowedModel,
  mainModelId,
  ModelUnavailableError,
  noThinking,
  reasoningOptions,
  visionModelFor,
} from "./models";
import { agentSystemPrompt, opalSystemPrompt } from "./prompts";
import { pickAutoTier, routeMessage } from "./router";
import { recordLive, startLive } from "./live-streams";
import { CLIENT_TOOLS } from "./tools/interactive";
import { ATTACHMENT_LIMITS, claimFileParts, expandAttachments, fileNames } from "../attachments";

const MAX_TEXT = 32_000;
const HISTORY_LIMIT = 60;

const TextPart = z.object({ type: z.literal("text"), text: z.string().max(MAX_TEXT) });
// File parts only carry our own attachment link; name and type are re-read from the database.
const FilePart = z.object({ type: z.literal("file"), url: z.string().max(80), mediaType: z.string().max(100).optional(), filename: z.string().max(200).optional() });
const UserPart = z.discriminatedUnion("type", [TextPart, FilePart]);

export const ChatBody = z.object({
  conversationId: idSchema,
  message: z
    .object({
      id: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
      role: z.literal("user"),
      parts: z.array(UserPart).min(1).max(ATTACHMENT_LIMITS.perMessage + 2),
    })
    .optional(),
  approvals: z
    .array(z.object({ approvalId: z.string().max(128), approved: z.boolean(), reason: z.string().max(500).optional() }))
    .max(20)
    .optional(),
  toolOutputs: z
    .array(z.object({ toolCallId: z.string().max(128), tool: z.enum(CLIENT_TOOLS), output: z.record(z.string(), z.unknown()) }))
    .max(10)
    .optional(),
  regenerate: z.boolean().optional(),
  mode: z.enum(["chat", "study"]).optional(),
  agentId: idSchema.optional(),
  model: z.string().max(120).optional(),
  // Composer toggles: hand the turn to agents, or answer in handwriting.
  tools: z.object({ agents: z.boolean().optional(), handwriting: z.boolean().optional() }).optional(),
});

type Body = z.infer<typeof ChatBody>;

async function loadOrCreateConversation(user: AuthedUser, body: Body) {
  const [own] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, body.conversationId), eq(conversation.userId, user.id)))
    .limit(1);
  if (own) return own;
  if (!body.message) throw new ApiError(404, "not_found", "Chat not found");
  // The id is client-generated; if it belongs to someone else, answer exactly like "not found".
  const [taken] = await db.select({ id: conversation.id }).from(conversation).where(eq(conversation.id, body.conversationId)).limit(1);
  if (taken) throw new ApiError(404, "not_found", "Chat not found");
  // Agent threads are created by /api/agents/:id/thread; the chat endpoint only creates Opal chats.
  const [created] = await db
    .insert(conversation)
    .values({ id: body.conversationId, userId: user.id, mode: body.mode ?? "chat" })
    .returning();
  return created;
}

async function loadHistory(conversationId: string): Promise<OpalUIMessage[]> {
  const rows = await db
    .select()
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.createdAt));
  return rows.map((r) => ({ id: r.id, role: r.role, parts: r.parts as OpalUIMessage["parts"], metadata: (r.metadata ?? {}) as OpalMetadata }));
}

/** Apply approval decisions and secure-form answers to the stored last assistant message. */
async function applyResponses(userId: string, last: OpalUIMessage, body: Body) {
  let changed = false;
  const secrets = body.toolOutputs?.some((t) => t.tool === "request_secret") ? await listSecrets(userId) : [];
  for (const part of last.parts as any[]) {
    if (typeof part.type !== "string" || !part.type.startsWith("tool-") && part.type !== "dynamic-tool") continue;
    if (part.state === "approval-requested") {
      const d = body.approvals?.find((a) => a.approvalId === part.approval?.id);
      if (d) {
        part.state = "approval-responded";
        part.approval = { ...part.approval, approved: d.approved, reason: d.reason };
        changed = true;
      }
    }
    if (part.state === "input-available") {
      const o = body.toolOutputs?.find((t) => t.toolCallId === part.toolCallId && part.type === `tool-${t.tool}`);
      if (!o) continue;
      if (o.tool === "request_secret") {
        const name = String(part.input?.name ?? "");
        const saved = o.output.status === "saved" && secrets.some((s) => s.name === name);
        part.output = saved ? { status: "saved", placeholder: `{{secret:${name}}}` } : { status: "declined" };
      } else {
        part.output = { answer: String(o.output.answer ?? "").slice(0, 500) };
      }
      part.state = "output-available";
      changed = true;
    }
  }
  return changed;
}

/** The model Auto picked for a chat's first reply, if the chat started on Auto. */
export function autoLockedModel(history: OpalUIMessage[]): string | undefined {
  const first = history.find((m) => m.role === "assistant");
  const route = first?.parts.find((p) => p.type === "data-route") as { data?: { model?: unknown; auto?: unknown } } | undefined;
  const model = route?.data?.model;
  return route?.data?.auto && typeof model === "string" && isAllowedModel(model) ? model : undefined;
}

function textOf(m: OpalUIMessage | undefined): string {
  if (!m) return "";
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

async function recordUsage(userId: string, input = 0, output = 0) {
  const day = new Date().toISOString().slice(0, 10);
  await db
    .insert(usageDaily)
    .values({ userId, day, requests: 1, inputTokens: input, outputTokens: output })
    .onConflictDoUpdate({
      target: [usageDaily.userId, usageDaily.day],
      set: {
        requests: sql`${usageDaily.requests} + 1`,
        inputTokens: sql`${usageDaily.inputTokens} + ${input}`,
        outputTokens: sql`${usageDaily.outputTokens} + ${output}`,
      },
    });
}

async function makeTitle(text: string): Promise<string | null> {
  try {
    const { text: t } = await generateText({
      model: getModel(fastModelId()),
      timeout: 6000,
      maxRetries: 0,
      maxOutputTokens: 24,
      temperature: 0.2,
      providerOptions: noThinking(fastModelId()) as never,
      instructions:
        "You name chats. Do not answer the message. Reply with only a 2-6 word title that describes it, in the same language as the message. Sentence case, no quotes, no period.",
      prompt: `Message:
"""
${text.slice(0, 1500)}
"""

Title:`,
    });
    const clean = t.replace(/["«»“”.]/g, "").trim().slice(0, 80);
    return clean || null;
  } catch {
    return null;
  }
}

export async function handleChat(req: Request, user: AuthedUser, body: Body): Promise<Response> {
  const conv = await loadOrCreateConversation(user, body);
  let history = await loadHistory(conv.id);

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
  const nerd = settings?.nerdMode ?? false;
  const mode: ChatMode = conv.mode;

  let route: Route;
  let routeReason = "";
  let routeMs = 0;
  const isNewUserTurn = Boolean(body.message);

  if (body.message) {
    if (history.some((m) => m.id === body.message!.id)) throw new ApiError(409, "duplicate", "Message already sent");
    const text = body.message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n\n")
      .trim();
    const fileParts = body.message.parts.filter((p) => p.type === "file");
    if (fileParts.length > ATTACHMENT_LIMITS.perMessage) throw new ApiError(400, "too_many_files", "Attach up to 10 files per message");
    const files = await claimFileParts(user.id, conv.id, fileParts);
    if (!text && !files.length) throw new ApiError(400, "empty_message", "Type a message or attach a file");
    const userMsg: OpalUIMessage = {
      id: body.message.id,
      role: "user",
      parts: [...files, ...(text ? [{ type: "text" as const, text }] : [])],
      metadata: { startedAt: Date.now() },
    };
    await saveMessage(conv.id, userMsg);
    history.push(userMsg);
  } else if (body.regenerate) {
    const last = history[history.length - 1];
    if (last?.role === "assistant") {
      await db.delete(message).where(and(eq(message.id, last.id), eq(message.conversationId, conv.id)));
      history = history.slice(0, -1);
    }
    if (history[history.length - 1]?.role !== "user") throw new ApiError(400, "nothing_to_regenerate", "Nothing to regenerate");
  } else {
    const last = history[history.length - 1];
    if (!last || last.role !== "assistant" || !(await applyResponses(user.id, last, body))) {
      throw new ApiError(400, "nothing_to_continue", "Nothing to continue");
    }
    await saveMessage(conv.id, last);
  }

  // Which agent, if any, is this chat with?
  const [convAgent] = conv.agentId
    ? await db.select().from(agentTable).where(and(eq(agentTable.id, conv.agentId), eq(agentTable.userId, user.id))).limit(1)
    : [];

  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");

  const requested = body.model && isAllowedModel(body.model) ? body.model : undefined;
  // An Opal chat that started on Auto keeps the model Auto picked for its first reply.
  const locked = conv.agentId ? undefined : autoLockedModel(history);
  let modelId = locked ?? requested ?? convAgent?.model ?? settings?.model ?? mainModelId();
  // Images on the newest user message need a model that can see them.
  const isImage = (m: OpalUIMessage) => m.parts.some((p) => p.type === "file" && p.mediaType.startsWith("image/"));
  const userMsgs = history.slice(-HISTORY_LIMIT).filter((m) => m.role === "user");
  const lastUserMsg = userMsgs[userMsgs.length - 1];
  const hasImages = Boolean(lastUserMsg && isImage(lastUserMsg));
  const auto = modelId === AUTO_MODEL;
  let autoReason = "";

  if (isNewUserTurn || body.regenerate) {
    const savedAgents = await db
      .select({ name: agentTable.name })
      .from(agentTable)
      .where(and(eq(agentTable.userId, user.id), isNull(agentTable.conversationId)));
    const lastUser = history[history.length - 1];
    const names = fileNames(lastUser);
    const text = [textOf(lastUser), names.length ? `(attached: ${names.join(", ")})` : ""].filter(Boolean).join("\n");
    const mentions = savedAgents.some((a) => new RegExp(`@${a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
    // Opal Auto: decide Lightning vs Thinking alongside the route, so it adds no wait.
    const autoPick = auto
      ? pickAutoTier({ text, hasImages, earlierImages: userMsgs.slice(0, -1).some(isImage), recentContext: textOf(lastAssistant) })
      : null;
    const decision = await routeMessage({
      text,
      mentionsAgent: mentions,
      forcedAgent: Boolean(convAgent),
      recentContext: textOf(lastAssistant),
    });
    if (autoPick) {
      const a = await autoPick;
      modelId = a.tier === "thinking" ? "opal:thinking" : "opal:lightning";
      autoReason = a.reason;
    }
    route = decision.route;
    routeReason = decision.reason;
    routeMs = decision.ms;
    if (body.tools?.agents && route !== "agents") {
      route = "agents";
      routeReason = "Agents turned on in the composer";
    }
  } else {
    route = (lastAssistant?.metadata?.route as Route) ?? "direct";
    // Continuing a turn (after an approval or a form): keep the model Auto picked for it.
    const prev = lastAssistant?.metadata?.model;
    if (auto && typeof prev === "string" && isAllowedModel(prev)) modelId = prev;
  }

  if (hasImages) modelId = visionModelFor(modelId) ?? modelId;
  const vision = Boolean(availableModels().find((m) => m.id === modelId)?.vision);
  let model;
  try {
    model = getModel(modelId);
  } catch (err) {
    if (err instanceof ModelUnavailableError) throw new ApiError(503, "no_model", "No AI provider is configured. Add NVIDIA_API_KEY to .env.local.");
    throw err;
  }

  const userAgents = await db
    .select()
    .from(agentTable)
    .where(and(eq(agentTable.userId, user.id), isNull(agentTable.conversationId)));
  const [dockerReady] = await Promise.all([dockerAvailable()]);

  const titlePromise =
    isNewUserTurn && !conv.agentId && conv.title === "New chat" && history.filter((m) => m.role === "user").length === 1
      ? makeTitle(textOf(history[history.length - 1]) || `Files: ${fileNames(history[history.length - 1]).join(", ")}`)
      : null;

  const recent = history.slice(-HISTORY_LIMIT);

  // The reply runs to the end even if the user leaves the chat; only Stop (or a newer turn in
  // the same chat) aborts it. A returning client reconnects through /api/chat/:id/stream.
  const liveCtl = startLive(conv.id, user.id);
  const signal = liveCtl.signal;

  const stream = createUIMessageStream<OpalUIMessage>({
    originalMessages: recent,
    generateId: () => nanoid(),
    onError: (err) => {
      console.error("[chat]", err);
      if (err instanceof Error && /401|403|api key|unauthorized/i.test(err.message)) return "The AI provider rejected the request. Check the API key.";
      if (err instanceof Error && /429|rate/i.test(err.message)) return "The AI provider is rate limiting. Try again in a moment.";
      if (err instanceof Error && /timeout|timed out/i.test(err.message)) return "The model took too long to respond. Try again, or switch models in the composer.";
      return "Something went wrong while answering.";
    },
    execute: async ({ writer }) => {
      if (isNewUserTurn || body.regenerate) {
        writer.write({ type: "data-route", data: { route, reason: routeReason, ms: routeMs, model: modelId, ...(autoReason ? { auto: autoReason } : {}) } });
      }

      const bus = new AgentBus();
      const ctx: RunContext = {
        userId: user.id,
        userName: user.name,
        conversationId: conv.id,
        writer,
        signal,
        nerd,
        mode,
        modelId,
        depth: 0,
        self: convAgent
          ? { agentId: convAgent.id, name: convAgent.name, color: convAgent.color, shape: convAgent.shape, runId: "main", threadId: conv.id }
          : undefined,
        chain: convAgent ? [convAgent.id] : [],
        sandboxAgentId: convAgent?.id ?? `opal-${user.id}`,
        sandboxAgentName: convAgent?.name ?? "Opal",
        sandboxColor: convAgent?.color ?? "#71717a",
        bus,
        secretValues: [],
      };

      const personal = await loadPersonal(user.id);
      // Agent tools are there on every route: a request that looked simple can still turn out to
      // need helpers (the prompt says when).
      const tools: ToolSet = await buildToolset(ctx, { agentTools: true, personal });

      const instructions = convAgent
        ? agentSystemPrompt({ name: convAgent.name, userName: user.name, agentTools: true })
        : opalSystemPrompt({
            mode,
            route,
            userName: user.name,
            agents: userAgents.map((a) => ({ name: a.name })),
            connectorsReady: composioEnabled(),
            dockerReady,
          });

      const withPersonal = instructions + personalPrompt(personal, user.name);
      const instructionsFinal = body.tools?.handwriting
        ? `${withPersonal}

The user turned on handwriting for this message: do any research you need, then deliver the final answer with write_by_hand. Keep the chat reply to one short line.`
        : withPersonal;

      const modelMessages = await convertToModelMessages(expandSkillCommands(labelInbound(await expandAttachments(user.id, recent, vision)), personal), {
        tools,
        ignoreIncompleteToolCalls: true,
        convertDataPart: () => undefined,
      });

      const startedAt = Date.now();
      const result = streamText({
        model,
        instructions: instructionsFinal,
        messages: trimOldToolResults(modelMessages),
        tools,
        stopWhen: isStepCount(route === "agents" || convAgent ? 24 : 12),
        // Long results from earlier steps are shortened so later steps stay fast.
        prepareStep: ({ messages: current }) => ({ messages: trimOldToolResults(current) }),
        abortSignal: signal,
        maxRetries: 2,
        // A stuck provider fails with a clear error instead of spinning forever. The first-chunk
        // limit is generous: some NIM models queue for ~50 s before they start.
        // Tool calls (agents, sandboxes) get their own longer limit.
        timeout: { firstChunkMs: 120_000, chunkMs: 90_000, toolMs: 15 * 60_000 },
        toolApproval: approvalFor(false),
        providerOptions: reasoningOptions(modelId, nerd) as never,
        onEnd: async (event: any) => {
          const u = event?.usage ?? event?.totalUsage;
          await recordUsage(user.id, u?.inputTokens ?? 0, u?.outputTokens ?? 0).catch(() => {});
        },
      });

      writer.merge(
        toUIMessageStream<ToolSet, OpalUIMessage>({
          stream: result.stream,
          tools,
          sendReasoning: true,
          sendStart: false,
          messageMetadata: ({ part }) => {
            if (part.type === "start-step") return { model: modelId, route, startedAt };
            if (part.type === "finish") {
              return {
                model: modelId,
                route,
                startedAt,
                finishedAt: Date.now(),
                inputTokens: part.totalUsage?.inputTokens,
                outputTokens: part.totalUsage?.outputTokens,
                reasoningTokens: (part.totalUsage as any)?.outputTokenDetails?.reasoningTokens,
              };
            }
            return undefined;
          },
        }),
      );

      if (titlePromise) {
        const title = await Promise.race([titlePromise, new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
        if (title) {
          await db.update(conversation).set({ title }).where(eq(conversation.id, conv.id));
          writer.write({ type: "data-title", data: { title }, transient: true });
        }
      }
    },
    onEnd: async ({ messages }) => {
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") await saveMessage(conv.id, last);
      await db.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, conv.id));
    },
  });

  return createUIMessageStreamResponse({
    stream,
    keepAliveMs: 15_000,
    consumeSseStream: ({ stream: copy }) => {
      void recordLive(conv.id, liveCtl, copy);
    },
  });
}

export type { AgentLike };
