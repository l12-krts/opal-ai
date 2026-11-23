// The "opal-code" MCP server agents connect to (Streamable HTTP, JSON responses, stateless).
// It listens on 127.0.0.1 only, gives each thread its own bearer token, and relays tool calls to
// Opal, which runs them (list/read/message/delegate other threads).
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Connection } from "./connection.js";

type Tool = { name: string; description: string; inputSchema: unknown };

export class McpServer {
  private tokens = new Map<string, string>(); // token → threadId
  private byThread = new Map<string, string>();
  private tools: Tool[] | null = null;
  port = 0;

  constructor(private conn: Connection) {}

  async start() {
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.port = (server.address() as AddressInfo).port;
  }

  get url() {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  tokenFor(threadId: string) {
    let t = this.byThread.get(threadId);
    if (!t) {
      t = randomBytes(24).toString("base64url");
      this.byThread.set(threadId, t);
      this.tokens.set(t, threadId);
    }
    return t;
  }

  private async listTools(): Promise<Tool[]> {
    if (!this.tools) this.tools = (await this.conn.get<{ tools: Tool[] }>("/api/code/runner/tool")).tools;
    return this.tools;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, body === undefined ? {} : { "Content-Type": "application/json" });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (!req.url?.startsWith("/mcp")) return send(404);
    if (req.method !== "POST") return send(405);
    const auth = req.headers.authorization ?? "";
    const threadId = this.tokens.get(auth.replace(/^Bearer\s+/i, ""));
    if (!threadId) return send(401, { error: "unauthorized" });

    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1_000_000) return send(413);
    }
    let msg: { id?: string | number; method?: string; params?: Record<string, unknown> } | unknown[];
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map((m) => this.dispatch(threadId, m as never)))).filter(Boolean);
      return out.length ? send(200, out) : send(202);
    }
    const out = await this.dispatch(threadId, msg as never);
    return out ? send(200, out) : send(202);
  }

  private async dispatch(threadId: string, m: { id?: string | number; method?: string; params?: Record<string, unknown> }) {
    if (m.id === undefined || m.id === null) return null; // notification
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id, error: { code, message } });
    try {
      switch (m.method) {
        case "initialize":
          return ok({
            protocolVersion: String(m.params?.protocolVersion ?? "2025-06-18"),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "opal-code", version: "0.1.0" },
            instructions: "Tools to see and coordinate the user's other Opal Code threads and agents.",
          });
        case "ping":
          return ok({});
        case "tools/list":
          return ok({ tools: await this.listTools() });
        case "tools/call": {
          const name = String(m.params?.name ?? "");
          const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
          const r = await this.conn.post<{ text: string; isError?: boolean }>("/api/code/runner/tool", { threadId, name, args });
          return ok({ content: [{ type: "text", text: r.text }], isError: Boolean(r.isError) });
        }
        default:
          return fail(-32601, `Method not found: ${m.method}`);
      }
    } catch (e) {
      return fail(-32000, (e as Error).message);
    }
  }
}
