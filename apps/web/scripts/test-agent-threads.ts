// End-to-end check of agent threads against the real database and model:
// Opal messages a throwaway agent, which replies; the exchange must land in the agent's thread,
// and the live relay must rebuild the same reply. The agent is deleted afterwards.
//   npx tsx scripts/test-agent-threads.ts
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

const { readUIMessageStream } = await import("ai");
const { eq } = await import("drizzle-orm");
const { nanoid } = await import("nanoid");
const { db } = await import("../src/server/db");
const { agent, conversation, user } = await import("../src/server/db/schema");
const { AgentBus } = await import("../src/server/ai/bus");
const { runAgent } = await import("../src/server/ai/agents");
const { deleteAgentDeep, loadAllMessages } = await import("../src/server/ai/threads");
const { mainModelId } = await import("../src/server/ai/models");

let failures = 0;
const check = (ok: boolean, label: string, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
};

const [u] = await db.select().from(user).limit(1);
if (!u) throw new Error("No user in the database");
const [chat] = await db.select().from(conversation).where(eq(conversation.userId, u.id)).limit(1);
if (!chat) throw new Error("No chat to run in");

const agentId = nanoid();
await db.insert(agent).values({ id: agentId, userId: u.id, name: `Test ${agentId.slice(0, 4)}`, color: "#3b82f6", shape: "ghost", role: "assistant" });

const written: any[] = [];
const writer = { write: (p: unknown) => written.push(p), merge: () => {}, onError: undefined } as never;
const ctx = {
  userId: u.id,
  userName: u.name,
  conversationId: chat.id,
  writer,
  signal: new AbortController().signal,
  nerd: false,
  mode: "chat" as const,
  modelId: mainModelId(),
  depth: 0,
  chain: [],
  sandboxAgentId: `opal-${u.id}`,
  sandboxAgentName: "Opal",
  sandboxColor: "#71717a",
  bus: new AgentBus(),
  secretValues: [],
};

try {
  const [row] = await db.select().from(agent).where(eq(agent.id, agentId));
  const t0 = Date.now();
  const r = await runAgent(ctx, row, "Reply with exactly the word: pong", { toolCallId: "call_test" });
  console.log(`run took ${((Date.now() - t0) / 1000).toFixed(1)}s, status ${r.status}, reply ${JSON.stringify(r.text.slice(0, 80))}`);
  check(r.status === "done", "run finished");
  check(/pong/i.test(r.text), "reply returned to the sender", r.text.slice(0, 40));

  const [thread] = await db.select().from(conversation).where(eq(conversation.agentId, agentId));
  check(Boolean(thread) && thread.id === r.threadId, "agent has one thread");
  const msgs = await loadAllMessages(r.threadId);
  const inbound = msgs.find((m) => m.id === `in_${r.runId}`);
  const reply = msgs.find((m) => m.id === `run_${r.runId}`);
  check(Boolean(inbound?.metadata?.from?.kind === "opal" && inbound.metadata.from.key === `opal:${chat.id}`), "inbound message saved with sender");
  check(Boolean(reply?.metadata?.run?.fromKey === `opal:${chat.id}`), "reply saved, tagged with the conversation");

  const views = written.filter((p) => p.type === "data-agent");
  check(views.length >= 2 && views[0].data.toolCallId === "call_test" && !views[0].transient, "run card linked to the tool call, kept in the message");
  check(views[views.length - 1].data.status === "done", "run card ends done");

  // Rebuild the reply from the relayed chunks, like the client does.
  const chunks = written.filter((p) => p.type === "data-agent-chunks").flatMap((p) => p.data.chunks);
  check(chunks.length > 0 && written.filter((p) => p.type === "data-agent-chunks").every((p) => p.transient), "live chunks relayed (transient)", `${chunks.length} chunks`);
  const stream = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
  let rebuilt: any;
  for await (const m of readUIMessageStream({ stream: stream as never })) rebuilt = m;
  const text = rebuilt?.parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("") ?? "";
  check(rebuilt?.id === `run_${r.runId}` && /pong/i.test(text), "client can rebuild the live reply", text.slice(0, 40));
} finally {
  await deleteAgentDeep(u.id, agentId);
  const left = await db.select().from(conversation).where(eq(conversation.agentId, agentId));
  check(left.length === 0, "deleting the agent deletes its thread");
}

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
