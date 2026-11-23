// Handwriting template: geometry shared by the printable sheet (SVG), the server-side extractor
// and the renderer. All units are millimetres on an A4 page.

export const PAGE = { w: 210, h: 297 };
export const MARKER = { size: 8, centers: [ [10, 10], [200, 10], [10, 287], [200, 287] ] as const };
export const GRID = { x: 15, y: 26, cols: 12, rows: 14, cellW: 15, cellH: 18 };
// Inside each cell: a label strip at the top, then the writing box with a baseline guide.
export const CELL = { label: 3.6, pad: 1.1, baseline: 0.68 }; // baseline as a fraction of the writing box height
export const VARIANTS = 2;

const LATIN_LOWER = "abcdefghijklmnopqrstuvwxyz";
const LATIN_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GREEK_LOWER = "αβγδεζηθικλμνξοπρσςτυφχψω";
const GREEK_UPPER = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ";
const GREEK_ACCENTED = "άέήίόύώϊϋΐΰ";
const DIGITS = "0123456789";
const PUNCT = ".,;:!?'\"()-+=/%&@#*€$<>[]_«»·";

export const CHARSET: string[] = [...GREEK_LOWER, ...GREEK_ACCENTED, ...LATIN_LOWER, ...GREEK_UPPER, ...LATIN_UPPER, ...DIGITS, ...PUNCT];

export type Cell = { page: number; index: number; char: string; variant: number; x: number; y: number };

/** Every cell on every page, in order. */
export function cells(): Cell[] {
  const perPage = GRID.cols * GRID.rows;
  const out: Cell[] = [];
  let n = 0;
  for (const char of CHARSET) {
    for (let v = 0; v < VARIANTS; v++) {
      const page = Math.floor(n / perPage) + 1;
      const i = n % perPage;
      const col = i % GRID.cols;
      const row = Math.floor(i / GRID.cols);
      out.push({ page, index: i, char, variant: v, x: GRID.x + col * GRID.cellW, y: GRID.y + row * GRID.cellH });
      n++;
    }
  }
  return out;
}

export const PAGE_COUNT = Math.ceil((CHARSET.length * VARIANTS) / (GRID.cols * GRID.rows));

/** The writing box of a cell (mm). */
export function writingBox(c: Pick<Cell, "x" | "y">) {
  const x = c.x + CELL.pad;
  const y = c.y + CELL.label + CELL.pad * 0.6;
  const w = GRID.cellW - CELL.pad * 2;
  const h = GRID.cellH - CELL.label - CELL.pad * 1.6;
  return { x, y, w, h, baseline: y + h * CELL.baseline };
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Printable SVG for one page. Guides are light blue so they drop out when the photo is read. */
export function templateSvg(page: number, name = ""): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w}mm" height="${PAGE.h}mm" viewBox="0 0 ${PAGE.w} ${PAGE.h}">`,
    `<rect width="${PAGE.w}" height="${PAGE.h}" fill="#ffffff"/>`,
  );
  for (const [cx, cy] of MARKER.centers) {
    parts.push(`<rect x="${cx - MARKER.size / 2}" y="${cy - MARKER.size / 2}" width="${MARKER.size}" height="${MARKER.size}" fill="#000"/>`);
  }
  parts.push(
    `<text x="${GRID.x}" y="17" font-family="Helvetica, Arial, sans-serif" font-size="4" fill="#9aa3ad">Opal Handwriting${name ? ` · ${esc(name)}` : ""} · page ${page} of ${PAGE_COUNT}</text>`,
    `<text x="${GRID.x}" y="22" font-family="Helvetica, Arial, sans-serif" font-size="2.8" fill="#aab2bb">Write the character shown in each box with a dark pen, resting on the dotted line. Keep the four black squares visible when you take the photo.</text>`,
  );
  for (const c of cells().filter((c) => c.page === page)) {
    const b = writingBox(c);
    parts.push(
      `<rect x="${c.x}" y="${c.y}" width="${GRID.cellW}" height="${GRID.cellH}" fill="none" stroke="#a8d4f5" stroke-width="0.25"/>`,
      `<line x1="${c.x}" y1="${c.y + CELL.label}" x2="${c.x + GRID.cellW}" y2="${c.y + CELL.label}" stroke="#cfe6f8" stroke-width="0.2"/>`,
      `<text x="${c.x + 1}" y="${c.y + 2.7}" font-family="Helvetica, Arial, sans-serif" font-size="2.6" fill="#9ccbee">${esc(c.char)}</text>`,
      `<line x1="${b.x}" y1="${b.baseline}" x2="${b.x + b.w}" y2="${b.baseline}" stroke="#a8d4f5" stroke-width="0.25" stroke-dasharray="0.8 0.8"/>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}
