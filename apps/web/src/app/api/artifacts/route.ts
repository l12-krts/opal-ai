import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { artifact } from "@/server/db/schema";
import { api } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";

export const GET = api(
  async ({ req, user }) => {
    const kinds = (req.nextUrl.searchParams.get("kinds") ?? "quiz,flashcards,handwriting")
      .split(",")
      .filter((k): k is "quiz" | "flashcards" | "handwriting" | "ui" => ["quiz", "flashcards", "handwriting", "ui"].includes(k));
    const rows = await db
      .select({ id: artifact.id, kind: artifact.kind, title: artifact.title, createdAt: artifact.createdAt, conversationId: artifact.conversationId })
      .from(artifact)
      .where(and(eq(artifact.userId, user.id), inArray(artifact.kind, kinds.length ? kinds : ["quiz"])))
      .orderBy(desc(artifact.createdAt))
      .limit(60);
    return { artifacts: rows };
  },
  { limit: LIMITS.read },
);
