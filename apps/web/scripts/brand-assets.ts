// Builds every logo file from lib/brand-paths.ts: the brand kit in /brand, the web favicon and
// Apple touch icon, the desktop source icon, and the iOS app icons (light, dark, tinted).
//   npx tsx scripts/brand-assets.ts            (then: cd ../desktop && npx tauri icon icon-1024.png)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { BRAND, MARK_PATH, WORDMARK_PATH, WORDMARK_VIEWBOX } from "../src/lib/brand-paths";

const root = resolve(process.cwd(), "../..");
const out = (rel: string) => {
  const p = resolve(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  return p;
};

const MARK = 240;

function markSvg(fill: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK} ${MARK}"><path fill="${fill}" fill-rule="evenodd" d="${MARK_PATH}"/></svg>\n`;
}

function wordmarkSvg(fill: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${WORDMARK_VIEWBOX}"><path fill="${fill}" fill-rule="evenodd" d="${WORDMARK_PATH}"/></svg>\n`;
}

/**
 * A square icon: background tile, mark centred at `markRatio` of the tile.
 * `inset` leaves a transparent margin (macOS style); `radius` rounds the tile (0 = full bleed).
 */
function iconSvg({
  size = 1024,
  bg,
  fg,
  markRatio = 0.5,
  inset = 0,
  radius = 0,
}: {
  size?: number;
  bg: string | null;
  fg: string;
  markRatio?: number;
  inset?: number;
  radius?: number;
}) {
  const tile = size - inset * 2;
  const mark = tile * markRatio;
  const k = mark / MARK;
  const off = inset + (tile - mark) / 2;
  const rect = bg ? `<rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" rx="${radius}" fill="${bg}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${rect}<path transform="translate(${off} ${off}) scale(${k})" fill="${fg}" fill-rule="evenodd" d="${MARK_PATH}"/></svg>\n`;
}

async function png(svg: string, file: string, width: number, opts: { opaque?: string } = {}) {
  let img = sharp(Buffer.from(svg), { density: 300 }).resize({ width });
  if (opts.opaque) img = img.flatten({ background: opts.opaque }).removeAlpha();
  await img.png({ compressionLevel: 9 }).toFile(out(file));
}

function write(file: string, text: string) {
  writeFileSync(out(file), text);
}

async function main() {
  // ── Brand kit ──
  const appIcon = iconSvg({ bg: BRAND.night, fg: BRAND.white, radius: 230 });
  const appIconLight = iconSvg({ bg: BRAND.paper, fg: BRAND.ink, radius: 230 });
  write("brand/opal-mark.svg", markSvg(BRAND.ink));
  write("brand/opal-mark-white.svg", markSvg(BRAND.white));
  write("brand/opal-wordmark.svg", wordmarkSvg(BRAND.ink));
  write("brand/opal-wordmark-white.svg", wordmarkSvg(BRAND.white));
  write("brand/opal-app-icon.svg", appIcon);
  write("brand/opal-app-icon-light.svg", appIconLight);
  await png(markSvg(BRAND.ink), "brand/png/opal-mark-512.png", 512);
  await png(markSvg(BRAND.white), "brand/png/opal-mark-white-512.png", 512);
  await png(wordmarkSvg(BRAND.ink), "brand/png/opal-wordmark-1200.png", 1200);
  await png(wordmarkSvg(BRAND.white), "brand/png/opal-wordmark-white-1200.png", 1200);
  await png(appIcon, "brand/png/opal-app-icon-1024.png", 1024);
  await png(appIconLight, "brand/png/opal-app-icon-light-1024.png", 1024);

  // ── Web ── favicon: bigger mark so it reads at 16 px. Touch icon: full bleed, iOS rounds it.
  write("apps/web/src/app/icon.svg", iconSvg({ size: 64, bg: BRAND.night, fg: BRAND.white, markRatio: 0.62, radius: 14 }));
  await png(iconSvg({ bg: BRAND.night, fg: BRAND.white }), "apps/web/src/app/apple-icon.png", 180, { opaque: BRAND.night });

  // ── Desktop ── macOS-style tile with a margin; `tauri icon` makes .ico/.icns/PNGs from it.
  await png(iconSvg({ bg: BRAND.night, fg: BRAND.white, inset: 100, radius: 185 }), "apps/desktop/icon-1024.png", 1024);

  // ── iOS ── light (opaque, no alpha), dark (transparent, system background), tinted (grayscale).
  const ios = "apps/ios/Opal/Assets.xcassets/AppIcon.appiconset";
  await png(iconSvg({ bg: BRAND.night, fg: BRAND.white }), `${ios}/icon-1024.png`, 1024, { opaque: BRAND.night });
  await png(iconSvg({ bg: null, fg: BRAND.white }), `${ios}/icon-1024-dark.png`, 1024);
  await png(iconSvg({ bg: "#000000", fg: "#ffffff" }), `${ios}/icon-1024-tinted.png`, 1024, { opaque: "#000000" });
  write(
    `${ios}/Contents.json`,
    `${JSON.stringify(
      {
        images: [
          { filename: "icon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" },
          { appearances: [{ appearance: "luminosity", value: "dark" }], filename: "icon-1024-dark.png", idiom: "universal", platform: "ios", size: "1024x1024" },
          { appearances: [{ appearance: "luminosity", value: "tinted" }], filename: "icon-1024-tinted.png", idiom: "universal", platform: "ios", size: "1024x1024" },
        ],
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    )}\n`,
  );

  console.log("Brand assets written.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
