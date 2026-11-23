import { tool } from "ai";
import { and, desc, eq, ilike } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../../db";
import { artifact, handwritingProfile } from "../../db/schema";
import type { RunContext } from "../context";

export function handwritingTools(ctx: RunContext) {
  return {
    write_by_hand: tool({
      description:
        "Opal Handwriting: turn Markdown (headings, lists, bold, tables, and ```chart blocks) into realistic handwriting on paper, using the user's own handwriting profile. A chart block is JSON: {\"type\":\"bar\"|\"line\"|\"pie\",\"title\":\"...\",\"labels\":[...],\"values\":[...]}. Keep it to what fits on 1-4 pages.",
      inputSchema: z.object({
        title: z.string().max(120),
        markdown: z.string().min(1).max(20000),
        profile: z.string().max(80).optional().describe("Handwriting profile name; omit for the user's latest"),
        paper: z.enum(["lined", "grid", "blank"]).default("lined"),
        ink: z.enum(["blue", "black", "darkblue"]).default("blue"),
      }),
      execute: async ({ title, markdown, profile, paper, ink }) => {
        const where = profile
          ? and(eq(handwritingProfile.userId, ctx.userId), ilike(handwritingProfile.name, profile))
          : eq(handwritingProfile.userId, ctx.userId);
        const [p] = await db
          .select({ id: handwritingProfile.id, name: handwritingProfile.name, glyphCount: handwritingProfile.glyphCount })
          .from(handwritingProfile)
          .where(where)
          .orderBy(desc(handwritingProfile.updatedAt))
          .limit(1);
        const usable = p && p.glyphCount > 20 ? p : undefined;
        const id = nanoid();
        await db.insert(artifact).values({
          id,
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          kind: "handwriting",
          title,
          data: { markdown, profileId: usable?.id ?? null, paper, ink },
        });
        return {
          ok: true,
          artifactId: id,
          profile: usable?.name ?? null,
          note: usable ? undefined : "No handwriting profile yet, so a stand-in hand was used. The user can add theirs on the Handwriting page.",
        };
      },
    }),
  };
}
