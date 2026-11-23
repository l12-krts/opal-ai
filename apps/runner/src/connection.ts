// Talks to Opal: a long-lived SSE stream for commands, batched POSTs for events, POST replies.
import type { Config } from "./config.js";
import type { Command, RunnerEvent } from "./protocol.js";

export class Connection {
  private queue: RunnerEvent[] = [];
  private flushing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private cfg: Config,
    private onCommand: (c: Command) => void,
    private onConnected: () => void,
  ) {}

  private headers(json = true): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.token}`, ...(json ? { "Content-Type": "application/json" } : {}) };
  }

  url(path: string) {
    return new URL(path, this.cfg.serverUrl).toString();
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.url(path), { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  }

  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(this.url(path), { headers: this.headers(false) });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  }

  /** Queues an event; events go out in batches every 120 ms. */
  emit(e: RunnerEvent) {
    // Collapse repeated updates of the same item/terminal in one batch.
    if (e.type === "item") {
      const i = this.queue.findIndex((q) => q.type === "item" && q.threadId === e.threadId && q.id === e.id);
      if (i >= 0) {
        this.queue[i] = e;
        return this.schedule();
      }
    }
    this.queue.push(e);
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 120);
  }

  private async flush() {
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    const batch = this.queue.splice(0, 400);
    try {
      await this.post("/api/code/runner/events", { events: batch });
    } catch (e) {
      // Put them back and retry shortly (server restarting, network blip).
      this.queue.unshift(...batch);
      console.error("[runner] event upload failed:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      this.flushing = false;
      if (this.queue.length) this.schedule();
    }
  }

  async reply(id: string, ok: boolean, result?: unknown, error?: string) {
    await this.post("/api/code/runner/reply", { id, ok, result, error }).catch((e) => console.error("[runner] reply failed:", (e as Error).message));
  }

  stop() {
    this.stopped = true;
  }

  /** Connects and reconnects forever with backoff. */
  async run() {
    let delay = 1000;
    while (!this.stopped) {
      try {
        const res = await fetch(this.url("/api/code/runner/connect"), { headers: { ...this.headers(false), Accept: "text/event-stream" } });
        if (res.status === 401) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          console.error(`[runner] ${body.message ?? "Unauthorized"}. Pair this machine again: ${process.env.OPAL_RUNNER_CMD ? `${process.env.OPAL_RUNNER_CMD} pair` : "npm run pair --"} <opal-url> <code>`);
          process.exit(1);
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        console.log(`[runner] connected to ${this.cfg.serverUrl} as "${this.cfg.name}"`);
        delay = 1000;
        this.onConnected();
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = chunk
              .split("\n")
              .filter((l) => l.startsWith("data: "))
              .map((l) => l.slice(6))
              .join("\n");
            if (!data) continue;
            try {
              const msg = JSON.parse(data) as Command & { type?: string };
              if (msg.cmd) this.onCommand(msg);
            } catch {}
          }
        }
        console.log("[runner] disconnected, reconnecting…");
      } catch (e) {
        console.error(`[runner] connection error: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  }
}
