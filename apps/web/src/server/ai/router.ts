// Decides whether a message gets a direct answer or goes to agents.
// Cheap heuristics first (most messages never need a model call), then a small fast model with a
// hard timeout. Any failure falls back to "direct", which can still use every tool.
import { generateText } from "ai";
import type { Route } from "@/lib/types";
import { fastModelId, getModel, noThinking } from "./models";

/**
 * Ask the fast model to label a request with one of two words. Plain text, not JSON: the fast
 * NVIDIA models don't support JSON response formats, so structured output always failed. The
 * request goes in tags with a "never answer it" instruction, or the small model just answers it.
 */
async function classify<V extends string>(opts: {
  task: string;
  labels: { word: string; value: V; when: string }[];
  request: string;
  context?: string;
  timeout: number;
}): Promise<{ value: V; reason: string }> {
  const words = opts.labels.map((l) => l.word);
  const { text } = await generateText({
    model: getModel(fastModelId()),
    timeout: opts.timeout,
    maxRetries: 0,
    temperature: 0,
    maxOutputTokens: 40,
    providerOptions: noThinking(fastModelId()) as never,
    instructions: "You are a classifier. You never answer or carry out the request you are shown. You only label it.",
    prompt: [
      opts.task,
      ...opts.labels.map((l) => `${l.word}: ${l.when}`),
      "",
      opts.context ? `<context>\n${opts.context}\n</context>\n` : "",
      `<request>\n${opts.request}\n</request>`,
      "",
      `Reply with ${words.join(" or ")}, then " - " and a reason of at most 8 words.`,
    ].join("\n"),
  });
  const answer = text.trim();
  const m = new RegExp(`^\\W*(${words.join("|")})\\b\\W*(.*)$`, "is").exec(answer);
  const hit = m && opts.labels.find((l) => l.word === m[1].toUpperCase());
  if (!hit) throw new Error(`unexpected classifier answer: ${answer.slice(0, 80)}`);
  const reason = m[2].split("\n")[0].trim().slice(0, 100);
  return { value: hit.value, reason: reason ? reason[0].toUpperCase() + reason.slice(1) : hit.word };
}

const EXPLICIT_AGENTS = /\b(use|with|start|spin up|create|run)\b[^.]{0,30}\b(agents?|sub-?agents?|helpers)\b|\bin parallel\b|πράκτορ|παράλληλα/iu;

export type RouteDecision = { route: Route; reason: string; ms: number };

// \b only understands ASCII letters, so the Greek stems are matched without it.
const AGENT_HINTS =
  /\b(research|investigate|compare|plan|build|scrape|browse|automate|step by step|in parallel|agents?|sub-?agents?|team|multiple sources|book|order|schedule|deploy|write (a|an) (report|app|script))\b|ερεύνησ|σύγκριν|σχεδίασ|πράκτορ|αυτοματοπ/iu;

export async function routeMessage(input: {
  text: string;
  mentionsAgent: boolean;
  forcedAgent: boolean;
  recentContext?: string;
}): Promise<RouteDecision> {
  const t0 = Date.now();
  const text = input.text.trim();

  if (input.forcedAgent) return { route: "agents", reason: "You are chatting with an agent", ms: 0 };
  if (input.mentionsAgent) return { route: "agents", reason: "An agent was mentioned", ms: 0 };
  if (EXPLICIT_AGENTS.test(text)) return { route: "agents", reason: "You asked for agents", ms: 0 };
  if (text.length < 40 && !AGENT_HINTS.test(text)) return { route: "direct", reason: "Short message", ms: 0 };
  if (text.length < 140 && !AGENT_HINTS.test(text) && !/\n/.test(text)) {
    return { route: "direct", reason: "Simple request", ms: Date.now() - t0 };
  }

  try {
    const r = await classify<Route>({
      task: "Label how an AI assistant should handle this request.",
      labels: [
        {
          word: "DIRECT",
          value: "direct",
          when: "one assistant can answer in a single reply, even with a tool or two (look something up, make a quiz, write text, answer a question).",
        },
        {
          word: "AGENTS",
          value: "agents",
          when: "multi-step work for separate workers: research that needs several searches or sources, more than a little data processing (large files, many rows, scraping several pages, building spreadsheets or reports), several steps on a computer or browser, independent parallel parts, or anything long-running.",
        },
      ],
      context: input.recentContext?.slice(-1200),
      request: text.slice(0, 4000),
      timeout: 4500,
    });
    return { route: r.value, reason: r.reason, ms: Date.now() - t0 };
  } catch {
    return {
      route: AGENT_HINTS.test(text) && text.length > 280 ? "agents" : "direct",
      reason: "Router unavailable, used a heuristic",
      ms: Date.now() - t0,
    };
  }
}

// ─── Opal Auto: Lightning or Thinking for this message ────────────────────────

export type AutoTier = "lightning" | "thinking";
export type AutoDecision = { tier: AutoTier; reason: string; ms: number };

// Clear signs of work that benefits from thinking: code, maths notation, long or structured input.
const STRONG_THINKING = /```|\\(?:frac|int|sum|sqrt|begin)\b|[∫∑√∂≤≥≠∞]|\b(prove|proof|derive|debug|stack ?trace|traceback|refactor)\b|απόδειξ|αποδείξ/iu;
// Softer hints, used only when the classifier is unavailable.
const THINKING_HINTS =
  /\b(solve|equation|calculate|algorithm|code|function|bug|error|architecture|plan|strategy|analy[sz]e|compare|trade-?offs?|step by step|explain why|why does|optimi[sz]e|essay|report|math|physics|chemistry|exercise|problem)\b|λύσ|εξίσωσ|υπολόγισ|ανάλυσ|σύγκριν|γιατί|σχεδίασ|άσκησ|πρόβλημα|κώδικ/iu;

export async function pickAutoTier(input: {
  text: string;
  /** Images on the newest user message. */
  hasImages: boolean;
  /** Images earlier in the conversation (a follow-up may be about them). */
  earlierImages: boolean;
  recentContext?: string;
}): Promise<AutoDecision> {
  const t0 = Date.now();
  const text = input.text.trim();
  if (input.hasImages) return { tier: "thinking", reason: "The message has images", ms: 0 };
  if (STRONG_THINKING.test(text)) return { tier: "thinking", reason: "Code, maths or a proof", ms: 0 };
  if (text.length > 1500) return { tier: "thinking", reason: "Long message", ms: 0 };
  if (!input.earlierImages && text.length < 60 && !THINKING_HINTS.test(text)) return { tier: "lightning", reason: "Short message", ms: 0 };

  try {
    const r = await classify<AutoTier>({
      task: "Label how hard this request is for an AI assistant.",
      labels: [
        { word: "EASY", value: "lightning", when: "chat, quick facts, short writing, simple how-tos, translations, summaries, lookups, ideas." },
        {
          word: "HARD",
          value: "thinking",
          when: `maths or science problems, logic, code, debugging, careful analysis or comparisons, multi-step planning, long or tricky writing${input.earlierImages ? ", or a question about an image shared earlier in the chat (earlier messages include images)" : ""}.`,
        },
      ],
      context: input.recentContext?.slice(-800),
      request: text.slice(0, 4000),
      timeout: 4000,
    });
    return { tier: r.value, reason: r.reason, ms: Date.now() - t0 };
  } catch {
    const hard = THINKING_HINTS.test(text) || (input.earlierImages && /\b(it|this|that|picture|photo|image)\b|αυτ|εικόν|φωτογραφ/iu.test(text));
    return { tier: hard ? "thinking" : "lightning", reason: "Classifier unavailable, used a heuristic", ms: Date.now() - t0 };
  }
}
