// Documents Opal and agents make in a chat: docs, slides, sheets, charts and whiteboards. Each
// is an artifact (kind = doc | slides | sheet | chart | whiteboard) that shows as a card in the
// chat, opens full screen, exports, and is edited in place with update_document (a new version,
// not a copy). Shapes and normalizing live in lib/documents.ts, shared with the viewers.
import { tool } from "ai";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  CHART_TYPES,
  COLUMN_TYPES,
  DOC_KINDS,
  SLIDE_LAYOUTS,
  SLIDE_THEMES,
  WB_COLORS,
  WB_TYPES,
  colIndex,
  colName,
  describeContent,
  evaluateSheet,
  isDocKind,
  normalizeCell,
  normalizeContent,
  normalizeSlide,
  normalizeWbItem,
  parseRef,
  type ChartData,
  type DocContent,
  type DocData,
  type DocKind,
  type SheetData,
  type SlidesData,
  type WbItem,
  type WhiteboardData,
} from "@/lib/documents";
import { db } from "../../db";
import { artifact } from "../../db/schema";
import type { RunContext } from "../context";

// ─── Input schemas ───────────────────────────────────────────────────────────

const SlideInput = z.object({
  layout: z
    .enum(SLIDE_LAYOUTS)
    .optional()
    .describe(
      "title: big title + subtitle (the opening slide). section: a divider between parts. content: title with bullets and/or body. image: title, an image and bullets beside it. quote: body is the quote, subtitle who said it. Picked from the content when left out.",
    ),
  title: z.string().max(300),
  subtitle: z.string().max(400).optional(),
  bullets: z.array(z.string().max(600)).max(12).optional().describe("3 to 6 short points, a line each"),
  body: z.string().max(4000).optional().describe("Markdown, for a slide that needs a paragraph or a small table"),
  image: z.string().max(2000).optional().describe("https URL of a real image (from a page you read). Never invent one."),
  imageAlt: z.string().max(300).optional(),
  notes: z.string().max(4000).optional().describe("Speaker notes: what to say on this slide"),
});

const CellInput = z.union([z.string().max(2000), z.number(), z.null()]);

const ColumnInput = z.object({
  name: z.string().max(120),
  type: z.enum(COLUMN_TYPES).optional().describe("How values show: number, currency, percent (fractions: 0.25 = 25%), date, or text (default)"),
});

const SeriesInput = z.object({ name: z.string().max(120), values: z.array(z.number().nullable()).max(200) });

const WbItemInput = z.object({
  id: z.string().max(60).optional().describe("Short unique id (n1, s2…); arrows refer to it"),
  type: z.enum(WB_TYPES).describe("note: sticky note. shape: rect/ellipse/diamond with text. text: free text. arrow: connects two items (from/to ids). stroke: a freehand line (points)."),
  x: z.number().optional().describe("Left edge. The board is open-ended; lay things out on a grid around 0,0 with room between them."),
  y: z.number().optional().describe("Top edge"),
  w: z.number().optional().describe("Width (note 180, shape 170 by default)"),
  h: z.number().optional().describe("Height (note 140, shape 90 by default)"),
  text: z.string().max(2000).optional(),
  color: z.enum(WB_COLORS).optional(),
  shape: z.enum(["rect", "ellipse", "diamond"]).optional(),
  size: z.number().optional().describe("Font size of a text item (default 20; 32+ for headings)"),
  from: z.string().max(60).optional().describe("Arrow: id of the item it starts at"),
  to: z.string().max(60).optional().describe("Arrow: id of the item it points to"),
  points: z.array(z.array(z.number())).max(2000).optional().describe("[[x,y],…]: a stroke's path, or a loose arrow's two ends"),
  dashed: z.boolean().optional(),
  width: z.number().optional().describe("Stroke width (default 3)"),
});

const ChartInput = {
  type: z.enum(CHART_TYPES),
  labels: z.array(z.string().max(120)).max(200).describe("Category or x-axis labels, one per value"),
  series: z.array(SeriesInput).min(1).max(12).describe("One or more series, each with one value per label. Pie and donut use the first series."),
  unit: z.string().max(16).optional().describe("Shown after values, e.g. %, €, kg"),
  stacked: z.boolean().optional().describe("Stack bar or area series"),
  horizontal: z.boolean().optional().describe("Horizontal bars (good for long labels)"),
  xLabel: z.string().max(80).optional(),
  yLabel: z.string().max(80).optional(),
  caption: z.string().max(400).optional().describe("Source or a one-line takeaway under the chart"),
};

const EDIT_OPS = [
  "replace_text",
  "append",
  "insert_slide",
  "update_slide",
  "delete_slide",
  "move_slide",
  "set_cells",
  "append_rows",
  "insert_rows",
  "delete_rows",
  "add_column",
  "delete_column",
  "add_items",
  "update_items",
  "remove_items",
  "set",
] as const;

const EditInput = z.object({
  op: z
    .enum(EDIT_OPS)
    .describe(
      [
        "doc: replace_text (find → replace; all for every match), append (markdown at the end).",
        "slides: insert_slide (slide, at index or the end), update_slide (index + the slide fields to change), delete_slide (index), move_slide (index → to).",
        "sheet: set_cells (cells: [{ref:'B3', value}]; row 1 is the header), append_rows (rows), insert_rows (rows before row number index), delete_rows (rowNumbers), add_column (column + optional values), delete_column (col).",
        "whiteboard: add_items (items), update_items (items with their id + fields to change), remove_items (ids).",
        "any: set (fields: top-level fields to change, e.g. {theme:'dark'} for slides, {type:'line'} for a chart, {currency:'€'} for a sheet).",
      ].join(" "),
    ),
  find: z.string().max(20_000).optional(),
  replace: z.string().max(20_000).optional(),
  all: z.boolean().optional(),
  markdown: z.string().max(100_000).optional(),
  index: z.number().int().optional().describe("Slide number (1 = first), or the sheet row number to insert before"),
  to: z.number().int().optional().describe("move_slide: the slide number it moves to"),
  slide: SlideInput.partial().optional(),
  cells: z.array(z.object({ ref: z.string().max(12), value: CellInput })).max(2000).optional(),
  rows: z.array(z.array(CellInput).max(40)).max(1000).optional(),
  rowNumbers: z.array(z.number().int()).max(1000).optional(),
  column: ColumnInput.optional(),
  col: z.string().max(120).optional().describe("Column letter (A, B, …) or its name"),
  values: z.array(CellInput).max(1000).optional(),
  items: z.array(WbItemInput.partial()).max(500).optional(),
  ids: z.array(z.string().max(60)).max(500).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});
type Edit = z.infer<typeof EditInput>;

// ─── Saving ──────────────────────────────────────────────────────────────────

type Saved = { artifactId: string; kind: DocKind; title: string; version: number; document: DocContent };

async function create(ctx: RunContext, kind: DocKind, title: string, raw: unknown): Promise<Saved> {
  const id = nanoid();
  const document = normalizeContent(kind, raw);
  await db.insert(artifact).values({
    id,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    kind,
    title,
    data: { ...(document as Record<string, unknown>), version: 1 },
  });
  return { artifactId: id, kind, title, version: 1, document };
}

/** What the model gets back: enough to find its way around the document, not all of it. */
function outline(kind: DocKind, data: DocContent): unknown {
  switch (kind) {
    case "doc": {
      const md = (data as DocData).markdown;
      return { headings: md.split("\n").filter((l) => /^#{1,3}\s/.test(l)).slice(0, 40), characters: md.length };
    }
    case "slides":
      return { theme: (data as SlidesData).theme, slides: (data as SlidesData).slides.map((s, i) => `${i + 1}. [${s.layout}] ${s.title}`) };
    case "sheet": {
      const s = data as SheetData;
      return { columns: s.columns.map((c, i) => `${colName(i)}: ${c.name} (${c.type})`), rows: s.rows.length, lastRow: s.rows.length + 1 };
    }
    case "chart": {
      const c = data as ChartData;
      return { type: c.type, labels: c.labels.length, series: c.series.map((s) => s.name) };
    }
    case "whiteboard":
      return { items: (data as WhiteboardData).items.map((i) => `${i.id} ${i.type}${i.text ? `: ${i.text.slice(0, 40)}` : ""}`).slice(0, 120) };
  }
}

/** Tool results keep the whole document for the chat card; the model gets an outline. */
const toModelOutput = ({ output }: { output: unknown }) => {
  const o = output as Partial<Saved> & { ok?: boolean; error?: string };
  if (!o?.ok || !o.kind || !o.document) return { type: "json" as const, value: (o ?? null) as never };
  return {
    type: "json" as const,
    value: {
      ok: true,
      artifactId: o.artifactId ?? null,
      kind: o.kind,
      title: o.title ?? "",
      version: o.version ?? 1,
      summary: describeContent(o.kind, o.document),
      outline: outline(o.kind, o.document),
    } as never,
  };
};

// ─── Editing ─────────────────────────────────────────────────────────────────

class EditError extends Error {}

const fail = (msg: string): never => {
  throw new EditError(msg);
};

function slideIndex(n: number | undefined, count: number, allowEnd = false): number {
  if (n === undefined) return allowEnd ? count : fail("index (slide number) is required");
  const i = n - 1;
  if (i < 0 || i > count - (allowEnd ? 0 : 1)) fail(`slide ${n} doesn't exist (there are ${count})`);
  return i;
}

function findColumn(sheet: SheetData, col: string | undefined): number {
  if (!col) return fail("col is required");
  const byName = sheet.columns.findIndex((c) => c.name.toLowerCase() === col.toLowerCase());
  if (byName >= 0) return byName;
  if (/^[A-Za-z]{1,3}$/.test(col)) {
    const i = colIndex(col);
    if (i < sheet.columns.length) return i;
  }
  return fail(`no column "${col}"`);
}

function applyEdit(kind: DocKind, data: DocContent, e: Edit): DocContent {
  if (e.op === "set") {
    if (!e.fields) fail("set needs fields");
    return normalizeContent(kind, { ...(data as Record<string, unknown>), ...e.fields });
  }
  switch (kind) {
    case "doc": {
      const d = data as DocData;
      if (e.op === "append") return { markdown: `${d.markdown.trimEnd()}\n\n${e.markdown ?? ""}`.trim() };
      if (e.op === "replace_text") {
        if (!e.find) fail("replace_text needs find");
        if (!d.markdown.includes(e.find!)) fail(`text not found: "${e.find!.slice(0, 80)}"`);
        return { markdown: e.all ? d.markdown.split(e.find!).join(e.replace ?? "") : d.markdown.replace(e.find!, () => e.replace ?? "") };
      }
      break;
    }
    case "slides": {
      const d = data as SlidesData;
      const slides = [...d.slides];
      if (e.op === "insert_slide") {
        const s = normalizeSlide(e.slide ?? {});
        if (!s) fail("insert_slide needs a slide with a title or content");
        slides.splice(slideIndex(e.index, slides.length, true), 0, s!);
      } else if (e.op === "update_slide") {
        const i = slideIndex(e.index, slides.length);
        const s = normalizeSlide({ ...slides[i], ...(e.slide ?? {}) });
        if (!s) fail("the slide would be empty");
        slides[i] = s!;
      } else if (e.op === "delete_slide") {
        slides.splice(slideIndex(e.index, slides.length), 1);
      } else if (e.op === "move_slide") {
        const from = slideIndex(e.index, slides.length);
        const to = slideIndex(e.to, slides.length);
        const [s] = slides.splice(from, 1);
        slides.splice(to, 0, s);
      } else break;
      return { ...d, slides };
    }
    case "sheet": {
      const d = data as SheetData;
      const width = d.columns.length;
      const rows = d.rows.map((r) => [...r]);
      const columns = [...d.columns];
      const fit = (r: unknown[]) => {
        const row = r.slice(0, Math.max(width, r.length)).map(normalizeCell);
        while (row.length < width) row.push(null);
        return row;
      };
      if (e.op === "set_cells") {
        for (const c of e.cells ?? []) {
          const ref = parseRef(c.ref);
          if (!ref) fail(`bad cell reference "${c.ref}"`);
          const { row, col } = ref!;
          if (row === -1) {
            if (!columns[col]) fail(`no column ${colName(col)}`);
            columns[col] = { ...columns[col], name: String(c.value ?? "") };
            continue;
          }
          if (col >= 40 || row < 0 || row > 999) fail(`${c.ref} is outside the sheet`);
          while (rows.length <= row) rows.push(Array(width).fill(null));
          while (columns.length <= col) columns.push({ name: colName(columns.length), type: "text" });
          for (const r of rows) while (r.length < columns.length) r.push(null);
          rows[row][col] = normalizeCell(c.value);
        }
      } else if (e.op === "append_rows") {
        rows.push(...(e.rows ?? []).map(fit));
      } else if (e.op === "insert_rows") {
        const at = (e.index ?? 2) - 2;
        if (at < 0 || at > rows.length) fail(`row ${e.index} is outside the sheet (rows 2 to ${rows.length + 1})`);
        rows.splice(at, 0, ...(e.rows ?? []).map(fit));
      } else if (e.op === "delete_rows") {
        const drop = new Set((e.rowNumbers ?? []).map((n) => n - 2));
        return { ...d, columns, rows: rows.filter((_, i) => !drop.has(i)) };
      } else if (e.op === "add_column") {
        if (!e.column) fail("add_column needs column");
        columns.push({ name: e.column!.name, type: e.column!.type ?? "text" });
        rows.forEach((r, i) => r.push(normalizeCell(e.values?.[i] ?? null)));
      } else if (e.op === "delete_column") {
        const i = findColumn(d, e.col);
        columns.splice(i, 1);
        rows.forEach((r) => r.splice(i, 1));
      } else break;
      return { ...d, columns, rows };
    }
    case "whiteboard": {
      const d = data as WhiteboardData;
      let items: WbItem[] = [...d.items];
      if (e.op === "add_items") {
        const added = (e.items ?? []).map((it, i) => normalizeWbItem(it, items.length + i)).filter((it): it is WbItem => !!it);
        if (!added.length) fail("add_items needs items");
        items.push(...added);
      } else if (e.op === "update_items") {
        for (const patch of e.items ?? []) {
          const i = items.findIndex((it) => it.id === patch.id);
          if (i < 0) fail(`no item "${patch.id}"`);
          const merged = normalizeWbItem({ ...items[i], ...patch }, i);
          if (merged) items[i] = merged;
        }
      } else if (e.op === "remove_items") {
        const drop = new Set(e.ids ?? []);
        // Arrows attached to removed items go too.
        items = items.filter((it) => !drop.has(it.id) && !(it.type === "arrow" && ((it.from && drop.has(it.from)) || (it.to && drop.has(it.to)))));
      } else break;
      return { ...d, items };
    }
    case "chart":
      break;
  }
  return fail(`"${e.op}" doesn't apply to a ${kind}. For a ${kind}, ${kind === "chart" ? "pass content (the whole chart) or use set" : "see the op list"}.`);
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const ID_HINT = "The result's artifactId is the document's id: pass it to update_document to change it later.";

export function documentTools(ctx: RunContext) {
  const run = async <T>(fn: () => Promise<T>) => {
    try {
      return { ok: true as const, ...(await fn()) };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  };

  return {
    create_doc: tool({
      description: `Write a document the user can keep, edit, export (Markdown, PDF) and print: a report, essay, plan, letter, notes, a guide. Shown as a card in the chat that opens full screen. Use Markdown: headings, lists, tables, quotes, code. Use the user's language. Keep your chat reply to a line about it. ${ID_HINT}`,
      inputSchema: z.object({ title: z.string().max(120), markdown: z.string().max(100_000) }),
      execute: ({ title, markdown }) => run(() => create(ctx, "doc", title, { markdown })),
      toModelOutput,
    }),

    create_slides: tool({
      description: `Make a slide deck (presentation): one idea per slide, short bullets, speaker notes for what to say. Start with a title slide; 6 to 12 slides is typical. Shown as a card in the chat; opens full screen to present, exports to PDF. Use the user's language. ${ID_HINT}`,
      inputSchema: z.object({
        title: z.string().max(120),
        theme: z.enum(SLIDE_THEMES).optional().describe("Colour theme (default light)"),
        slides: z.array(SlideInput).min(1).max(60),
      }),
      execute: ({ title, ...rest }) => run(() => create(ctx, "slides", title, rest)),
      toModelOutput,
    }),

    create_sheet: tool({
      description: `Make a spreadsheet: a budget, tracker, comparison, schedule, data table. Columns have a name and a type; rows are lists of cells in column order. Cells can be formulas like Excel: "=SUM(B2:B9)", "=B2*C2", "=AVERAGE(C:C)", "=IF(D2>100,\\"high\\",\\"ok\\")" (row 1 is the header, so data starts at row 2; columns are A, B, C…). Supports SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, MEDIAN, PRODUCT, ROUND, ABS, IF. Exports to CSV. ${ID_HINT}`,
      inputSchema: z.object({
        title: z.string().max(120),
        columns: z.array(ColumnInput).min(1).max(40),
        rows: z.array(z.array(CellInput).max(40)).max(1000),
        currency: z.string().max(8).optional().describe("Symbol for currency columns (default $)"),
      }),
      execute: ({ title, ...rest }) => run(() => create(ctx, "sheet", title, rest)),
      toModelOutput,
    }),

    create_chart: tool({
      description: `Make a chart the user can keep and export as an image: bar, line, area, pie or donut, with labels and one or more series. For numbers you looked up, give the source in caption. ${ID_HINT}`,
      inputSchema: z.object({ title: z.string().max(120), ...ChartInput }),
      execute: ({ title, ...rest }) => run(() => create(ctx, "chart", title, rest)),
      toModelOutput,
    }),

    create_whiteboard: tool({
      description: `Draw on a whiteboard: brainstorms with sticky notes, flowcharts and diagrams (shapes joined by arrows), mind maps, timelines, sketches. Place items on a grid with room between them (e.g. notes 220 apart); connect them with arrows (from/to ids). Exports as an image. ${ID_HINT}`,
      inputSchema: z.object({ title: z.string().max(120), items: z.array(WbItemInput).min(1).max(400) }),
      execute: ({ title, items }) => run(() => create(ctx, "whiteboard", title, { items })),
      toModelOutput,
    }),

    update_document: tool({
      description:
        "Change a document (doc, slides, sheet, chart or whiteboard) in place, making a new version of the same document instead of a copy: \"add a slide\", \"fix the second paragraph\", \"add a column\", \"make it a line chart\". Pass its id (artifactId). For small changes pass edits; for a rewrite pass content, the whole new content with the same fields as the create tool for that kind. Edits all apply or none do; on an error, fix the edit and try again. Call read_document first if you don't know the document's current content.",
      inputSchema: z.object({
        id: z.string().max(40),
        title: z.string().max(120).optional().describe("A new title"),
        content: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("The whole new content: {markdown} for a doc, {slides, theme} for slides, {columns, rows} for a sheet, {type, labels, series…} for a chart, {items} for a whiteboard"),
        edits: z.array(EditInput).max(100).optional(),
      }),
      execute: async ({ id, title, content, edits }) =>
        run(async () => {
          if (!content && !edits?.length && !title) throw new Error("Nothing to change: pass edits, content or title");
          return db.transaction(async (tx) => {
            const [row] = await tx
              .select({ kind: artifact.kind, title: artifact.title, data: artifact.data })
              .from(artifact)
              .where(and(eq(artifact.id, id), eq(artifact.userId, ctx.userId)))
              .for("update")
              .limit(1);
            if (!row) throw new Error(`No document with id "${id}". Use list_documents to find it.`);
            if (!isDocKind(row.kind)) throw new Error(`"${id}" is a ${row.kind}, not a document`);
            const kind = row.kind;
            let data = content ? normalizeContent(kind, content) : normalizeContent(kind, row.data);
            try {
              for (const e of edits ?? []) data = applyEdit(kind, data, e);
            } catch (err) {
              if (err instanceof EditError) throw new Error(`${err.message}. Nothing was changed.`);
              throw err;
            }
            const version = (typeof row.data.version === "number" ? row.data.version : 1) + 1;
            const newTitle = title ?? row.title;
            await tx
              .update(artifact)
              .set({ title: newTitle, data: { ...(data as Record<string, unknown>), version }, updatedAt: new Date() })
              .where(eq(artifact.id, id));
            return { artifactId: id, kind, title: newTitle, version, document: data };
          });
        }),
      toModelOutput,
    }),

    show_document: tool({
      description:
        "Show an existing document as a card in this chat, e.g. one an agent made or one from an earlier chat the user wants to open again. Pass its id.",
      inputSchema: z.object({ id: z.string().max(40) }),
      execute: async ({ id }) =>
        run(async () => {
          const [row] = await db
            .select({ kind: artifact.kind, title: artifact.title, data: artifact.data })
            .from(artifact)
            .where(and(eq(artifact.id, id), eq(artifact.userId, ctx.userId)))
            .limit(1);
          if (!row || !isDocKind(row.kind)) throw new Error(`No document with id "${id}". Use list_documents to find it.`);
          const version = typeof row.data.version === "number" ? row.data.version : 1;
          return { artifactId: id, kind: row.kind, title: row.title, version, document: normalizeContent(row.kind, row.data) };
        }),
      toModelOutput,
    }),

    read_document: tool({
      description: "Read a document's current content (doc, slides, sheet, chart or whiteboard) by id, e.g. before changing it. For sheets, formula results come back too.",
      inputSchema: z.object({ id: z.string().max(40) }),
      execute: async ({ id }) => {
        const [row] = await db
          .select({ kind: artifact.kind, title: artifact.title, data: artifact.data, updatedAt: artifact.updatedAt })
          .from(artifact)
          .where(and(eq(artifact.id, id), eq(artifact.userId, ctx.userId)))
          .limit(1);
        if (!row || !isDocKind(row.kind)) return { ok: false, error: `No document with id "${id}". Use list_documents to find it.` };
        const content = normalizeContent(row.kind, row.data);
        const computed = row.kind === "sheet" ? evaluateSheet(content as SheetData) : undefined;
        return {
          ok: true,
          id,
          kind: row.kind,
          title: row.title,
          version: typeof row.data.version === "number" ? row.data.version : 1,
          updatedAt: row.updatedAt.toISOString(),
          content,
          ...(computed ? { computed } : {}),
        };
      },
    }),

    list_documents: tool({
      description: "Find the user's documents (docs, slides, sheets, charts, whiteboards), newest first, by title or kind. Returns ids for read_document and update_document.",
      inputSchema: z.object({
        query: z.string().max(120).optional().describe("Words from the title"),
        kind: z.enum(DOC_KINDS).optional(),
      }),
      execute: async ({ query, kind }) => {
        const rows = await db
          .select({ id: artifact.id, kind: artifact.kind, title: artifact.title, updatedAt: artifact.updatedAt })
          .from(artifact)
          .where(
            and(
              eq(artifact.userId, ctx.userId),
              kind ? eq(artifact.kind, kind) : inArray(artifact.kind, [...DOC_KINDS]),
              query ? ilike(artifact.title, `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`) : undefined,
            ),
          )
          .orderBy(desc(artifact.updatedAt))
          .limit(25);
        return { documents: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) };
      },
    }),
  };
}
