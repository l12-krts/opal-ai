// Opal connectors: any app through Composio. Composio holds the OAuth tokens for each user's
// connected apps; Opal only keeps the user id mapping (our user id = Composio user id).
import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import type { ToolSet } from "ai";
import { env } from "../env";

type Session = Awaited<ReturnType<Composio<VercelProvider>["create"]>>;

const g = globalThis as unknown as {
  __composio?: Composio<VercelProvider>;
  __composioSessions?: Map<string, { session: Session; at: number }>;
};

export class ConnectorsUnavailableError extends Error {}

export function composioEnabled() {
  return Boolean(env().COMPOSIO_API_KEY);
}

function client(): Composio<VercelProvider> {
  if (!composioEnabled()) throw new ConnectorsUnavailableError("COMPOSIO_API_KEY is not set");
  g.__composio ??= new Composio({ apiKey: env().COMPOSIO_API_KEY!, provider: new VercelProvider() });
  return g.__composio;
}

const SESSION_TTL = 30 * 60_000;

async function session(userId: string): Promise<Session> {
  const sessions = (g.__composioSessions ??= new Map());
  const hit = sessions.get(userId);
  if (hit && Date.now() - hit.at < SESSION_TTL) return hit.session;
  const s = await client().create(userId, {
    manageConnections: { callbackUrl: `${env().BETTER_AUTH_URL}/customization/connectors?connected=1` },
  } as never);
  sessions.set(userId, { session: s, at: Date.now() });
  return s;
}

export type ToolkitView = {
  slug: string;
  name: string;
  logo?: string;
  connected: boolean;
  connectedAccountId?: string;
  noAuth: boolean;
};

export async function listToolkits(userId: string, opts: { search?: string; connectedOnly?: boolean } = {}): Promise<ToolkitView[]> {
  const s = await session(userId);
  const res = await s.toolkits({ limit: 50, search: opts.search || undefined, isConnected: opts.connectedOnly || undefined });
  const items = (res as unknown as { items: Array<Record<string, any>> }).items ?? [];
  return items.map((t) => ({
    slug: String(t.slug),
    name: String(t.name),
    logo: typeof t.logo === "string" && t.logo.startsWith("https://") ? t.logo : undefined,
    connected: Boolean(t.connection?.isActive),
    connectedAccountId: t.connection?.connectedAccount?.id,
    noAuth: Boolean(t.isNoAuth),
  }));
}

export async function connectToolkit(userId: string, toolkit: string) {
  if (!/^[a-z0-9_-]{2,60}$/i.test(toolkit)) throw new Error("Invalid toolkit");
  const s = await session(userId);
  const req = await s.authorize(toolkit, { callbackUrl: `${env().BETTER_AUTH_URL}/customization/connectors?connected=${encodeURIComponent(toolkit)}` });
  const url = (req as unknown as { redirectUrl?: string }).redirectUrl;
  if (!url || !url.startsWith("https://")) throw new Error("Composio did not return a sign-in link");
  return { redirectUrl: url };
}

export async function disconnectAccount(userId: string, connectedAccountId: string) {
  // Only delete accounts that belong to this user.
  const mine = await listToolkits(userId, { connectedOnly: true });
  if (!mine.some((t) => t.connectedAccountId === connectedAccountId)) throw new Error("Not your connection");
  await client().connectedAccounts.delete(connectedAccountId);
  g.__composioSessions?.delete(userId);
}

/** Meta tools (search tools, manage connections, execute) for the chat model. */
export async function connectorTools(userId: string): Promise<ToolSet> {
  if (!composioEnabled()) return {};
  try {
    const s = await session(userId);
    const tools = (await s.tools()) as unknown as ToolSet;
    // Agents have their own computer for code and data work; Composio's remote sandbox would
    // run it on Composio's servers instead.
    for (const name of Object.keys(tools)) if (REMOTE_SANDBOX.test(name)) delete tools[name];
    return tools;
  } catch (err) {
    console.error("[composio] tools unavailable", err);
    return {};
  }
}

const REMOTE_SANDBOX = /REMOTE_(WORKBENCH|BASH)/i;
// Composio's own web search toolkit (COMPOSIO_SEARCH_*), run through the execute meta tool.
const WEB_SEARCH = /^COMPOSIO_SEARCH_/i;

/** Why a Composio call is refused outright (built-in tools do the job), or null. */
export function composioBlocked(toolName: string, input: unknown): string | null {
  const name = toolName.toUpperCase();
  if (!name.startsWith("COMPOSIO_")) return null;
  if (REMOTE_SANDBOX.test(name)) return "Use your own computer (terminal tool) to run code and process data.";
  if (name.includes("SEARCH_TOOLS") || name.includes("MANAGE_CONNECTIONS") || name.includes("GET_TOOL_SCHEMAS")) return null;
  const slugs = slugsInComposioCall(toolName, input).map((s) => s.toUpperCase());
  if (slugs.some((s) => REMOTE_SANDBOX.test(s))) return "Use your own computer (terminal tool) to run code and process data.";
  if (slugs.some((s) => WEB_SEARCH.test(s))) return "Use web_search and read_webpage (or your browser) for the web. Connected apps are only for the user's own accounts.";
  return null;
}

// Tool slugs that only read data. Everything else that changes something in another app
// (send, create, update, delete, post, invite…) needs the user's approval first.
const READ_ONLY = /(^|_)(GET|LIST|SEARCH|FETCH|FIND|READ|RETRIEVE|DESCRIBE|QUERY|LOOKUP|CHECK|COUNT|VIEW|DOWNLOAD|EXPORT)(_|$)/;

export function slugsInComposioCall(toolName: string, input: unknown): string[] {
  const i = (input ?? {}) as Record<string, any>;
  if (Array.isArray(i.tools)) return i.tools.map((t: any) => String(t?.tool_slug ?? t?.slug ?? t?.tool ?? "")).filter(Boolean);
  if (typeof i.tool_slug === "string") return [i.tool_slug];
  return [toolName];
}

export function composioNeedsApproval(toolName: string, input: unknown): boolean {
  const name = toolName.toUpperCase();
  if (!name.startsWith("COMPOSIO_")) return false;
  if (name.includes("SEARCH_TOOLS") || name.includes("MANAGE_CONNECTIONS") || name.includes("GET_TOOL_SCHEMAS")) return false;
  if (name.includes("REMOTE_WORKBENCH") || name.includes("REMOTE_BASH")) return true;
  const slugs = slugsInComposioCall(toolName, input);
  return slugs.some((s) => !READ_ONLY.test(s.toUpperCase()));
}
