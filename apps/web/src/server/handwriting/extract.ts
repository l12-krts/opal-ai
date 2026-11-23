// Reads a photo or scan of a filled-in template page and cuts out one glyph per cell.
//
// 1. Find the four black corner markers (connected components on a downscaled copy).
// 2. Fit a homography from template millimetres to image pixels.
// 3. For each cell, sample its writing box straight from the photo through the homography
//    (perspective correction without warping the whole image).
// 4. Separate ink from paper and from the light-blue guides, drop specks, crop, and store the
//    glyph as a black PNG whose alpha follows the ink density, plus its baseline metrics.
import sharp from "sharp";
import { cells, MARKER, PAGE, writingBox } from "@/lib/handwriting/template";

const R = 12; // samples per mm inside a cell
const DETECT_WIDTH = 800;

export type ExtractedGlyph = {
  char: string;
  variant: number;
  png: Buffer;
  width: number; // em
  height: number; // em
  baseline: number; // em from top of the glyph image
  advance: number; // em
};

export type ExtractResult = { glyphs: ExtractedGlyph[]; missing: string[]; markers: "detected" | "edges" };

type Pt = [number, number];

function solveHomography(src: Pt[], dst: Pt[]): number[] {
  // 8x8 linear system, Gaussian elimination with partial pivoting.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw new Error("Degenerate marker layout");
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * h[k];
    h[r] = s / A[r][r];
  }
  return h;
}

function project(h: number[], x: number, y: number): Pt {
  const d = h[6] * x + h[7] * y + 1;
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
}

function otsu(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 100;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

type Blob = { area: number; minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number };

function components(mask: Uint8Array, w: number, h: number, minArea = 1): Blob[] {
  const seen = new Uint8Array(w * h);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      const nb = [p - 1, p + 1, p - w, p + w];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (q < 0 || q >= w * h) continue;
        if (k === 0 && x === 0) continue;
        if (k === 1 && x === w - 1) continue;
        if (mask[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (area >= minArea) blobs.push({ area, minX, minY, maxX, maxY, cx: sx / area, cy: sy / area });
  }
  return blobs;
}

async function findMarkers(input: Buffer, fullW: number, fullH: number): Promise<Pt[] | null> {
  const { data, info } = await sharp(input).rotate().resize({ width: DETECT_WIDTH }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const gray = new Uint8Array(data.buffer, data.byteOffset, data.length);
  const t = Math.min(otsu(gray), 110);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] < t ? 1 : 0;
  const minSide = w * 0.012;
  const maxSide = w * 0.09;
  const candidates = components(mask, w, h, 20).filter((b) => {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const ratio = bw / bh;
    return bw > minSide && bw < maxSide && bh > minSide && bh < maxSide && ratio > 0.6 && ratio < 1.6 && b.area / (bw * bh) > 0.62;
  });
  const corners: Pt[] = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  const picked: Pt[] = [];
  for (const [kx, ky] of corners) {
    const inQuadrant = candidates.filter((b) => (kx === 0 ? b.cx < w / 2 : b.cx > w / 2) && (ky === 0 ? b.cy < h / 2 : b.cy > h / 2));
    if (!inQuadrant.length) return null;
    inQuadrant.sort((a, b) => Math.hypot(a.cx - kx, a.cy - ky) - Math.hypot(b.cx - kx, b.cy - ky));
    picked.push([inQuadrant[0].cx, inQuadrant[0].cy]);
  }
  const sx = fullW / w;
  const sy = fullH / h;
  return picked.map(([x, y]) => [x * sx, y * sy]);
}

type LabeledBlob = Blob & { label: number; meanDiff: number };

/** Connected components with per-blob mean darkness, plus a label image. */
function labelBlobs(mask: Uint8Array, diffs: Float32Array, w: number, h: number) {
  const labels = new Int32Array(w * h);
  const blobs: LabeledBlob[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    next++;
    let area = 0, sx = 0, sy = 0, sum = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    labels[i] = next;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      sx += x;
      sy += y;
      sum += diffs[p];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      // 8-connectivity so thin diagonal strokes stay in one piece.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = next;
            stack.push(q);
          }
        }
      }
    }
    blobs.push({ label: next, area, minX, minY, maxX, maxY, cx: sx / area, cy: sy / area, meanDiff: sum / area });
  }
  return { labels, blobs };
}

function neighbourKept(labels: Int32Array, keep: Set<number>, k: number, w: number, h: number) {
  const x = k % w;
  const y = (k - x) / w;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (keep.has(labels[ny * w + nx])) return true;
    }
  }
  return false;
}

export async function extractPage(input: Buffer, page: number): Promise<ExtractResult> {
  const base = sharp(input, { limitInputPixels: 60_000_000 }).rotate();
  const meta = await base.metadata();
  if (!meta.width || !meta.height) throw new Error("Not an image");
  const scale = Math.min(1, 3200 / Math.max(meta.width, meta.height));
  const { data, info } = await sharp(input, { limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: Math.round(meta.width * scale) })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const C = info.channels;

  let dst = await findMarkers(input, W, H);
  let markers: ExtractResult["markers"] = "detected";
  const src = MARKER.centers.map(([x, y]) => [x, y] as Pt);
  if (!dst) {
    // A flat scan without visible markers: assume the image is the page.
    markers = "edges";
    dst = src.map(([x, y]) => [(x / PAGE.w) * W, (y / PAGE.h) * H] as Pt);
  }
  const hm = solveHomography(src, dst);

  const sample = (x: number, y: number): [number, number, number] => {
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(H - 2, Math.floor(y)));
    const fx = Math.min(1, Math.max(0, x - x0));
    const fy = Math.min(1, Math.max(0, y - y0));
    const out: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const a = data[(y0 * W + x0) * C + c];
      const b = data[(y0 * W + x0 + 1) * C + c];
      const d = data[((y0 + 1) * W + x0) * C + c];
      const e = data[((y0 + 1) * W + x0 + 1) * C + c];
      out[c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy;
    }
    return out;
  };

  const glyphs: ExtractedGlyph[] = [];
  const missing: string[] = [];

  for (const cell of cells().filter((c) => c.page === page)) {
    const box = writingBox(cell);
    const cw = Math.round(box.w * R);
    const ch = Math.round(box.h * R);
    const lum = new Float32Array(cw * ch);
    const blueish = new Uint8Array(cw * ch);
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const [px, py] = project(hm, box.x + (i + 0.5) / R, box.y + (j + 0.5) / R);
        const [r, g, b] = sample(px, py);
        lum[j * cw + i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        blueish[j * cw + i] = b - r > 38 ? 1 : 0;
      }
    }
    // Paper brightness: a high percentile, so ink doesn't drag it down.
    const sorted = Float32Array.from(lum).sort();
    const paper = sorted[Math.floor(sorted.length * 0.85)];
    const darkest = sorted[Math.floor(sorted.length * 0.004)];
    const contrast = paper - darkest;
    // Nothing clearly darker than the paper: an empty box (guides alone are faint).
    if (contrast < 70) {
      if (cell.variant === 0) missing.push(cell.char);
      continue;
    }
    // Adaptive threshold: a fraction of this cell's own ink contrast. Faint guide lines,
    // whose colour JPEG compression often washes out, stay below it.
    const threshold = Math.max(40, contrast * 0.42);
    const diffs = new Float32Array(cw * ch);
    const mask = new Uint8Array(cw * ch);
    for (let k = 0; k < lum.length; k++) {
      const diff = paper - lum[k];
      diffs[k] = diff;
      if (blueish[k] && diff < contrast * 0.6) continue;
      if (diff > threshold) mask[k] = 1;
    }
    const { labels, blobs: all } = labelBlobs(mask, diffs, cw, ch);
    const strongest = Math.max(...all.map((b) => b.meanDiff), 1);
    const baselineY = (box.baseline - box.y) * R;
    const kept = all.filter((b) => {
      const bw = b.maxX - b.minX + 1;
      const bh = b.maxY - b.minY + 1;
      if (b.area < 10) return false;
      const touchesEdge = b.minX <= 1 || b.minY <= 1 || b.maxX >= cw - 2 || b.maxY >= ch - 2;
      // Remnants of the cell border: thin lines along an edge.
      if (touchesEdge && (bw <= 4 || bh <= 4)) return false;
      // Dashes of the baseline guide: short, flat, sitting on the baseline.
      if (bh <= R * 0.6 && bw <= R * 1.6 && Math.abs((b.minY + b.maxY) / 2 - baselineY) < R * 1.2 && b.meanDiff < strongest * 0.75) return false;
      // Much fainter than the writing itself (smudges, show-through, guides).
      if (b.meanDiff < strongest * 0.45) return false;
      return true;
    });
    if (!kept.length) {
      if (cell.variant === 0) missing.push(cell.char);
      continue;
    }
    const keep = new Set(kept.map((b) => b.label));
    let minX = cw;
    let minY = ch;
    let maxX = 0;
    let maxY = 0;
    for (const b of kept) {
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    const pad = 2;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(cw - 1, maxX + pad);
    maxY = Math.min(ch - 1, maxY + pad);
    const gw = maxX - minX + 1;
    const gh = maxY - minY + 1;
    const raw = Buffer.alloc(gw * gh * 2);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = (minY + j) * cw + (minX + i);
        const o = (j * gw + i) * 2;
        raw[o] = 0;
        // Alpha follows ink density so stroke edges stay soft, like real ink.
        const on = keep.has(labels[k]) || (diffs[k] > threshold * 0.6 && neighbourKept(labels, keep, k, cw, ch));
        raw[o + 1] = on ? Math.round(Math.min(1, Math.max(0, (diffs[k] - threshold * 0.5) / (contrast * 0.6))) * 255) : 0;
      }
    }
    const png = await sharp(raw, { raw: { width: gw, height: gh, channels: 2 } }).png({ compressionLevel: 9 }).toBuffer();
    const em = box.h * R;
    const baselinePx = (box.baseline - box.y) * R;
    glyphs.push({
      char: cell.char,
      variant: cell.variant,
      png,
      width: gw / em,
      height: gh / em,
      baseline: (baselinePx - minY) / em,
      advance: gw / em,
    });
  }
  return { glyphs, missing: [...new Set(missing)], markers };
}
