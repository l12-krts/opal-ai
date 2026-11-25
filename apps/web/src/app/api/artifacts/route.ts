import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { artifact } from "@/server/db/schema";
import { api } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";

const KINDS = ["quiz", "flashcards", "handwriting", "ui", "doc", "slides", "sheet", "chart", "whiteboard"] as const;
type Kind = (typeof KINDS)[number];

/**
 * The user's saved artifacts, most recently changed first. `kinds` picks which (default: practice
 * and handwriting); `data=1` includes each one's content, for the Documents page's previews.
 */
export const GET = api(
  async ({ req, user }) => {
    const params = req.nextUrl.searchParams;
    const kinds = (params.get("kinds") ?? "quiz,flashcards,handwriting").split(",").filter((k): k is Kind => (KINDS as readonly string[]).includes(k));
    const withData = params.get("data") === "1";
    const rows = await db
      .select({
        id: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
        conversationId: artifact.conversationId,
        ...(withData ? { data: artifact.data } : {}),
      })
      .from(artifact)
      .where(and(eq(artifact.userId, user.id), inArray(artifact.kind, kinds.length ? kinds : ["quiz"])))
      .orderBy(desc(artifact.updatedAt))
      .limit(withData ? 40 : 60);
    return { artifacts: rows };
  },
  { limit: LIMITS.read },
);
