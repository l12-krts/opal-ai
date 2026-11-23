// MCP tool calls from agents, relayed by the runner's local MCP server.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { codeThread } from "@/server/db/schema";
import { ApiError, readJson } from "@/server/http";
import { AGENT_TOOLS, runAgentTool } from "@/server/code/tools";
import { runnerRoute } from "@/server/code/runner-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 1900;

/** The tool list, so the runner's MCP server always matches this server. */
export const GET = runnerRoute(async () => ({ tools: AGENT_TOOLS }));

export const POST = runnerRoute(async (req, machine) => {
  const body = await readJson(
    req,
    z.object({ threadId: z.string().max(64), name: z.string().max(60), args: z.record(z.string(), z.unknown()).default({}) }),
    256 * 1024,
  );
  const [self] = await db.select().from(codeThread).where(and(eq(codeThread.id, body.threadId), eq(codeThread.machineId, machine.id))).limit(1);
  if (!self) throw new ApiError(404, "not_found", "Thread not found");
  try {
    return { text: await runAgentTool(self, body.name, body.args) };
  } catch (e) {
    return { text: (e as Error).message, isError: true };
  }
}, 600);
