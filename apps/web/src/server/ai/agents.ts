// Agents: running them, the tools they use to talk to each other, and the toolset.
//
// Every agent has one thread. A message to an agent (from Opal, another agent, or the user) is
// appended to that thread, the agent works on it with its own computer and every tool, and its
// reply is saved to the thread too. While it works, its UI stream is relayed to the client so the
// conversation can be watched live; the sender gets the reply as the tool result.
import {
  convertToModelMessages,
  isStepCount,
  readUIMessageStream,
  streamText,
  tool,
  toUIMessageStream,
  type ModelMessage,
  type ToolSet,
  type UIMessageChunk,
} from "ai";
import { and, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { AGENT_COLORS, type AgentRunView, type AgentSender, type OpalUIMessage } from "@/lib/types";
import { SHAPE_IDS } from "@/lib/agent-shapes";
import { db } from "../db";
import { agent as agentTable, agentRun, type Agent } from "../db/schema";
import { composioBlocked, composioNeedsApproval, connectorTools } from "../connectors/composio";
import { expandAttachments } from "../attachments";
import { redact } from "../vault";
import { MAX_AGENT_DEPTH, type RunContext } from "./context";
import { AUTO_MODEL, availableModels, getModel, isAllowedModel, reasoningOptions } from "./models";
import { agentSystemPrompt } from "./prompts";
import { trimOldToolResults } from "./context-trim";
import { agentThread, labelInbound, loadMessages, saveMessage, touchConversation } from "./threads";
import { expandSkillCommands, loadPersonal, personalPrompt, personalTools, type Personal } from "./personal";
import { artifactTools } from "./tools/artifacts";
import { handwritingTools } from "./tools/handwriting";
import { interactiveTools } from "./tools/interactive";
import { sandboxTools } from "./tools/sandbox";
import { studyTools } from "./tools/study";
import { webTools } from "./tools/web";
import { codeTools } from "./tools/code";

export type AgentLike = Pick<Agent, "id" | "name" | "color" | "shape" | "model" | "ephemeral">;

/** Steps an agent gets per message. */
const AGENT_MAX_STEPS = 16;
/** After this long an agent stops using tools and replies with what it has. */
const AGENT_BUDGET_MS = 6 * 60_000;
/** Times a run carries on after its model stream stalls mid-step. */
const AGENT_STALL_RETRIES = 2;

const STUDY_AI = {
  name: "Study AI",
  color: "#14b8a6",
  shape: "cookie",
  extra:
    "You are the Opal Study AI. Find the right material (ebooks.edu.gr textbooks, the user's eClass), read it, and produce what was asked: explanations, summaries, quizzes with an explanation for every wrong option, flashcards, or handwritten notes.",
};

/** Tools that drive the agent conversation views on the client. */
export const AGENT_MESSAGE_TOOLS = ["message_agent", "spawn_agent", "study_helper"] as const;

// ─── Toolset ─────────────────────────────────────────────────────────────────

/** Everyone (Opal and every agent) gets every tool. Agents nested too deep can't start more agents. */
export async function buildToolset(ctx: RunContext, opts: { agentTools: boolean; personal?: Personal }): Promise<ToolSet> {
  const tools: ToolSet = {};
  Object.assign(tools, interactiveTools(ctx));
  // Forms that wait for the user only work on the turn the user is watching.
  if (ctx.depth > 0) {
    delete tools.request_secret;
    delete tools.ask_user;
  }
  Object.assign(tools, artifactTools(ctx), webTools(ctx), studyTools(ctx), handwritingTools(ctx), sandboxTools(ctx));
  Object.assign(tools, codeTools(ctx));
  Object.assign(tools, await connectorTools(ctx.userId));
  Object.assign(tools, personalTools(ctx, opts.personal ?? (await loadPersonal(ctx.userId))));
  if (opts.agentTools && ctx.depth < MAX_AGENT_DEPTH) {
    Object.assign(tools, agentTools(ctx));
    if (ctx.self?.name !== STUDY_AI.name) Object.assign(tools, studyHelperTool(ctx));
  }
  return tools;
}

/** Approval policy shared by Opal and agents. */
export function approvalFor(isNested: boolean) {
  return ({ toolCall }: { toolCall: { toolName: string; input: unknown } }) => {
    const blocked = composioBlocked(toolCall.toolName, toolCall.input);
    if (blocked) return { type: "denied", reason: blocked } as const;
    if (composioNeedsApproval(toolCall.toolName, toolCall.input)) {
      // Approval needs the user's click, which only works on the turn the user is watching.
      return isNested
        ? ({ type: "denied", reason: "Changing things in the user's apps needs their approval. Report the exact action back so it can be asked for." } as const)
        : ({ type: "user-approval", reason: "This changes something in a connected app" } as const);
    }
    return undefined;
  };
}

// ─── Running an agent ────────────────────────────────────────────────────────

function stepLabel(tool: string, input: any): string {
  switch (tool) {
    case "browser":
      return input?.action === "goto"
        ? `Opened ${safeHost(input.url)}`
        : ({ read: "Reading the page", click: "Clicking on the page", type: "Typing on the page", scroll: "Scrolling", back: "Going back", press: "Pressing a key" } as Record<string, string>)[input?.action] ?? "Using the browser";
    case "terminal":
      return `Running ${String(input?.command ?? "").split("\n")[0].slice(0, 60)}`;
    case "write_file":
      return `Writing ${input?.path}`;
    case "read_file":
      return `Reading ${input?.path}`;
    case "list_files":
      return "Listing files";
    case "read_webpage":
      return `Reading ${safeHost(input?.url)}`;
    case "remember":
      return "Saving to memory";
    case "use_skill":
      return `Using the ${input?.name} skill`;
    case "web_search":
      return `Searching "${String(input?.query ?? "").slice(0, 60)}"`;
    case "study_search":
      return `Searching "${input?.query}"`;
    case "study_read":
      return "Reading study material";
    case "create_quiz":
      return "Making a quiz";
    case "create_flashcards":
      return "Making flashcards";
    case "message_agent":
      return `Messaging ${input?.to}`;
    case "spawn_agent":
      return `Starting ${input?.name}`;
    case "study_helper":
      return "Asking Study AI";
    default:
      return tool.startsWith("COMPOSIO_") ? tool.replace("COMPOSIO_", "").toLowerCase().replaceAll("_", " ") : tool.replaceAll("_", " ");
  }
}

function safeHost(u: unknown) {
  try {
    return new URL(String(u)).hostname;
  } catch {
    return "page";
  }
}

export function senderOf(ctx: RunContext): AgentSender {
  return ctx.self
    ? { key: `agent:${ctx.self.agentId}`, kind: "agent", name: ctx.self.name, color: ctx.self.color, shape: ctx.self.shape, agentId: ctx.self.agentId }
    : { key: `opal:${ctx.conversationId}`, kind: "opal", name: "Opal" };
}

/** The reply is the text of the last step that wrote any (agents often write, then make one more call). */
function replyText(m: OpalUIMessage | undefined): string {
  if (!m) return "";
  let current: string[] = [];
  let last: string[] = [];
  for (const p of m.parts) {
    if (p.type === "step-start") {
      if (current.length) last = current;
      current = [];
    } else if (p.type === "text" && p.text.trim()) current.push(p.text.trim());
  }
  if (current.length) last = current;
  return last.join("\n\n");
}

export type RunResult = { runId: string; threadId: string; text: string; status: "done" | "error" };

export async function runAgent(
  ctx: RunContext,
  agent: AgentLike,
  text: string,
  opts: { toolCallId?: string; extra?: string } = {},
): Promise<RunResult> {
  const runId = nanoid();
  const from = senderOf(ctx);
  const threadId = await agentThread(ctx.userId, agent);
  const view: AgentRunView = {
    runId,
    toolCallId: opts.toolCallId,
    agentId: agent.id,
    threadId,
    name: agent.name,
    color: agent.color,
    shape: agent.shape,
    ephemeral: agent.ephemeral,
    from,
    task: text.slice(0, 4000),
    status: "running",
    toolCount: 0,
    startedAt: Date.now(),
    parentRunId: ctx.self?.runId,
  };

  // Runs started on the turn the user is watching are kept in that message (so the chat can show
  // who was messaged after a reload); deeper ones are only relayed live.
  let lastEmit = 0;
  let pending: NodeJS.Timeout | undefined;
  const emit = (force = false) => {
    const send = () => {
      lastEmit = Date.now();
      pending = undefined;
      ctx.writer.write({ type: "data-agent", id: runId, data: { ...view }, ...(ctx.depth === 0 ? {} : { transient: true }) });
    };
    if (force || Date.now() - lastEmit > 250) {
      if (pending) clearTimeout(pending);
      send();
    } else if (!pending) pending = setTimeout(send, 250);
  };
  emit(true);

  const startedAt = Date.now();
  const inbound: OpalUIMessage = {
    id: `in_${runId}`,
    role: "user",
    parts: [{ type: "text", text }],
    metadata: { from, startedAt, run: { runId, fromKey: from.key } },
  };
  await saveMessage(threadId, inbound);
  await touchConversation(threadId);
  await db.insert(agentRun).values({
    id: runId,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    agentId: agent.id,
    parentRunId: ctx.self?.runId ?? null,
    task: text,
  });

  ctx.bus.register(agent.id, agent.name);
  const childCtx: RunContext = {
    ...ctx,
    depth: ctx.depth + 1,
    self: { agentId: agent.id, name: agent.name, color: agent.color, shape: agent.shape, runId, threadId },
    chain: [...ctx.chain, agent.id],
    sandboxAgentId: agent.id,
    sandboxAgentName: agent.name,
    sandboxColor: agent.color,
  };
  // An agent set to Auto (or with no model) uses what the lead is using for this turn. Auto is
  // only resolved for chat messages, so anywhere else it runs as Lightning.
  const picked = agent.model && agent.model !== AUTO_MODEL ? agent.model : ctx.modelId;
  const modelId = picked === AUTO_MODEL ? "opal:lightning" : picked;

  let latest: OpalUIMessage | undefined;
  let saving: Promise<unknown> = Promise.resolve();
  try {
    const agentTools = childCtx.depth < MAX_AGENT_DEPTH;
    const personal = await loadPersonal(ctx.userId);
    const tools = await buildToolset(childCtx, { agentTools, personal });
    const vision = Boolean(availableModels().find((m) => m.id === modelId)?.vision);
    const history = await loadMessages(threadId, 40);
    const messages = await convertToModelMessages(expandSkillCommands(labelInbound(await expandAttachments(ctx.userId, history, vision)), personal), {
      tools,
      ignoreIncompleteToolCalls: true,
      convertDataPart: () => undefined,
    });

    const instructions = agentSystemPrompt({ name: agent.name, userName: ctx.userName, agentTools, extra: opts.extra }) + personalPrompt(personal, ctx.userName);

    let errorText: string | undefined;
    // Messages from the steps that finished, so a run whose model stream stalls can carry on
    // from there instead of handing back half a step.
    let finished: ModelMessage[] = [];
    let stepsDone = 0;
    let gaveUp = false;

    const attempt = (base: ModelMessage[], stepsLeft: number) => {
      const result = streamText({
        model: getModel(modelId),
        instructions,
        messages: base,
        tools,
        stopWhen: isStepCount(stepsLeft),
        abortSignal: ctx.signal,
        maxRetries: 1,
        timeout: { firstChunkMs: 120_000, chunkMs: 90_000, toolMs: 5 * 60_000 },
        toolApproval: approvalFor(true),
        providerOptions: reasoningOptions(modelId, ctx.nerd) as never,
        prepareStep: ({ stepNumber, messages: current, responseMessages }) => {
          finished = [...base, ...responseMessages];
          stepsDone = stepNumber;
          // Out of time or steps: no more tools, write the reply from what's there.
          const late = Date.now() - startedAt > AGENT_BUDGET_MS;
          const trimmed = trimOldToolResults(current);
          if (!late && stepNumber < stepsLeft - 1) return { messages: trimmed };
          return {
            toolChoice: "none" as const,
            messages: [
              ...trimmed,
              {
                role: "user" as const,
                content: late
                  ? "[Opal] Time's up for this task. Don't use more tools: write your reply now from what you have, and say what you couldn't check."
                  : "[Opal] This is your last step. Don't use more tools: write your reply now from what you have, and say what you couldn't check.",
              },
            ],
          };
        },
      });
      return toUIMessageStream<ToolSet, OpalUIMessage>({
        stream: result.stream,
        tools,
        sendReasoning: true,
        generateMessageId: () => `run_${runId}`,
        onError: (err) => {
          errorText = err instanceof Error ? err.message.slice(0, 300) : "Agent failed";
          return errorText;
        },
        messageMetadata: ({ part }) => {
          if (part.type === "start-step") return { model: modelId, startedAt, run: { runId, fromKey: from.key } };
          if (part.type === "finish") {
            return {
              model: modelId,
              startedAt,
              finishedAt: Date.now(),
              run: { runId, fromKey: from.key },
              inputTokens: part.totalUsage?.inputTokens,
              outputTokens: part.totalUsage?.outputTokens,
            };
          }
          return undefined;
        },
      });
    };

    // One continuous stream for the run. When the model goes quiet mid-step (the chunk timeout
    // aborts it while the user hasn't stopped anything), the half-finished step is dropped and
    // the run picks up again from the last finished step.
    const pump = async (out: ReadableStreamDefaultController<UIMessageChunk>) => {
      let base = messages;
      let stepsLeft = AGENT_MAX_STEPS;
      for (let stalls = 0; ; stalls++) {
        const reader = attempt(base, stepsLeft).getReader();
        let stalled = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === "abort" && !ctx.signal.aborted) {
            if (stalls < AGENT_STALL_RETRIES) {
              stalled = true;
              continue;
            }
            gaveUp = true;
          }
          // The run's message was already started by the first attempt.
          if (stalls > 0 && value.type === "start") continue;
          out.enqueue(value);
        }
        if (!stalled) break;
        stepsLeft = Math.max(1, stepsLeft - stepsDone);
        base = finished;
        console.warn(`[agents] ${agent.name} (${runId}) stalled mid-step; resuming (${stalls + 1}/${AGENT_STALL_RETRIES})`);
      }
      out.close();
    };
    const ui = new ReadableStream<UIMessageChunk>({
      start(out) {
        void pump(out).catch((err) => out.error(err));
      },
    });
    const [toClient, toStore] = ui.tee();

    // Live relay: chunks go to the client in small batches; the run card tracks the current step.
    const relay = (async () => {
      const reader = toClient.getReader();
      let buf: unknown[] = [];
      let timer: NodeJS.Timeout | undefined;
      const flush = () => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        if (!buf.length) return;
        ctx.writer.write({ type: "data-agent-chunks", transient: true, data: { runId, chunks: buf } });
        buf = [];
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value as UIMessageChunk;
        buf.push(chunk);
        if (chunk.type === "tool-input-available") {
          view.current = stepLabel(chunk.toolName, chunk.input);
          view.toolCount = (view.toolCount ?? 0) + 1;
          emit();
        } else if (chunk.type === "text-start") {
          view.current = "Writing";
          emit();
        }
        if (buf.length >= 48) flush();
        else if (!timer) timer = setTimeout(flush, 60);
      }
      flush();
    })();

    // Persistence: the reply is saved to the thread as it grows, so a reload shows progress.
    const store = (async () => {
      let lastSave = Date.now();
      for await (const m of readUIMessageStream<OpalUIMessage>({ stream: toStore })) {
        latest = m;
        if (Date.now() - lastSave > 2500) {
          lastSave = Date.now();
          const snapshot = structuredClone(m);
          saving = saving.then(() => saveMessage(threadId, snapshot)).catch(() => {});
        }
      }
    })();

    await Promise.all([relay, store]);

    const written = replyText(latest);
    if (gaveUp) errorText ??= "its model stopped responding";
    const failed = !written && Boolean(errorText);
    const reply = written && gaveUp ? `${written}\n\n(${agent.name} was cut off: its model stopped responding. This may be unfinished.)` : written;
    const final = redact(reply || (errorText ? `${agent.name} ran into a problem: ${errorText}` : "(no reply)"), ctx.secretValues);
    if (latest) {
      const done = structuredClone(latest);
      saving = saving.then(() => saveMessage(threadId, done));
    }
    await saving;
    await touchConversation(threadId);
    await db
      .update(agentRun)
      .set({ status: failed ? "error" : "done", result: final.slice(0, 20000), finishedAt: new Date() })
      .where(eq(agentRun.id, runId));
    view.status = failed ? "error" : "done";
    view.result = final.slice(0, 4000);
    view.current = undefined;
    view.finishedAt = Date.now();
    emit(true);
    return { runId, threadId, text: final, status: failed ? "error" : "done" };
  } catch (err) {
    const msg = ctx.signal.aborted ? "Stopped" : err instanceof Error ? err.message.slice(0, 300) : "Agent failed";
    await saving.catch(() => {});
    if (latest) await saveMessage(threadId, latest).catch(() => {});
    await db
      .update(agentRun)
      .set({ status: ctx.signal.aborted ? "cancelled" : "error", result: msg, finishedAt: new Date() })
      .where(eq(agentRun.id, runId))
      .catch(() => {});
    view.status = "error";
    view.result = msg;
    view.current = undefined;
    view.finishedAt = Date.now();
    emit(true);
    return { runId, threadId, text: `${agent.name} failed: ${msg}`, status: "error" };
  } finally {
    if (pending) clearTimeout(pending);
    ctx.bus.unregister(agent.id);
  }
}

// ─── Agent tools ─────────────────────────────────────────────────────────────

/** Saved agents, plus helpers created in this chat. */
async function agentsInScope(ctx: RunContext) {
  return db
    .select()
    .from(agentTable)
    .where(and(eq(agentTable.userId, ctx.userId), or(isNull(agentTable.conversationId), eq(agentTable.conversationId, ctx.conversationId))));
}

async function findAgent(ctx: RunContext, name: string): Promise<Agent | undefined> {
  const n = name.trim().replace(/^@/, "").toLowerCase();
  const rows = await agentsInScope(ctx);
  // A helper made in this chat wins over a saved agent with the same name.
  return rows.find((r) => r.name.toLowerCase() === n && r.conversationId) ?? rows.find((r) => r.name.toLowerCase() === n);
}

function publicAgent(a: AgentLike) {
  return { id: a.id, name: a.name, color: a.color, shape: a.shape, ephemeral: a.ephemeral };
}

function runOutput(target: AgentLike, r: RunResult) {
  return {
    ok: r.status === "done",
    agent: publicAgent(target),
    threadId: r.threadId,
    runId: r.runId,
    status: r.status,
    reply: r.text.slice(0, 12000),
  };
}

/** Returns an error message if `target` can't be messaged from here. */
function unreachable(ctx: RunContext, target: Agent): string | undefined {
  if (target.id === ctx.self?.agentId) return "That's you. Your reply goes back to whoever messaged you.";
  if (ctx.chain.includes(target.id)) return `${target.name} is waiting for your reply. Put what you want to tell it in your reply.`;
  return undefined;
}

function agentTools(ctx: RunContext): ToolSet {
  return {
    list_agents: tool({
      description: "List the user's saved agents and the helpers created in this chat.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await agentsInScope(ctx);
        return {
          agents: rows
            .filter((r) => r.id !== ctx.self?.agentId)
            .map((r) => ({ name: r.name, temporary: r.ephemeral, busy: ctx.bus.busy(r.id) })),
        };
      },
    }),

    message_agent: tool({
      description:
        "Send a message to another agent and wait for its reply. The agent sees it in its own thread, works on it with its own computer and tools, then replies to you. Send several in one step to have agents work in parallel.",
      inputSchema: z.object({
        to: z.string().max(60).describe("The agent's name"),
        text: z.string().min(1).max(6000).describe("The message. Make a task self-contained: the agent only knows its own thread."),
      }),
      execute: async ({ to, text }, { toolCallId }) => {
        const target = await findAgent(ctx, to);
        if (!target) {
          const names = (await agentsInScope(ctx)).map((r) => r.name).filter((n) => n !== ctx.self?.name);
          return { ok: false, error: `No agent named ${to}. Agents: ${names.join(", ") || "none yet (use spawn_agent)"}` };
        }
        const blocked = unreachable(ctx, target);
        if (blocked) return { ok: false, agent: publicAgent(target), error: blocked };
        const r = await ctx.bus.run(target.id, () => runAgent(ctx, target, text, { toolCallId }));
        return runOutput(target, r);
      },
    }),

    spawn_agent: tool({
      description:
        "Create a new helper agent for part of the task and send it its first message. It gets its own computer and every tool, and exists for this chat (the user can save it). Call several in one step to work in parallel. Use message_agent for follow-ups.",
      inputSchema: z.object({
        name: z.string().min(2).max(24).describe("Short distinctive name, e.g. 'Researcher', 'Scout', 'Coder'"),
        color: z.enum(AGENT_COLORS.map((c) => c.id) as [string, ...string[]]).optional(),
        shape: z.enum(SHAPE_IDS).optional().describe("Body shape of its face"),
        model: z
          .enum(["lightning", "thinking"])
          .describe(
            "'lightning' (fast) for lookups, searching and reading, collecting facts, simple scripts and data handling. 'thinking' (slower, deeper) for hard reasoning, planning, comparing trade-offs, tricky code, math, or reading images.",
          ),
        task: z.string().min(10).max(6000).describe("Complete, self-contained instructions and the expected output"),
      }),
      execute: async ({ name, color, shape, model, task }, { toolCallId }) => {
        const wanted = `opal:${model}`;
        const modelId = isAllowedModel(wanted) ? wanted : isAllowedModel("opal:lightning") ? "opal:lightning" : null;
        let target = await findAgent(ctx, name);
        if (!target) {
          const seed = [...name].reduce((n, c) => n + c.charCodeAt(0), 0);
          const [inserted] = await db
            .insert(agentTable)
            .values({
              id: nanoid(),
              userId: ctx.userId,
              name,
              color: AGENT_COLORS.find((c) => c.id === color)?.value ?? AGENT_COLORS[seed % AGENT_COLORS.length].value,
              shape: shape ?? SHAPE_IDS[seed % SHAPE_IDS.length],
              role: "helper",
              capabilities: [],
              model: modelId,
              ephemeral: true,
              conversationId: ctx.conversationId,
            })
            .onConflictDoNothing()
            .returning();
          target = inserted ?? (await findAgent(ctx, name));
        } else if (target.ephemeral && modelId && target.model !== modelId) {
          // A helper from earlier in this chat keeps the model it was last given.
          await db.update(agentTable).set({ model: modelId }).where(eq(agentTable.id, target.id));
        }
        if (!target) return { ok: false, error: `Couldn't create ${name}` };
        const blocked = unreachable(ctx, target);
        if (blocked) return { ok: false, agent: publicAgent(target), error: blocked };
        // A saved agent keeps its own setting; the choice applies to this run only.
        const runner = modelId ? { ...target, model: modelId } : target;
        const r = await ctx.bus.run(target.id, () => runAgent(ctx, runner, task, { toolCallId }));
        return runOutput(target, r);
      },
    }),
  };
}

function studyHelperTool(ctx: RunContext): ToolSet {
  return {
    study_helper: tool({
      description:
        "Ask the Opal Study AI. It finds and reads Greek school textbooks (ebooks.edu.gr) and the user's eClass material, and can create quizzes, flashcards and handwritten notes in the chat.",
      inputSchema: z.object({ request: z.string().min(5).max(4000) }),
      execute: async ({ request }, { toolCallId }) => {
        const scoped = and(eq(agentTable.userId, ctx.userId), eq(agentTable.conversationId, ctx.conversationId), eq(agentTable.name, STUDY_AI.name));
        let [row] = await db.select().from(agentTable).where(scoped).limit(1);
        if (!row) {
          await db
            .insert(agentTable)
            .values({
              id: nanoid(),
              userId: ctx.userId,
              name: STUDY_AI.name,
              color: STUDY_AI.color,
              shape: STUDY_AI.shape,
              role: "helper",
              ephemeral: true,
              conversationId: ctx.conversationId,
            })
            .onConflictDoNothing();
          [row] = await db.select().from(agentTable).where(scoped).limit(1);
        }
        if (!row) return { ok: false, error: "Study AI is unavailable" };
        const target = row;
        const r = await ctx.bus.run(target.id, () => runAgent(ctx, target, request, { toolCallId, extra: STUDY_AI.extra }));
        return runOutput(target, r);
      },
    }),
  };
}
