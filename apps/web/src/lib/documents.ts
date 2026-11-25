// Opal documents: docs, slides, sheets, charts and whiteboards that Opal and agents make in a
// chat. They're saved as artifacts (kind = the document kind) and edited with update_document.
// Shared by the server tools and the web viewers; iOS mirrors it in Views/Documents/DocumentModel.swift.

export const DOC_KINDS = ["doc", "slides", "sheet", "chart", "whiteboard"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const CREATE_TOOLS: Record<DocKind, string> = {
  doc: "create_doc",
  slides: "create_slides",
  sheet: "create_sheet",
  chart: "create_chart",
  whiteboard: "create_whiteboard",
};

/** Tools whose call shows as a document card in the chat. */
export const DOCUMENT_TOOLS = new Set([...Object.values(CREATE_TOOLS), "update_document", "show_document"]);

export function isDocKind(k: unknown): k is DocKind {
  return typeof k === "string" && (DOC_KINDS as readonly string[]).includes(k);
}

export function kindOfTool(name: string): DocKind | null {
  for (const k of DOC_KINDS) if (CREATE_TOOLS[k] === name) return k;
  return null;
}

export const KIND_LABEL: Record<DocKind, { one: string; many: string }> = {
  doc: { one: "Document", many: "Docs" },
  slides: { one: "Slides", many: "Slides" },
  sheet: { one: "Sheet", many: "Sheets" },
  chart: { one: "Chart", many: "Charts" },
  whiteboard: { one: "Whiteboard", many: "Whiteboards" },
};

// ─── Shapes ──────────────────────────────────────────────────────────────────

export type DocData = { markdown: string };

export const SLIDE_LAYOUTS = ["title", "section", "content", "image", "quote"] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];
export type Slide = {
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  bullets?: string[];
  body?: string;
  image?: string;
  imageAlt?: string;
  notes?: string;
};
export const SLIDE_THEMES = ["light", "dark", "blue", "green", "violet", "orange"] as const;
export type SlideTheme = (typeof SLIDE_THEMES)[number];
export type SlidesData = { theme: SlideTheme; slides: Slide[] };

/** Slide colours per theme (same values in iOS DocumentModel.swift). */
export const THEME_COLORS: Record<SlideTheme, { bg: string; fg: string; muted: string; accent: string }> = {
  light: { bg: "#ffffff", fg: "#161616", muted: "#6b6b6b", accent: "#2d7fe0" },
  dark: { bg: "#141518", fg: "#f2f2f2", muted: "#a3a3a3", accent: "#8ec2ff" },
  blue: { bg: "#0c2a4b", fg: "#f4f8ff", muted: "#a9c1dd", accent: "#7cc4ff" },
  green: { bg: "#0f2e22", fg: "#f1faf5", muted: "#a6c9b7", accent: "#7fe0b0" },
  violet: { bg: "#24164a", fg: "#f6f2ff", muted: "#bdb0e3", accent: "#c8b8ff" },
  orange: { bg: "#fff4e8", fg: "#2b1700", muted: "#8a6a4a", accent: "#d9690f" },
};

export const COLUMN_TYPES = ["text", "number", "currency", "percent", "date"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export type SheetColumn = { name: string; type: ColumnType };
export type Cell = string | number | null;
export type SheetData = { columns: SheetColumn[]; rows: Cell[][]; currency?: string };

export const CHART_TYPES = ["bar", "line", "area", "pie", "donut"] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export type ChartSeries = { name: string; values: (number | null)[] };
export type ChartData = {
  type: ChartType;
  labels: string[];
  series: ChartSeries[];
  unit?: string;
  stacked?: boolean;
  horizontal?: boolean;
  xLabel?: string;
  yLabel?: string;
  caption?: string;
};

export const WB_TYPES = ["note", "shape", "text", "arrow", "stroke"] as const;
export type WbType = (typeof WB_TYPES)[number];
export const WB_COLORS = ["yellow", "pink", "blue", "green", "purple", "orange", "gray", "red"] as const;
export type WbColor = (typeof WB_COLORS)[number];
export type WbShape = "rect" | "ellipse" | "diamond";
export type WbItem = {
  id: string;
  type: WbType;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  color?: WbColor;
  shape?: WbShape;
  size?: number;
  from?: string;
  to?: string;
  points?: [number, number][];
  dashed?: boolean;
  width?: number;
};
export type WhiteboardData = { items: WbItem[] };

/** Sticky-note and shape colours: fill (light, dark) and ink (same values in iOS). */
export const WB_PALETTE: Record<WbColor, { fill: string; fillDark: string; ink: string }> = {
  yellow: { fill: "#fff1a8", fillDark: "#5b4f12", ink: "#b58900" },
  pink: { fill: "#ffd6e7", fillDark: "#5e2340", ink: "#d6336c" },
  blue: { fill: "#d6e8ff", fillDark: "#1d3b61", ink: "#2d7fe0" },
  green: { fill: "#d8f5d0", fillDark: "#24502a", ink: "#2f9e44" },
  purple: { fill: "#e7defc", fillDark: "#3f2e6e", ink: "#7048e8" },
  orange: { fill: "#ffe2c4", fillDark: "#61391a", ink: "#e8590c" },
  gray: { fill: "#ececec", fillDark: "#3a3a3a", ink: "#868e96" },
  red: { fill: "#ffd8d6", fillDark: "#5f2422", ink: "#e03131" },
};

/** Series colours for charts, in order (same values in iOS). */
export const CHART_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b", "#84cc16"];

export type DocContent = DocData | SlidesData | SheetData | ChartData | WhiteboardData;
export type DocSnapshot = { id?: string; kind: DocKind; title: string; version: number; data: DocContent };

// ─── Normalizing ─────────────────────────────────────────────────────────────
// Lenient: takes what the model streamed (maybe half-written) or what's stored, and returns a
// complete, safe shape. Never throws.

const str = (v: unknown, max = 20_000): string | undefined => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : undefined);
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);

export function normalizeDoc(raw: unknown): DocData {
  return { markdown: str(obj(raw).markdown, 200_000) ?? "" };
}

export function normalizeSlide(raw: unknown): Slide | null {
  const s = obj(raw);
  const title = str(s.title, 300) ?? "";
  const bullets = arr(s.bullets).map((b) => str(b, 600)).filter((b): b is string => !!b);
  const body = str(s.body, 4000);
  const image = str(s.image, 2000);
  const safeImage = image && /^https:\/\//i.test(image) ? image : undefined;
  if (!title && !bullets.length && !body && !safeImage) return null;
  const fallback: SlideLayout = safeImage ? "image" : bullets.length || body ? "content" : "title";
  return {
    layout: oneOf(s.layout, SLIDE_LAYOUTS, fallback),
    title,
    subtitle: str(s.subtitle, 400) || undefined,
    bullets: bullets.length ? bullets : undefined,
    body: body || undefined,
    image: safeImage,
    imageAlt: str(s.imageAlt, 300) || undefined,
    notes: str(s.notes, 4000) || undefined,
  };
}

export function normalizeSlides(raw: unknown): SlidesData {
  const o = obj(raw);
  return {
    theme: oneOf(o.theme, SLIDE_THEMES, "light"),
    slides: arr(o.slides).map(normalizeSlide).filter((s): s is Slide => !!s).slice(0, 80),
  };
}

export function normalizeCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v.slice(0, 2000);
  return String(v).slice(0, 2000);
}

export function normalizeSheet(raw: unknown): SheetData {
  const o = obj(raw);
  const columns = arr(o.columns)
    .map((c) => {
      if (typeof c === "string") return { name: c.slice(0, 120), type: "text" as ColumnType };
      const co = obj(c);
      return { name: str(co.name, 120) ?? "", type: oneOf(co.type, COLUMN_TYPES, "text") };
    })
    .slice(0, 40);
  const rows = arr(o.rows)
    .map((r) => arr(r).slice(0, 40).map(normalizeCell))
    .slice(0, 1000);
  const width = Math.max(columns.length, ...rows.map((r) => r.length), 0);
  while (columns.length < width) columns.push({ name: colName(columns.length), type: "text" });
  const currency = str(o.currency, 8) || undefined;
  return { columns, rows: rows.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill(null)] : r)), currency };
}

export function normalizeChart(raw: unknown): ChartData {
  const o = obj(raw);
  const labels = arr(o.labels).map((l) => str(l, 120) ?? "").slice(0, 200);
  let series = arr(o.series)
    .map((s) => {
      const so = obj(s);
      return { name: str(so.name, 120) ?? "", values: arr(so.values).map((v) => num(v) ?? null).slice(0, 200) };
    })
    .filter((s) => s.values.length)
    .slice(0, 12);
  // A single list of values is fine too.
  if (!series.length && arr(o.values).length) series = [{ name: str(o.name, 120) ?? "", values: arr(o.values).map((v) => num(v) ?? null) }];
  const n = Math.max(labels.length, ...series.map((s) => s.values.length), 0);
  while (labels.length < n) labels.push(String(labels.length + 1));
  return {
    type: oneOf(o.type, CHART_TYPES, "bar"),
    labels,
    series,
    unit: str(o.unit, 16) || undefined,
    stacked: o.stacked === true || undefined,
    horizontal: o.horizontal === true || undefined,
    xLabel: str(o.xLabel, 80) || undefined,
    yLabel: str(o.yLabel, 80) || undefined,
    caption: str(o.caption, 400) || undefined,
  };
}

const WB_DEFAULT_SIZE: Record<WbType, [number, number]> = { note: [180, 140], shape: [170, 90], text: [240, 40], arrow: [0, 0], stroke: [0, 0] };

function points(v: unknown): [number, number][] {
  return arr(v)
    .map((p): [number, number] | null => {
      if (Array.isArray(p)) {
        const x = num(p[0]);
        const y = num(p[1]);
        return x !== undefined && y !== undefined ? [x, y] : null;
      }
      const po = obj(p);
      const x = num(po.x);
      const y = num(po.y);
      return x !== undefined && y !== undefined ? [x, y] : null;
    })
    .filter((p): p is [number, number] => !!p)
    .slice(0, 2000);
}

export function normalizeWbItem(raw: unknown, i: number): WbItem | null {
  const o = obj(raw);
  const type = oneOf(o.type, WB_TYPES, o.points ? "stroke" : o.from || o.to ? "arrow" : "note");
  const [dw, dh] = WB_DEFAULT_SIZE[type];
  const text = str(o.text, 2000);
  const item: WbItem = {
    id: str(o.id, 60) || `i${i + 1}`,
    type,
    x: num(o.x) ?? 0,
    y: num(o.y) ?? 0,
    w: Math.max(10, num(o.w) ?? (type === "text" && text ? Math.min(600, text.length * (num(o.size) ?? 20) * 0.55 + 10) : dw)),
    h: Math.max(10, num(o.h) ?? dh),
  };
  if (text) item.text = text;
  if (o.color) item.color = oneOf(o.color, WB_COLORS, "yellow");
  if (type === "shape") item.shape = oneOf(o.shape, ["rect", "ellipse", "diamond"] as const, "rect");
  if (type === "text") item.size = Math.min(96, Math.max(10, num(o.size) ?? 20));
  if (type === "arrow") {
    item.from = str(o.from, 60) || undefined;
    item.to = str(o.to, 60) || undefined;
    const pts = points(o.points);
    if (pts.length >= 2) item.points = pts;
    if (!item.points && !(item.from && item.to)) return null;
    if (o.dashed === true) item.dashed = true;
  }
  if (type === "stroke") {
    const pts = points(o.points);
    if (pts.length < 2) return null;
    item.points = pts;
    item.width = Math.min(24, Math.max(1, num(o.width) ?? 3));
  }
  return item;
}

export function normalizeWhiteboard(raw: unknown): WhiteboardData {
  const seen = new Set<string>();
  const items = arr(obj(raw).items)
    .map(normalizeWbItem)
    .filter((it): it is WbItem => !!it)
    .slice(0, 500)
    .map((it, i) => {
      // Ids must be unique; arrows point at them.
      let id = it.id;
      while (seen.has(id)) id = `${it.id}-${i}`;
      seen.add(id);
      return id === it.id ? it : { ...it, id };
    });
  return { items };
}

export function normalizeContent(kind: DocKind, raw: unknown): DocContent {
  switch (kind) {
    case "doc":
      return normalizeDoc(raw);
    case "slides":
      return normalizeSlides(raw);
    case "sheet":
      return normalizeSheet(raw);
    case "chart":
      return normalizeChart(raw);
    case "whiteboard":
      return normalizeWhiteboard(raw);
  }
}

/** A stored artifact (or a tool's snapshot) as a document. */
export function toSnapshot(a: { id?: string; kind: string; title?: string; data?: unknown; version?: number }): DocSnapshot | null {
  if (!isDocKind(a.kind)) return null;
  const data = obj(a.data);
  return { id: a.id, kind: a.kind, title: a.title ?? "Untitled", version: num(a.version) ?? num(data.version) ?? 1, data: normalizeContent(a.kind, data) };
}

/** One line on what's in it: "8 slides", "4 columns · 20 rows". */
export function describeContent(kind: DocKind, data: DocContent): string {
  switch (kind) {
    case "doc": {
      const words = (data as DocData).markdown.split(/\s+/).filter(Boolean).length;
      return `${words.toLocaleString()} word${words === 1 ? "" : "s"}`;
    }
    case "slides": {
      const n = (data as SlidesData).slides.length;
      return `${n} slide${n === 1 ? "" : "s"}`;
    }
    case "sheet": {
      const s = data as SheetData;
      return `${s.columns.length} column${s.columns.length === 1 ? "" : "s"} · ${s.rows.length} row${s.rows.length === 1 ? "" : "s"}`;
    }
    case "chart": {
      const c = data as ChartData;
      const t = { bar: "Bar", line: "Line", area: "Area", pie: "Pie", donut: "Donut" }[c.type];
      return `${t} chart · ${c.labels.length} point${c.labels.length === 1 ? "" : "s"}`;
    }
    case "whiteboard": {
      const n = (data as WhiteboardData).items.length;
      return `${n} item${n === 1 ? "" : "s"}`;
    }
  }
}

// ─── Sheets ──────────────────────────────────────────────────────────────────
// Spreadsheet references: columns are letters (A, B, …), row 1 is the header row, so the first
// data row is row 2, as in Excel. Formulas start with "=" and support + - * / ^, comparisons,
// ranges (B2:B9, B:B) and SUM, AVERAGE, MIN, MAX, COUNT, MEDIAN, PRODUCT, ROUND, ABS, IF.

export function colName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "B3" → { col: 1, row: 1 } (row index into data rows; row 1 is the header, -1). */
export function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^\s*([A-Za-z]{1,3})\s*(\d{1,5})\s*$/.exec(ref);
  if (!m) return null;
  return { col: colIndex(m[1]), row: Number(m[2]) - 2 };
}

export type CellValue = number | string | null;
type Err = { error: string };
const isErr = (v: unknown): v is Err => typeof v === "object" && v !== null && "error" in v;

/** A plain cell's value as a number, if it reads as one ("1,234.5", "€12", "45%"). */
export function cellNumber(v: Cell): number | null {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.startsWith("=")) return null;
  const pct = t.endsWith("%");
  const cleaned = t.replace(/[%\s,$€£¥₹]/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? (pct ? n / 100 : n) : null;
}

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "ref"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?/i.exec(src.slice(i));
      if (!m) return null;
      const pct = m[0].endsWith("%");
      out.push({ t: "num", v: Number(pct ? m[0].slice(0, -1) : m[0]) / (pct ? 100 : 1) });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) return null;
      out.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const word = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(src.slice(i))![0];
      const after = src.slice(i + word.length).trimStart();
      const bare = word.replace(/\$/g, "").toUpperCase();
      const cellLike = /^[A-Z]{1,3}\d{1,5}$/.test(bare);
      const columnLike = /^[A-Z]{1,3}$/.test(bare);
      if (!after.startsWith("(") && (cellLike || (columnLike && after.startsWith(":")))) out.push({ t: "ref", v: bare });
      else out.push({ t: "id", v: bare });
      i += word.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^(),:<>=&".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    return null;
  }
  return out;
}

type Val = number | string | boolean | null | Val[] | Err;

/** Works out every formula in a sheet. Returns a grid of values the same size as `rows`. */
export function evaluateSheet(sheet: SheetData): CellValue[][] {
  const rows = sheet.rows;
  const memo = new Map<string, Val>();
  const visiting = new Set<string>();

  function cellAt(r: number, c: number): Val {
    if (r === -1) return sheet.columns[c]?.name ?? null;
    if (r < 0 || c < 0 || r >= rows.length || c >= (rows[r]?.length ?? 0)) return null;
    const key = `${r}:${c}`;
    if (memo.has(key)) return memo.get(key)!;
    const raw = rows[r][c];
    if (typeof raw !== "string" || !raw.trim().startsWith("=")) {
      const n = cellNumber(raw);
      return n ?? raw;
    }
    if (visiting.has(key)) return { error: "#CYCLE!" };
    visiting.add(key);
    const v = formula(raw.trim().slice(1));
    visiting.delete(key);
    memo.set(key, v);
    return v;
  }

  function formula(src: string): Val {
    const tokenized = tokenize(src);
    if (!tokenized) return { error: "#ERROR!" };
    const toks: Tok[] = tokenized;
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;

    function primary(): Val {
      const tok = toks[p++];
      if (!tok) return { error: "#ERROR!" };
      if (tok.t === "num") return tok.v;
      if (tok.t === "str") return tok.v;
      if (tok.t === "op" && tok.v === "(") {
        const v = comparison();
        if (!isOp(")")) return { error: "#ERROR!" };
        p++;
        return v;
      }
      if (tok.t === "op" && (tok.v === "-" || tok.v === "+")) {
        const v = toNum(power());
        return isErr(v) ? v : tok.v === "-" ? -v : v;
      }
      if (tok.t === "ref") {
        if (isOp(":")) {
          p++;
          const end = toks[p++];
          if (!end || (end.t !== "ref" && end.t !== "id")) return { error: "#REF!" };
          return range(tok.v, end.v);
        }
        const ref = parseRef(tok.v);
        return ref ? cellAt(ref.row, ref.col) : { error: "#REF!" };
      }
      if (tok.t === "id") {
        if (tok.v === "TRUE") return true;
        if (tok.v === "FALSE") return false;
        if (!isOp("(")) return { error: "#NAME?" };
        p++;
        const args: Val[] = [];
        if (!isOp(")")) {
          for (;;) {
            args.push(comparison());
            if (isOp(",")) {
              p++;
              continue;
            }
            break;
          }
        }
        if (!isOp(")")) return { error: "#ERROR!" };
        p++;
        return call(tok.v, args);
      }
      return { error: "#ERROR!" };
    }

    function power(): Val {
      let left = primary();
      while (isOp("^")) {
        p++;
        const right = primary();
        const a = toNum(left);
        const b = toNum(right);
        left = isErr(a) ? a : isErr(b) ? b : Math.pow(a, b);
      }
      return left;
    }

    function term(): Val {
      let left = power();
      while (isOp("*") || isOp("/")) {
        const op = toks[p++].v;
        const right = power();
        const a = toNum(left);
        const b = toNum(right);
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        if (op === "/" && b === 0) return { error: "#DIV/0!" };
        left = op === "*" ? a * b : a / b;
      }
      return left;
    }

    function sum(): Val {
      let left = term();
      while (isOp("+") || isOp("-") || isOp("&")) {
        const op = toks[p++].v;
        const right = term();
        if (op === "&") {
          if (isErr(left)) return left;
          if (isErr(right)) return right;
          left = `${display(left)}${display(right)}`;
          continue;
        }
        const a = toNum(left);
        const b = toNum(right);
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        left = op === "+" ? a + b : a - b;
      }
      return left;
    }

    function comparison(): Val {
      const left = sum();
      const op = peek();
      if (op?.t === "op" && ["=", "<", ">", "<=", ">=", "<>"].includes(op.v)) {
        p++;
        const right = sum();
        if (isErr(left)) return left;
        if (isErr(right)) return right;
        const a = typeof left === "number" ? left : String(display(left));
        const b = typeof right === "number" ? right : String(display(right));
        switch (op.v) {
          case "=":
            return a === b;
          case "<>":
            return a !== b;
          case "<":
            return a < b;
          case ">":
            return a > b;
          case "<=":
            return a <= b;
          case ">=":
            return a >= b;
        }
      }
      return left;
    }

    const v = comparison();
    if (p < toks.length) return { error: "#ERROR!" };
    return v;
  }

  function range(a: string, b: string): Val {
    const whole = (s: string) => /^[A-Z]{1,3}$/.test(s);
    let r1: number, r2: number, c1: number, c2: number;
    if (whole(a) && whole(b)) {
      c1 = colIndex(a);
      c2 = colIndex(b);
      r1 = 0;
      r2 = rows.length - 1;
    } else {
      const s = parseRef(a);
      const e = parseRef(b);
      if (!s || !e) return { error: "#REF!" };
      [r1, r2] = [Math.min(s.row, e.row), Math.max(s.row, e.row)];
      [c1, c2] = [Math.min(s.col, e.col), Math.max(s.col, e.col)];
    }
    const out: Val[] = [];
    // A range skips the cells being worked out, so a total at the bottom of a column can sum
    // the whole column (=SUM(B:B)) without counting itself.
    for (let r = Math.max(0, r1); r <= Math.min(r2, rows.length - 1); r++) for (let c = c1; c <= c2; c++) if (!visiting.has(`${r}:${c}`)) out.push(cellAt(r, c));
    return out;
  }

  function flat(args: Val[]): Val[] {
    return args.flatMap((a) => (Array.isArray(a) ? flat(a) : [a]));
  }

  function nums(args: Val[]): number[] | Err {
    const out: number[] = [];
    for (const v of flat(args)) {
      if (isErr(v)) return v;
      if (typeof v === "number") out.push(v);
      else if (typeof v === "boolean") out.push(v ? 1 : 0);
    }
    return out;
  }

  function call(name: string, args: Val[]): Val {
    switch (name) {
      case "SUM": {
        const n = nums(args);
        return isErr(n) ? n : n.reduce((a, b) => a + b, 0);
      }
      case "AVERAGE":
      case "AVG":
      case "MEAN": {
        const n = nums(args);
        if (isErr(n)) return n;
        return n.length ? n.reduce((a, b) => a + b, 0) / n.length : { error: "#DIV/0!" };
      }
      case "MIN":
      case "MAX": {
        const n = nums(args);
        if (isErr(n)) return n;
        return n.length ? (name === "MIN" ? Math.min(...n) : Math.max(...n)) : 0;
      }
      case "COUNT": {
        const n = nums(args);
        return isErr(n) ? n : n.length;
      }
      case "COUNTA":
        return flat(args).filter((v) => v !== null && v !== "").length;
      case "MEDIAN": {
        const n = nums(args);
        if (isErr(n)) return n;
        if (!n.length) return { error: "#NUM!" };
        const s = [...n].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      }
      case "PRODUCT": {
        const n = nums(args);
        return isErr(n) ? n : n.reduce((a, b) => a * b, 1);
      }
      case "ROUND": {
        const x = toNum(args[0] ?? 0);
        const d = toNum(args[1] ?? 0);
        if (isErr(x)) return x;
        if (isErr(d)) return d;
        const f = Math.pow(10, Math.trunc(d));
        return Math.round(x * f) / f;
      }
      case "ABS": {
        const x = toNum(args[0] ?? 0);
        return isErr(x) ? x : Math.abs(x);
      }
      case "IF": {
        const c = args[0];
        if (isErr(c)) return c;
        const yes = typeof c === "number" ? c !== 0 : typeof c === "string" ? c !== "" : !!c;
        return (yes ? args[1] : args[2]) ?? (yes ? true : false);
      }
      default:
        return { error: "#NAME?" };
    }
  }

  function toNum(v: Val): number | Err {
    if (isErr(v)) return v;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v === null || v === "") return 0;
    if (Array.isArray(v)) return v.length === 1 ? toNum(v[0]) : { error: "#VALUE!" };
    const n = cellNumber(v);
    return n ?? { error: "#VALUE!" };
  }

  function display(v: Val): CellValue {
    if (isErr(v)) return v.error;
    if (Array.isArray(v)) return v.length ? display(v[0]) : null;
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return v;
  }

  return rows.map((row, r) =>
    row.map((raw, c) => {
      if (typeof raw === "string" && raw.trim().startsWith("=")) return display(cellAt(r, c));
      return raw;
    }),
  );
}

/** A value as the sheet shows it, by its column's type. */
export function formatCell(v: CellValue, type: ColumnType, currency = "$"): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    if (v.startsWith("#")) return v;
    const n = type === "text" || type === "date" ? null : cellNumber(v);
    if (n === null) return v;
    v = n;
  }
  switch (type) {
    case "currency":
      return `${v < 0 ? "-" : ""}${currency}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "percent":
      return `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    default:
      return v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2 });
  }
}

export function isNumericColumn(type: ColumnType) {
  return type === "number" || type === "currency" || type === "percent";
}

/** The sheet as CSV (computed values, not formulas). */
export function sheetToCsv(sheet: SheetData): string {
  const values = evaluateSheet(sheet);
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [sheet.columns.map((c) => esc(c.name)).join(",")];
  for (const row of values) lines.push(row.map((v) => esc(v === null ? "" : String(v))).join(","));
  return lines.join("\r\n");
}

// ─── Charts ──────────────────────────────────────────────────────────────────

/** Round axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    if (min === 0) return [0, 1];
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const span = max - min;
  const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (count * step0) / span;
  const step = step0 * (err <= 0.15 ? 10 : err <= 0.35 ? 5 : err <= 0.75 ? 2 : 1);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export function shortNumber(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}k`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ─── Whiteboards ─────────────────────────────────────────────────────────────

export type Box = { x: number; y: number; w: number; h: number };

export function itemBox(it: WbItem): Box {
  if ((it.type === "stroke" || it.type === "arrow") && it.points?.length) {
    const xs = it.points.map((p) => p[0]);
    const ys = it.points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

/** Where an arrow runs: from the edge of one box to the edge of the other, or along its points. */
export function arrowPoints(it: WbItem, byId: Map<string, WbItem>): [number, number][] | null {
  if (it.points && it.points.length >= 2 && !(it.from && it.to)) return it.points;
  const a = it.from ? byId.get(it.from) : undefined;
  const b = it.to ? byId.get(it.to) : undefined;
  if (!a || !b) return it.points && it.points.length >= 2 ? it.points : null;
  const ba = itemBox(a);
  const bb = itemBox(b);
  const ca: [number, number] = [ba.x + ba.w / 2, ba.y + ba.h / 2];
  const cb: [number, number] = [bb.x + bb.w / 2, bb.y + bb.h / 2];
  return [edge(ba, ca, cb, 6), edge(bb, cb, ca, 8)];
}

/** The point where the line from `from` towards `to` leaves box `b`, pushed out by `gap`. */
function edge(b: Box, from: [number, number], to: [number, number], gap: number): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return from;
  const tx = dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  const len = Math.hypot(dx, dy);
  return [from[0] + dx * t + (dx / len) * gap, from[1] + dy * t + (dy / len) * gap];
}

export function boardBounds(items: WbItem[]): Box {
  if (!items.length) return { x: 0, y: 0, w: 800, h: 500 };
  const byId = new Map(items.map((i) => [i.id, i]));
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const it of items) {
    const pts = it.type === "arrow" ? arrowPoints(it, byId) : null;
    const b = pts ? itemBox({ ...it, points: pts }) : itemBox(it);
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  const pad = 40;
  return { x: x1 - pad, y: y1 - pad, w: Math.max(200, x2 - x1 + pad * 2), h: Math.max(140, y2 - y1 + pad * 2) };
}
