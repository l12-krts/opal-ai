import { tool } from "ai";
import { z } from "zod";
import { STUDY_SOURCES, sourceForRef } from "../../study/registry";
import type { RunContext } from "../context";

export function studyTools(ctx: RunContext) {
  return {
    study_search: tool({
      description:
        "Search study material. Sources: 'ebooks' = official Greek school textbooks (ebooks.edu.gr), 'eclass' = the user's university eClass courses. Returns references to read with study_read. Search in Greek for Greek books.",
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        source: z.enum(["ebooks", "eclass", "all"]).default("all"),
        grade: z
          .enum(["K01", "K02", "K03", "K04", "K05", "K06", "K07", "K08", "K09", "K10", "K11", "K12"])
          .optional()
          .describe("ebooks only. K01-K06 Δημοτικό, K07-K09 Γυμνάσιο, K10-K12 Λύκειο"),
      }),
      execute: async ({ query, source, grade }) => {
        const ids = source === "all" ? Object.keys(STUDY_SOURCES) : [source];
        const results = await Promise.allSettled(ids.map((id) => STUDY_SOURCES[id].search(ctx.userId, query, { grade })));
        const out: Array<Record<string, unknown>> = [];
        results.forEach((r, i) => {
          if (r.status === "fulfilled") out.push(...r.value.map((item) => ({ source: ids[i], ...item })));
          else out.push({ source: ids[i], error: (r.reason as Error).message });
        });
        return { results: out };
      },
    }),

    study_browse: tool({
      description:
        "Browse a study source. ebooks: no ref lists grades, ref 'grade:K10' lists that grade's books. eclass: no ref lists the user's courses, a course ref lists its documents and announcements.",
      inputSchema: z.object({ source: z.enum(["ebooks", "eclass"]), ref: z.string().max(500).optional() }),
      execute: async ({ source, ref }) => {
        try {
          return { items: (await STUDY_SOURCES[source].browse?.(ctx.userId, ref)) ?? [] };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    }),

    study_read: tool({
      description:
        "Read study material by reference (from study_search or study_browse). Returns up to 12,000 characters starting at offset, plus chapter references for HTML books. Call again with a larger offset to continue.",
      inputSchema: z.object({ ref: z.string().min(3).max(800), offset: z.number().int().min(0).optional() }),
      execute: async ({ ref, offset }) => {
        try {
          return await sourceForRef(ref).read(ctx.userId, ref, { offset });
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    }),
  };
}
