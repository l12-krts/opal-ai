"use client";
// Opal Handwriting renderer. Lays Markdown out on A4 paper and draws every character with one of
// the writer's own glyphs, varying size, slant, baseline and ink so no two letters are alike.
// Tables and charts are drawn with rough.js so lines look hand-ruled.
import { marked, type Token, type Tokens } from "marked";
import rough from "roughjs";

export type GlyphData = { char: string; variant: number; width: number; height: number; baseline: number; advance: number; png: string };
type Loaded = GlyphData & { img: HTMLImageElement };
export type Atlas = { glyphs: Map<string, Loaded[]>; capHeight: number };
export type Paper = "lined" | "grid" | "blank";
export type Ink = "blue" | "black" | "darkblue";

const INK: Record<Ink, string> = { blue: "#1f3d99", black: "#1e1e22", darkblue: "#14234f" };
const PAGE_W = 794;
const PAGE_H = 1123;
const DPR = 2;
const LINE = 33; // ruling (px)
const TOP = 96;
const LEFT = 84;
const RIGHT = 56;
const BOTTOM = 72;

export async function loadAtlas(glyphs: GlyphData[]): Promise<Atlas> {
  const map = new Map<string, Loaded[]>();
  await Promise.all(
    glyphs.map(
      (g) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const list = map.get(g.char) ?? [];
            list.push({ ...g, img });
            map.set(g.char, list);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = g.png;
        }),
    ),
  );
  // Typical cap height above the baseline, in em, from upper-case letters.
  const caps = [..."HEΑΒΤΚ"].flatMap((c) => map.get(c) ?? []).map((g) => g.baseline);
  caps.sort((a, b) => a - b);
  const capHeight = caps.length ? caps[Math.floor(caps.length / 2)] : 0.55;
  return { glyphs: map, capHeight };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Run = { text: string; bold?: boolean; italic?: boolean };

function inlineRuns(tokens: Token[] | undefined, style: { bold?: boolean; italic?: boolean } = {}): Run[] {
  const out: Run[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        out.push(...inlineRuns((t as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inlineRuns((t as Tokens.Em).tokens, { ...style, italic: true }));
        break;
      case "link":
        out.push(...inlineRuns((t as Tokens.Link).tokens, style));
        break;
      case "codespan":
        out.push({ text: (t as Tokens.Codespan).text, ...style });
        break;
      case "br":
        out.push({ text: "\n", ...style });
        break;
      case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) out.push(...inlineRuns(tt.tokens, style));
        else out.push({ text: decode(tt.text), ...style });
        break;
      }
      case "escape":
        out.push({ text: (t as Tokens.Escape).text, ...style });
        break;
      default:
        if ("text" in t && typeof t.text === "string") out.push({ text: decode(t.text), ...style });
    }
  }
  return out;
}

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

type Ctx = {
  pages: HTMLCanvasElement[];
  c: CanvasRenderingContext2D;
  rc: ReturnType<typeof rough.canvas>;
  y: number; // current baseline
  rand: () => number;
  ink: string;
  atlas: Atlas | null;
  em: number;
  fallbackFont: string;
  paper: Paper;
  tintCache: Map<string, HTMLCanvasElement>;
  drift: number;
};

function newPage(ctx: Pick<Ctx, "pages" | "paper">) {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W * DPR;
  canvas.height = PAGE_H * DPR;
  const c = canvas.getContext("2d")!;
  c.scale(DPR, DPR);
  c.fillStyle = "#fffefb";
  c.fillRect(0, 0, PAGE_W, PAGE_H);
  if (ctx.paper === "lined") {
    c.strokeStyle = "rgba(90, 150, 210, 0.32)";
    c.lineWidth = 0.8;
    for (let y = TOP; y < PAGE_H - 30; y += LINE) {
      c.beginPath();
      c.moveTo(0, y + 0.5);
      c.lineTo(PAGE_W, y + 0.5);
      c.stroke();
    }
    c.strokeStyle = "rgba(220, 80, 80, 0.45)";
    c.beginPath();
    c.moveTo(LEFT - 14, 0);
    c.lineTo(LEFT - 14, PAGE_H);
    c.stroke();
  } else if (ctx.paper === "grid") {
    c.strokeStyle = "rgba(90, 150, 210, 0.22)";
    c.lineWidth = 0.6;
    const step = LINE / 2;
    for (let x = 0; x < PAGE_W; x += step) {
      c.beginPath();
      c.moveTo(x + 0.5, 0);
      c.lineTo(x + 0.5, PAGE_H);
      c.stroke();
    }
    for (let y = TOP % step; y < PAGE_H; y += step) {
      c.beginPath();
      c.moveTo(0, y + 0.5);
      c.lineTo(PAGE_W, y + 0.5);
      c.stroke();
    }
  }
  ctx.pages.push(canvas);
  return { c, rc: rough.canvas(canvas) };
}

function ensureRoom(ctx: Ctx, needed: number) {
  if (ctx.y + needed > PAGE_H - BOTTOM) {
    const { c, rc } = newPage(ctx);
    ctx.c = c;
    ctx.rc = rc;
    ctx.y = TOP + LINE - 3;
  }
}

function tinted(ctx: Ctx, g: Loaded): HTMLCanvasElement {
  const key = `${g.char}:${g.variant}:${ctx.ink}`;
  const hit = ctx.tintCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = g.img.naturalWidth;
  cv.height = g.img.naturalHeight;
  const c = cv.getContext("2d")!;
  c.drawImage(g.img, 0, 0);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = ctx.ink;
  c.fillRect(0, 0, cv.width, cv.height);
  ctx.tintCache.set(key, cv);
  return cv;
}

/** Width of a string at a given scale, without drawing. */
function measure(ctx: Ctx, text: string, scale: number): number {
  let w = 0;
  for (const ch of text) w += advanceOf(ctx, ch, scale);
  return w;
}

function advanceOf(ctx: Ctx, ch: string, scale: number): number {
  const em = ctx.em * scale;
  if (ch === " ") return em * 0.3;
  const g = ctx.atlas?.glyphs.get(ch) ?? ctx.atlas?.glyphs.get(ch.normalize("NFD")[0]);
  if (g?.length) return g[0].advance * em + em * 0.035;
  ctx.c.font = `${Math.round(LINE * 0.78 * scale)}px ${ctx.fallbackFont}`;
  return ctx.c.measureText(ch).width + 0.5;
}

function drawChar(ctx: Ctx, ch: string, x: number, baseline: number, scale: number, bold: boolean, italic: boolean): number {
  const { c, rand } = ctx;
  const em = ctx.em * scale;
  if (ch === " ") return em * (0.27 + rand() * 0.07);
  const list = ctx.atlas?.glyphs.get(ch) ?? ctx.atlas?.glyphs.get(ch.normalize("NFD")[0]);
  const jitterY = (rand() - 0.5) * 2.2 * scale;
  const rot = ((rand() - 0.5) * 5 * Math.PI) / 180 + (italic ? -0.12 : 0);
  const s = 0.95 + rand() * 0.1;
  c.save();
  c.globalAlpha = 0.86 + rand() * 0.14;
  if (list?.length) {
    const g = list[Math.floor(rand() * list.length)];
    const w = g.width * em * s;
    const h = g.height * em * s;
    const top = baseline - g.baseline * em * s + jitterY;
    c.translate(x + w / 2, top + h / 2);
    c.rotate(rot);
    const img = tinted(ctx, g);
    c.drawImage(img, -w / 2, -h / 2, w, h);
    if (bold) c.drawImage(img, -w / 2 + 0.8, -h / 2 + 0.2, w, h);
    c.restore();
    return g.advance * em * s + em * (0.02 + rand() * 0.03);
  }
  // No glyph for this character (or no profile yet): a handwriting-style font stands in.
  const size = Math.round(LINE * 0.78 * scale * s);
  c.font = `${bold ? 600 : 400} ${size}px ${ctx.fallbackFont}`;
  c.fillStyle = ctx.ink;
  c.translate(x, baseline + jitterY);
  c.rotate(rot * 0.6);
  c.fillText(ch, 0, 0);
  const adv = c.measureText(ch).width;
  c.restore();
  return adv + 0.3 + rand() * 0.6;
}

/** Writes runs as wrapped lines starting at the current baseline. Returns nothing; moves ctx.y. */
function writeRuns(ctx: Ctx, runs: Run[], opts: { x0?: number; x1?: number; scale?: number; firstPrefix?: string } = {}) {
  const x0 = opts.x0 ?? LEFT;
  const x1 = opts.x1 ?? PAGE_W - RIGHT;
  const scale = opts.scale ?? 1;
  const lineStep = LINE * Math.max(1, Math.ceil(scale * 0.95));
  type Word = { text: string; bold?: boolean; italic?: boolean; newline?: boolean };
  const words: Word[] = [];
  for (const r of runs) {
    const pieces = r.text.split(/(\s+)/);
    for (const p of pieces) {
      if (!p) continue;
      if (/\n/.test(p)) words.push({ text: "", newline: true });
      else if (/^\s+$/.test(p)) words.push({ text: " " });
      else words.push({ text: p, bold: r.bold, italic: r.italic });
    }
  }
  let x = x0 + (ctx.rand() - 0.5) * 3;
  ensureRoom(ctx, 0);
  let slope = (ctx.rand() - 0.5) * 0.008;
  let lineStart = x;
  for (const w of words) {
    if (w.newline) {
      ctx.y += lineStep;
      ensureRoom(ctx, 0);
      x = lineStart = x0 + (ctx.rand() - 0.5) * 3;
      slope = (ctx.rand() - 0.5) * 0.008;
      continue;
    }
    if (w.text === " ") {
      if (x > x0) x += drawChar(ctx, " ", x, ctx.y, scale, false, false);
      continue;
    }
    const width = measure(ctx, w.text, scale);
    if (x + width > x1 && x > x0 + 4) {
      ctx.y += lineStep;
      ensureRoom(ctx, 0);
      x = lineStart = x0 + (ctx.rand() - 0.5) * 3;
      slope = (ctx.rand() - 0.5) * 0.008;
    }
    for (const ch of w.text) {
      ctx.drift = ctx.drift * 0.9 + (ctx.rand() - 0.5) * 0.6;
      const baseline = ctx.y + (x - lineStart) * slope + ctx.drift;
      x += drawChar(ctx, ch, x, baseline, scale, Boolean(w.bold), Boolean(w.italic));
    }
  }
}

function roughOpts(ctx: Ctx, extra: Record<string, unknown> = {}) {
  return { stroke: ctx.ink, strokeWidth: 1.25, roughness: 1.1, bowing: 1.2, seed: Math.floor(ctx.rand() * 2 ** 31), ...extra };
}

function drawTable(ctx: Ctx, t: Tokens.Table) {
  const header = t.header.map((h) => inlineRuns(h.tokens).map((r) => r.text).join(""));
  const rows = t.rows.map((r) => r.map((cell) => inlineRuns(cell.tokens).map((x) => x.text).join("")));
  const cols = header.length;
  const avail = PAGE_W - RIGHT - LEFT;
  const scale = 0.9;
  const natural = header.map((h, i) => Math.max(measure(ctx, h, scale), ...rows.map((r) => measure(ctx, r[i] ?? "", scale))) + 18);
  const total = natural.reduce((a, b) => a + b, 0);
  const widths = total <= avail ? natural : natural.map((w) => (w / total) * avail);
  const rowHeight = LINE;
  const allRows = [header, ...rows];
  ctx.y += 6;
  for (let r = 0; r < allRows.length; r++) {
    ensureRoom(ctx, rowHeight);
    const top = ctx.y - LINE + 8;
    let x = LEFT;
    const baseline = ctx.y;
    for (let ci = 0; ci < cols; ci++) {
      const text = allRows[r][ci] ?? "";
      const save = ctx.y;
      ctx.y = baseline;
      writeRuns(ctx, [{ text, bold: r === 0 }], { x0: x + 8, x1: x + widths[ci] - 6, scale });
      ctx.y = save;
      x += widths[ci];
    }
    const right = LEFT + widths.reduce((a, b) => a + b, 0);
    ctx.rc.line(LEFT, top, right, top, roughOpts(ctx));
    let vx = LEFT;
    for (let ci = 0; ci <= cols; ci++) {
      ctx.rc.line(vx, top, vx, top + rowHeight, roughOpts(ctx, { strokeWidth: 1.1 }));
      vx += widths[ci] ?? 0;
    }
    if (r === allRows.length - 1) ctx.rc.line(LEFT, top + rowHeight, right, top + rowHeight, roughOpts(ctx));
    ctx.y += rowHeight;
  }
  ctx.y += 4;
}

function drawChart(ctx: Ctx, raw: string) {
  let spec: { type?: string; title?: string; labels?: string[]; values?: number[] };
  try {
    spec = JSON.parse(raw);
  } catch {
    writeRuns(ctx, [{ text: raw }]);
    return;
  }
  const labels = (spec.labels ?? []).slice(0, 12).map(String);
  const values = (spec.values ?? []).slice(0, 12).map(Number);
  const height = LINE * 8;
  ensureRoom(ctx, height + LINE * 2);
  if (spec.title) {
    writeRuns(ctx, [{ text: spec.title, bold: true }]);
    ctx.y += LINE;
  }
  const top = ctx.y - LINE + 10;
  const left = LEFT + 30;
  const right = PAGE_W - RIGHT - 10;
  const bottom = top + height - LINE;
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));

  if (spec.type === "pie") {
    const cx = (left + right) / 2 - 80;
    const cy = top + height / 2 - 10;
    const r = Math.min(height / 2 - 14, 120);
    const sum = values.reduce((a, b) => a + Math.abs(b), 0) || 1;
    let a = -Math.PI / 2;
    values.forEach((v, i) => {
      const da = (Math.abs(v) / sum) * Math.PI * 2;
      ctx.rc.arc(cx, cy, r * 2, r * 2, a, a + da, true, roughOpts(ctx, { fill: ctx.ink, fillStyle: i % 2 ? "cross-hatch" : "hachure", hachureGap: 6 + (i % 3) * 3, fillWeight: 0.8 }));
      a += da;
    });
    let ly = top + 20;
    labels.forEach((l, i) => {
      const save = ctx.y;
      ctx.y = ly;
      writeRuns(ctx, [{ text: `${l}: ${values[i] ?? ""}` }], { x0: cx + r + 40, scale: 0.85 });
      ctx.y = save;
      ly += LINE * 0.85;
    });
  } else {
    ctx.rc.line(left, top, left, bottom, roughOpts(ctx));
    ctx.rc.line(left, bottom, right, bottom, roughOpts(ctx));
    const n = Math.max(1, values.length);
    const slot = (right - left) / n;
    const pts: [number, number][] = [];
    values.forEach((v, i) => {
      const h = (Math.abs(v) / max) * (bottom - top - 16);
      const x = left + slot * i + slot * 0.2;
      if (spec.type === "line") pts.push([left + slot * i + slot / 2, bottom - h]);
      else ctx.rc.rectangle(x, bottom - h, slot * 0.6, h, roughOpts(ctx, { fill: ctx.ink, fillStyle: "hachure", hachureGap: 6, fillWeight: 0.8 }));
      const save = ctx.y;
      ctx.y = bottom + LINE * 0.8;
      writeRuns(ctx, [{ text: labels[i] ?? "" }], { x0: left + slot * i + 4, x1: left + slot * (i + 1), scale: 0.72 });
      ctx.y = bottom - h - 6;
      writeRuns(ctx, [{ text: String(v) }], { x0: left + slot * i + slot * 0.3, x1: left + slot * (i + 1) + 20, scale: 0.7 });
      ctx.y = save;
    });
    if (pts.length > 1) {
      ctx.rc.linearPath(pts, roughOpts(ctx, { strokeWidth: 1.6 }));
      pts.forEach(([x, y]) => ctx.rc.circle(x, y, 7, roughOpts(ctx, { fill: ctx.ink, fillStyle: "solid" })));
    }
  }
  ctx.y = top + height + LINE;
}

function block(ctx: Ctx, t: Token, depth = 0) {
  const indent = LEFT + depth * 26;
  switch (t.type) {
    case "heading": {
      const h = t as Tokens.Heading;
      const scale = h.depth === 1 ? 1.45 : h.depth === 2 ? 1.25 : 1.1;
      ctx.y += h.depth === 1 ? LINE * 0.5 : LINE * 0.2;
      ensureRoom(ctx, LINE * scale);
      const startY = ctx.y;
      const runs = inlineRuns(h.tokens, { bold: h.depth <= 2 });
      writeRuns(ctx, runs, { scale });
      if (h.depth <= 2) {
        const w = Math.min(PAGE_W - RIGHT - LEFT, measure(ctx, runs.map((r) => r.text).join(""), scale) + 10);
        if (ctx.y === startY) ctx.rc.line(LEFT - 2, ctx.y + 7, LEFT + w, ctx.y + 6 + (ctx.rand() - 0.5) * 3, roughOpts(ctx, { strokeWidth: 1.4 }));
      }
      ctx.y += LINE * Math.ceil(scale);
      break;
    }
    case "paragraph":
      writeRuns(ctx, inlineRuns((t as Tokens.Paragraph).tokens), { x0: indent });
      ctx.y += LINE;
      break;
    case "text":
      writeRuns(ctx, inlineRuns((t as Tokens.Text).tokens ?? [t]), { x0: indent });
      ctx.y += LINE;
      break;
    case "list": {
      const l = t as Tokens.List;
      l.items.forEach((item, i) => {
        ensureRoom(ctx, LINE);
        const marker = l.ordered ? `${(Number(l.start) || 1) + i}.` : "";
        if (marker) {
          const save = ctx.y;
          writeRuns(ctx, [{ text: marker }], { x0: indent });
          ctx.y = save;
        } else {
          ctx.rc.circle(indent + 6, ctx.y - 7, 4.5, roughOpts(ctx, { fill: ctx.ink, fillStyle: "solid", roughness: 0.6 }));
        }
        const inner = item.tokens ?? [];
        let first = true;
        for (const sub of inner) {
          if (sub.type === "list") block(ctx, sub, depth + 1);
          else {
            const runs = inlineRuns(sub.type === "text" ? ((sub as Tokens.Text).tokens ?? [sub]) : ((sub as Tokens.Paragraph).tokens ?? []));
            if (!first) ctx.y += 0;
            writeRuns(ctx, runs, { x0: indent + 26 });
            ctx.y += LINE;
            first = false;
          }
        }
      });
      break;
    }
    case "blockquote": {
      const startY = ctx.y - LINE + 10;
      for (const sub of (t as Tokens.Blockquote).tokens) block(ctx, sub, depth + 1);
      ctx.rc.line(indent + 8, startY, indent + 8, ctx.y - LINE + 4, roughOpts(ctx));
      break;
    }
    case "table":
      drawTable(ctx, t as Tokens.Table);
      ctx.y += LINE * 0.5;
      break;
    case "code": {
      const code = t as Tokens.Code;
      if (code.lang === "chart") drawChart(ctx, code.text);
      else {
        for (const line of code.text.split("\n")) {
          writeRuns(ctx, [{ text: line }], { x0: indent + 16, scale: 0.92 });
          ctx.y += LINE;
        }
      }
      break;
    }
    case "hr":
      ensureRoom(ctx, LINE);
      ctx.rc.line(LEFT + 40, ctx.y - 10, PAGE_W - RIGHT - 40, ctx.y - 10 + (ctx.rand() - 0.5) * 4, roughOpts(ctx));
      ctx.y += LINE;
      break;
    case "space":
      break;
    default:
      if ("text" in t && typeof t.text === "string") {
        writeRuns(ctx, [{ text: decode(t.text) }], { x0: indent });
        ctx.y += LINE;
      }
  }
}

export async function renderHandwriting(
  markdown: string,
  atlas: Atlas | null,
  opts: { paper: Paper; ink: Ink; seed?: number; fallbackFont: string },
): Promise<HTMLCanvasElement[]> {
  const pages: HTMLCanvasElement[] = [];
  const holder = { pages, paper: opts.paper };
  const { c, rc } = newPage(holder);
  // Scale the writer's glyphs so capitals are about 60% of the ruling.
  const em = atlas ? (LINE * 0.6) / Math.max(0.2, atlas.capHeight) : LINE;
  const ctx: Ctx = {
    pages,
    c,
    rc,
    y: TOP + LINE - 3,
    rand: mulberry32(opts.seed ?? 7),
    ink: INK[opts.ink],
    atlas,
    em,
    fallbackFont: opts.fallbackFont,
    paper: opts.paper,
    tintCache: new Map(),
    drift: 0,
  };
  const tokens = marked.lexer(markdown.slice(0, 20000), { gfm: true });
  for (const t of tokens) block(ctx, t);
  return pages.slice(0, 12);
}

export const PAGE_SIZE = { width: PAGE_W, height: PAGE_H };
