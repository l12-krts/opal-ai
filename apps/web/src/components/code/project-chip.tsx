import { cn } from "krts.ui";

// A small two-letter tile per project (T3 Code style), tinted from the name so each project
// keeps its colour everywhere.
const HUES = [205, 160, 260, 330, 28, 95, 185, 290];

function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2);
  return two.toUpperCase();
}

export function ProjectChip({ name, className }: { name: string; className?: string }) {
  const h = hue(name);
  return (
    <span
      aria-hidden="true"
      className={cn("inline-grid h-[16px] min-w-[18px] shrink-0 place-items-center rounded-[4px] px-[3px] font-mono text-[8.5px] font-semibold leading-none tracking-[0.02em]", className)}
      style={{ background: `oklch(0.72 0.09 ${h} / 0.18)`, color: `oklch(0.62 0.12 ${h})` }}
    >
      {initials(name)}
    </span>
  );
}
