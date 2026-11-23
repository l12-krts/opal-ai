// In-chat artifacts: generative UI (json-render), quizzes and flashcards. They are saved so they
// can be reopened from the study page later.
import { tool } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { catalog } from "@/lib/genui/catalog";
import { db } from "../../db";
import { artifact } from "../../db/schema";
import type { RunContext } from "../context";

async function save(ctx: RunContext, kind: "quiz" | "flashcards" | "ui", title: string, data: Record<string, unknown>) {
  const id = nanoid();
  await db.insert(artifact).values({ id, userId: ctx.userId, conversationId: ctx.conversationId, kind, title, data });
  return id;
}

const elementSchema = z.object({
  type: z.string(),
  props: z.record(z.string(), z.unknown()).optional(),
  children: z.array(z.string()).optional(),
});

export const QuizQuestion = z.object({
  question: z.string().max(600),
  options: z.array(z.string().max(300)).min(2).max(6),
  correctIndex: z.number().int().min(0),
  explanation: z.string().max(800).describe("Why the correct answer is right"),
  wrongExplanations: z
    .array(z.string().max(600))
    .describe("One entry per option, same order as options. For the correct option use an empty string. Explain the specific misconception behind each wrong choice."),
});

export const Flashcard = z.object({
  front: z.string().max(400),
  back: z.string().max(1200),
  hint: z.string().max(200).optional(),
});

const COMPONENTS = Object.keys((catalog as unknown as { data: { components: Record<string, unknown> } }).data?.components ?? {});

export function artifactTools(ctx: RunContext) {
  return {
    render_ui: tool({
      description: `Show an interactive answer (dashboard, comparison, checklist, chart, table, summary card) instead of plain text when structure helps. The spec is a flat map of elements: { "root": "id", "elements": { "id": { "type": "Card", "props": {...}, "children": ["id2"] } } }. Allowed types: ${COMPONENTS.join(", ") || "Stack, Grid, Card, Heading, Text, Metric, Badge, KeyValue, List, Table, BarChart, Progress, Steps, Callout, Image, Link, Button, Separator"}. Nullable props may be omitted. A Button sends its 'prompt' back as the user's next message.`,
      inputSchema: z.object({
        title: z.string().max(120),
        spec: z.object({ root: z.string(), elements: z.record(z.string(), elementSchema) }),
      }),
      execute: async ({ title, spec }) => {
        if (!spec.elements[spec.root]) return { ok: false, error: "root element missing from elements" };
        const unknown = Object.values(spec.elements)
          .map((e) => e.type)
          .filter((t) => COMPONENTS.length && !COMPONENTS.includes(t));
        if (unknown.length) return { ok: false, error: `Unknown component types: ${[...new Set(unknown)].join(", ")}` };
        const id = await save(ctx, "ui", title, { spec });
        return { ok: true, artifactId: id };
      },
    }),

    create_quiz: tool({
      description:
        "Create an interactive multiple-choice quiz in the chat. Write every explanation in advance: when the user picks a wrong option they immediately see the explanation for that specific option. Use the user's language.",
      inputSchema: z.object({
        title: z.string().max(120),
        topic: z.string().max(200).optional(),
        questions: z.array(QuizQuestion).min(1).max(30),
      }),
      execute: async ({ title, topic, questions }) => {
        const fixed = questions.map((q) => ({
          ...q,
          correctIndex: Math.min(q.correctIndex, q.options.length - 1),
          wrongExplanations: q.options.map((_, i) => q.wrongExplanations[i] ?? ""),
        }));
        const id = await save(ctx, "quiz", title, { topic, questions: fixed });
        return { ok: true, artifactId: id, count: fixed.length };
      },
    }),

    create_flashcards: tool({
      description: "Create a flashcard deck in the chat for spaced practice. Use the user's language.",
      inputSchema: z.object({
        title: z.string().max(120),
        cards: z.array(Flashcard).min(1).max(80),
      }),
      execute: async ({ title, cards }) => {
        const id = await save(ctx, "flashcards", title, { cards });
        return { ok: true, artifactId: id, count: cards.length };
      },
    }),
  };
}
