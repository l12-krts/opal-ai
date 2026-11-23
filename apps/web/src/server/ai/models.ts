// Model registry. A model is addressed as "provider:model-id".
// NVIDIA NIM is the default; OpenAI and Anthropic work when their keys are set; Ollama and
// LM Studio are wired in through their OpenAI-compatible endpoints for later.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { env } from "../env";
import { textToolCallMiddleware } from "./text-tool-calls";

/** Open models sometimes write tool calls as text; this turns those back into real calls. */
const withTextToolCalls = (model: Parameters<typeof wrapLanguageModel>[0]["model"]) =>
  wrapLanguageModel({ model, middleware: textToolCallMiddleware });

export type ProviderId = "nvidia" | "openai" | "anthropic" | "ollama" | "lmstudio";

export type ModelInfo = {
  id: string;
  label: string;
  provider: ProviderId | "opal";
  providerLabel: string;
  reasoning?: boolean;
  vision?: boolean;
  /** One of Opal's own named models, shown to everyone. Raw models only show in nerd mode. */
  tier?: boolean;
  description?: string;
};

const CATALOG: ModelInfo[] = [
  { id: "nvidia:nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra", provider: "nvidia", providerLabel: "NVIDIA NIM", reasoning: true },
  { id: "nvidia:moonshotai/kimi-k3.1-pro", label: "Kimi K3.1 Pro", provider: "nvidia", providerLabel: "NVIDIA NIM", reasoning: true },
  { id: "nvidia:mistralai/mistral-large-4-1t-a52b", label: "Mistral Large 4", provider: "nvidia", providerLabel: "NVIDIA NIM", reasoning: true, vision: true },
  { id: "nvidia:z-ai/glm-5.3-flash", label: "GLM 5.3 Flash", provider: "nvidia", providerLabel: "NVIDIA NIM" },
  { id: "nvidia:minimaxai/minimax-m3.1-flash", label: "MiniMax M3.1 Flash", provider: "nvidia", providerLabel: "NVIDIA NIM", reasoning: true, vision: true },
  { id: "nvidia:stepfun-ai/step-5-preview", label: "Step 5 Preview", provider: "nvidia", providerLabel: "NVIDIA NIM", reasoning: true },
  { id: "nvidia:nvidia/nemotron-3.5-lightning-30b-a3b", label: "Nemotron 3.5 Lightning", provider: "nvidia", providerLabel: "NVIDIA NIM" },
  { id: "anthropic:claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", providerLabel: "Anthropic", reasoning: true, vision: true },
  { id: "anthropic:claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", providerLabel: "Anthropic", reasoning: true, vision: true },
  { id: "anthropic:claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", providerLabel: "Anthropic", vision: true },
];

function providerReady(p: ProviderId): boolean {
  const e = env();
  switch (p) {
    case "nvidia":
      return Boolean(e.NVIDIA_API_KEY);
    case "openai":
      return Boolean(e.OPENAI_API_KEY);
    case "anthropic":
      return Boolean(e.ANTHROPIC_API_KEY);
    case "ollama":
    case "lmstudio":
      return false; // enabled later
  }
}

// Opal's named models. Each points at a real model, swappable through the environment without
// changing what users see or what is stored in their settings.
export const AUTO_MODEL = "opal:auto";

const TIERS = [
  // Auto is resolved per message in chat.ts (pickAutoTier): Lightning unless the message is
  // complex or has images. Anywhere it isn't resolved, it behaves like Lightning.
  { id: AUTO_MODEL, label: "Auto", description: "Chooses the best for your task", target: () => env().OPAL_MODEL_LIGHTNING },
  { id: "opal:lightning", label: "Opal Lightning", description: "Quick answers", target: () => env().OPAL_MODEL_LIGHTNING },
  { id: "opal:thinking", label: "Opal Thinking", description: "Thinks longer for harder work", target: () => env().OPAL_MODEL_THINKING },
] as const;

/** The real "provider:model" behind a spec (Opal tiers resolve to their target). */
export function resolveModel(spec: string): string {
  return TIERS.find((t) => t.id === spec)?.target() ?? spec;
}

function catalogEntry(spec: string): ModelInfo | undefined {
  return CATALOG.find((m) => m.id === spec);
}

export function availableModels(): ModelInfo[] {
  const tiers: ModelInfo[] = [];
  for (const t of TIERS) {
    const real = t.target();
    if (!providerReady(real.split(":")[0] as ProviderId)) continue;
    // Auto can see whenever Thinking can, since images switch it to Thinking.
    const base = t.id === AUTO_MODEL ? catalogEntry(env().OPAL_MODEL_THINKING) : catalogEntry(real);
    tiers.push({
      id: t.id,
      label: t.label,
      description: t.description,
      provider: "opal",
      providerLabel: "Opal",
      tier: true,
      reasoning: base?.reasoning,
      vision: base?.vision,
    });
  }
  const list = [...tiers, ...CATALOG.filter((m) => providerReady(m.provider as ProviderId))];
  const e = env();
  for (const id of [e.OPAL_MODEL_MAIN, e.OPAL_MODEL_FAST]) {
    if (!list.some((m) => m.id === id)) {
      const [provider, ...rest] = id.split(":");
      if (providerReady(provider as ProviderId)) {
        list.push({ id, label: rest.join(":"), provider: provider as ProviderId, providerLabel: provider });
      }
    }
  }
  return list;
}

/** The model to use when a message has images: the chosen one if it can see, else the first that can. */
export function visionModelFor(spec: string): string | null {
  const list = availableModels();
  if (list.find((m) => m.id === spec)?.vision) return spec;
  return list.find((m) => m.vision)?.id ?? null;
}

export function isAllowedModel(id: string): boolean {
  return availableModels().some((m) => m.id === id);
}

const cache = new Map<string, LanguageModel>();

export function getModel(requested: string): LanguageModel {
  const spec = resolveModel(requested);
  const hit = cache.get(spec);
  if (hit) return hit;
  const idx = spec.indexOf(":");
  if (idx < 0) throw new Error(`Bad model spec "${spec}"`);
  const provider = spec.slice(0, idx) as ProviderId;
  const modelId = spec.slice(idx + 1);
  const e = env();
  let model: LanguageModel;
  switch (provider) {
    case "nvidia":
      if (!e.NVIDIA_API_KEY) throw new ModelUnavailableError("NVIDIA_API_KEY is not set");
      model = withTextToolCalls(
        createOpenAICompatible({
          name: "nvidia",
          baseURL: "https://integrate.api.nvidia.com/v1",
          apiKey: e.NVIDIA_API_KEY,
          includeUsage: true,
        }).chatModel(modelId),
      );
      break;
    case "openai":
      if (!e.OPENAI_API_KEY) throw new ModelUnavailableError("OPENAI_API_KEY is not set");
      model = createOpenAI({ apiKey: e.OPENAI_API_KEY })(modelId);
      break;
    case "anthropic":
      if (!e.ANTHROPIC_API_KEY) throw new ModelUnavailableError("ANTHROPIC_API_KEY is not set");
      model = createAnthropic({ apiKey: e.ANTHROPIC_API_KEY })(modelId);
      break;
    case "ollama":
      model = withTextToolCalls(createOpenAICompatible({ name: "ollama", baseURL: e.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1" }).chatModel(modelId));
      break;
    case "lmstudio":
      model = withTextToolCalls(createOpenAICompatible({ name: "lmstudio", baseURL: e.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1" }).chatModel(modelId));
      break;
    default:
      throw new Error(`Unknown provider "${provider}"`);
  }
  cache.set(spec, model);
  return model;
}

export class ModelUnavailableError extends Error {}

export const mainModelId = () => env().OPAL_MODEL_MAIN;
export const fastModelId = () => env().OPAL_MODEL_FAST;

export function modelLabel(id: string): string {
  return TIERS.find((t) => t.id === id)?.label ?? CATALOG.find((m) => m.id === id)?.label ?? id.split(":").slice(1).join(":");
}

/** Provider options that turn on extended reasoning where the provider supports it. */
export function reasoningOptions(requested: string, verbose: boolean) {
  // Lightning is about speed: ask the model to skip thinking where it can.
  if (requested === "opal:lightning" || requested === AUTO_MODEL) return noThinking(resolveModel(requested));
  const spec = resolveModel(requested);
  const provider = spec.split(":")[0];
  if (provider === "anthropic") {
    return { anthropic: { thinking: { type: "adaptive", display: verbose ? "summarized" : "summarized" }, effort: verbose ? "high" : "medium" } };
  }
  if (provider === "openai") {
    return { openai: { reasoningEffort: verbose ? "high" : "medium", reasoningSummary: "auto" } };
  }
  return undefined;
}

/** For quick utility calls (routing, titles): turn off thinking on models that think by default. */
export function noThinking(requested: string) {
  const spec = resolveModel(requested);
  if (spec.startsWith("nvidia:")) return { nvidia: { chat_template_kwargs: { enable_thinking: false } } };
  if (spec.startsWith("anthropic:")) return { anthropic: { effort: "low" } };
  return undefined;
}
