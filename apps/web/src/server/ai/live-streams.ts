// Replies keep running when the user leaves the chat. Each one gets its own abort controller
// (not the request's signal, which fires when the tab navigates away), and a copy of its SSE
// stream is buffered here so a returning client can reconnect and replay it from the start.
// In memory: this is a single-process server. A reply that outlives a restart is lost, as
// before, and the saved partial message is what the user sees.

type Live = {
  userId: string;
  controller: AbortController;
  chunks: string[];
  done: boolean;
  listeners: Set<() => void>;
};

const g = globalThis as unknown as { __opalLiveStreams?: Map<string, Live> };
// Survives dev hot reloads, so a reply started before an edit can still be reconnected to.
const live = (g.__opalLiveStreams ??= new Map<string, Live>());

/** How long a finished reply stays replayable, covering a client that loaded the chat just before it finished. */
const KEEP_DONE_MS = 15_000;

/** Start tracking a reply. Aborts any earlier reply still running in the same chat. */
export function startLive(conversationId: string, userId: string): AbortController {
  live.get(conversationId)?.controller.abort();
  const entry: Live = { userId, controller: new AbortController(), chunks: [], done: false, listeners: new Set() };
  live.set(conversationId, entry);
  return entry.controller;
}

/** Buffer the tee'd SSE copy. Reading it to the end also keeps the reply running after the client leaves. */
export async function recordLive(conversationId: string, controller: AbortController, stream: ReadableStream<string>) {
  const entry = live.get(conversationId);
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (entry?.controller === controller) {
        entry.chunks.push(value);
        for (const l of entry.listeners) l();
      }
    }
  } catch {
    // An aborted reply ends its stream with an error; the buffer is still complete up to there.
  } finally {
    if (entry && entry.controller === controller) {
      entry.done = true;
      for (const l of entry.listeners) l();
      setTimeout(() => {
        if (live.get(conversationId) === entry) live.delete(conversationId);
      }, KEEP_DONE_MS);
    }
  }
}

/** Stop the reply running in a chat. Returns false when there was none. */
export function stopLive(conversationId: string, userId: string): boolean {
  const entry = live.get(conversationId);
  if (!entry || entry.userId !== userId || entry.done) return false;
  entry.controller.abort();
  return true;
}

/** The reply as an SSE stream: everything so far, then the rest as it arrives. Null when none. */
export function replayLive(conversationId: string, userId: string): ReadableStream<string> | null {
  const entry = live.get(conversationId);
  if (!entry || entry.userId !== userId) return null;
  let sent = 0;
  let notify: (() => void) | null = null;
  return new ReadableStream<string>({
    start(controller) {
      const flush = () => {
        while (sent < entry.chunks.length) controller.enqueue(entry.chunks[sent++]);
        if (entry.done) {
          entry.listeners.delete(notify!);
          controller.close();
        }
      };
      notify = () => {
        try {
          flush();
        } catch {
          entry.listeners.delete(notify!);
        }
      };
      entry.listeners.add(notify);
      flush();
    },
    cancel() {
      if (notify) entry.listeners.delete(notify);
    },
  });
}
