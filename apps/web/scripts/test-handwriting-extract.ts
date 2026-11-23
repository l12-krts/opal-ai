// Synthetic end-to-end test for glyph extraction: fills the template with characters in a
// handwriting-ish font, rotates and pads it like a phone photo, runs the extractor, and writes
// a contact sheet of the glyphs it cut out.
//   npx tsx scripts/test-handwriting-extract.ts <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { cells, PAGE, templateSvg, writingBox } from "../src/lib/handwriting/template";
import { extractPage } from "../src/server/handwriting/extract";

const out = process.argv[2] ?? ".data/hw-test";
mkdirSync(out, { recursive: true });
const PX = 8; // px per mm for the fake scan (≈203 dpi)

async function filledPage(page: number) {
  let svg = templateSvg(page);
  const writing = cells()
    .filter((c) => c.page === page)
    .map((c) => {
      const b = writingBox(c);
      const esc = c.char.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const dx = c.variant ? 0.6 : -0.4;
      return `<text x="${b.x + b.w / 2 + dx}" y="${b.baseline}" font-family="Segoe Print, Comic Sans MS, cursive" font-size="8" text-anchor="middle" fill="#1b2a6b">${esc}</text>`;
    })
    .join("");
  svg = svg.replace("</svg>", `${writing}</svg>`);
  const png = await sharp(Buffer.from(svg), { density: 25.4 * PX }).resize(PAGE.w * PX).flatten({ background: "#fff" }).png().toBuffer();
  // Fake photo: slight rotation, darker paper, padding around the sheet.
  return sharp(png)
    .rotate(2.5, { background: "#6b6b6b" })
    .extend({ top: 120, bottom: 90, left: 70, right: 110, background: "#5a5a5a" })
    .modulate({ brightness: 0.93 })
    .jpeg({ quality: 82 })
    .toBuffer();
}

for (const page of [1, 2]) {
  const photo = await filledPage(page);
  writeFileSync(`${out}/photo-${page}.jpg`, photo);
  const t0 = Date.now();
  const r = await extractPage(photo, page);
  console.log(`page ${page}: markers=${r.markers} glyphs=${r.glyphs.length} missing=${r.missing.join("") || "-"} in ${Date.now() - t0}ms`);
  // Contact sheet
  const tiles = await Promise.all(
    r.glyphs.slice(0, 96).map(async (g) => ({
      input: await sharp(g.png).resize(60, 60, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer(),
    })),
  );
  const cols = 12;
  const sheet = sharp({ create: { width: cols * 64, height: Math.ceil(tiles.length / cols) * 64, channels: 4, background: "#ffffff" } }).composite(
    tiles.map((t, i) => ({ input: t.input, left: (i % cols) * 64 + 2, top: Math.floor(i / cols) * 64 + 2 })),
  );
  await sheet.png().toFile(`${out}/glyphs-${page}.png`);
}
