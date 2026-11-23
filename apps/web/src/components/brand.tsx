// Opal brand marks. Geometry lives in lib/brand-paths so the app icons are built from the same
// source (scripts/brand-assets.ts).
import type { SVGProps } from "react";
import { MARK_PATH, MARK_VIEWBOX, WORDMARK_PATH, WORDMARK_SIZE, WORDMARK_VIEWBOX } from "@/lib/brand-paths";

/** The "o" mark. */
export function OpalMark({ size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} aria-hidden="true" {...props}>
      <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}

/** The mark and "Opal". `height` is the full height including the descender of the "p"; the mark is 240/243 of it. */
export function OpalWordmark({ height = 22, ...props }: SVGProps<SVGSVGElement> & { height?: number }) {
  const width = (height * WORDMARK_SIZE.width) / WORDMARK_SIZE.height;
  return (
    <svg width={width} height={height} viewBox={WORDMARK_VIEWBOX} role="img" aria-label="Opal" {...props}>
      <path fill="currentColor" fillRule="evenodd" d={WORDMARK_PATH} />
    </svg>
  );
}

/** "Opal Code": the wordmark with "Code" set in Allo, a little lighter and washed out. */
export function OpalCodeWordmark({ height = 20, className }: { height?: number; className?: string }) {
  // Cap height of the drawn "Opal" letters is ~165/243 of the wordmark height; Allo's is ~0.7em.
  const fontSize = ((height * 165) / 243 / 0.7) -1.5;
  return (
    <span className={`inline-flex items-end ${className ?? ""}`} role="img" aria-label="Opal Code">
      <OpalWordmark height={height} aria-hidden="true" role={undefined} aria-label={undefined} />
      <span
        aria-hidden="true"
        className="font-Allo leading-none tracking-[-0.01em] text-current opacity-45 [font-variation-settings:'opsz'_32,'ROND'_0]"
        style={{ fontSize, fontWeight: 420, marginLeft: height * 0.20, marginBottom: (height * (243 - 227.4)) / 243 - fontSize * 0.04 }}
      >
        Code
      </span>
    </span>
  );
}
