// Server environment, validated once. Never import this from client components.
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 chars"),
  DATABASE_URL: z.string().min(1),

  OPAL_GATE_PASSWORD_HASH: z.string().startsWith("scrypt:", "Run npm run gate:hash"),
  OPAL_GATE_SECRET: z.string().min(32),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  OPAL_DEV_EMAIL_LOGIN: optional,
  OPAL_ADMIN_EMAILS: optional,

  OPAL_SECRETS_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "OPAL_SECRETS_KEY must be 32 bytes base64"),

  NVIDIA_API_KEY: optional,
  OPENAI_API_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  OLLAMA_BASE_URL: optional,
  LMSTUDIO_BASE_URL: optional,
  // Default chat model. "opal:auto" / "opal:lightning" / "opal:thinking" are Opal's named
  // models (Auto picks Lightning or Thinking per message); the two variables below choose the
  // real model behind Lightning and Thinking.
  OPAL_MODEL_MAIN: z.string().default("opal:auto"),
  OPAL_MODEL_LIGHTNING: z.string().default("nvidia:nvidia/nemotron-3-ultra-550b-a55b"),
  OPAL_MODEL_THINKING: z.string().default("nvidia:mistralai/mistral-large-4-1t-a52b"),
  OPAL_MODEL_FAST: z.string().default("nvidia:nvidia/nemotron-3.5-lightning-30b-a3b"),

  COMPOSIO_API_KEY: optional,

  // Web search: a SearXNG instance with JSON output (docker compose up -d search). Set it to
  // "off" to fall back to DuckDuckGo only.
  SEARXNG_URL: z.string().default("http://127.0.0.1:8888"),

  OPAL_SANDBOX_IMAGE: z.string().default("opal-sandbox:latest"),
  OPAL_SANDBOX_NETWORK: z.string().default("opal-sandbox-net"),
  DOCKER_HOST: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  // In development, re-read so edits to .env.local apply without a restart.
  if (cached && process.env.NODE_ENV === "production") return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${issues}\nSee apps/web/.env.example`);
  }
  cached = parsed.data;
  return cached;
}

export const isProd = () => env().NODE_ENV === "production";
export const devEmailLoginEnabled = () => !isProd() && env().OPAL_DEV_EMAIL_LOGIN === "true";
export const googleEnabled = () => Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
export const adminEmails = () =>
  new Set(
    (env().OPAL_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
