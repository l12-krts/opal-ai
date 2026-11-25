"use client";
// How each kind of document looks: slides, sheets, charts, whiteboards (docs use the chat's
// Markdown). Used by the chat card, the full-screen viewer, printing and the Documents page.
// SVG content uses attributes and currentColor only (no CSS classes), so a chart or whiteboard
// exported as a PNG looks the same as on screen.
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "krts.ui";
import {
  CHART_COLORS,
  THEME_COLORS,
  WB_PALETTE,
  arrowPoints,
  boardBounds,
  colName,
  evaluateSheet,
  formatCell,
  isNumericColumn,
  niceTicks,
  shortNumber,
  type ChartData,
  type CellValue,
  type SheetData,
  type Slide,
  type SlideTheme,
  type WbItem,
  type WhiteboardData,
} from "@/lib/documents";

export const SVG_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

/** The width (and height) an element is laid out at, kept current. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// ─── Inline Markdown ─────────────────────────────────────────────────────────
// Bold, italic, code and https links, as React nodes (no HTML from the model reaches the page).

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] ?? m[3]) out.push(<strong key={k++}>{m[2] ?? m[3]}</strong>);
    else if (m[4] ?? m[5]) out.push(<em key={k++}>{m[4] ?? m[5]}</em>);
    else if (m[6]) out.push(<code key={k++} className="rounded-[4px] bg-black/5 px-1 font-mono text-[0.88em]">{m[6]}</code>);
    else if (m[7])
      out.push(
        <a key={k++} href={m[8]} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
          {m[7]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Paragraphs and simple lists, for slide bodies. */
export function MiniMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className={cn("flex flex-col gap-[0.6em]", className)}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const L = ordered ? "ol" : "ul";
          return (
            <L key={i} className={cn("flex flex-col gap-[0.3em] pl-[1.2em]", ordered ? "list-decimal" : "list-disc")}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>
              ))}
            </L>
          );
        }
        return <p key={i}>{inline(b.replace(/^#+\s*/, ""))}</p>;
      })}
    </div>
  );
}

// ─── Slides ──────────────────────────────────────────────────────────────────

/**
 * One 16:9 slide. Sizes are in container widths (cqw), so the same slide reads the same as a
 * thumbnail, in the chat and full screen.
 */
export function SlideView({ slide, theme, index, total, className }: { slide: Slide; theme: SlideTheme; index?: number; total?: number; className?: string }) {
  const c = THEME_COLORS[theme];
  const bullets = slide.bullets ?? [];
  return (
    <div
      className={cn("relative aspect-video w-full select-none overflow-hidden", className)}
      style={{ containerType: "inline-size", background: c.bg, color: c.fg, fontFamily: "var(--font-sans)" }}
    >
      {slide.layout === "title" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-[8cqw] text-center">
          <div style={{ width: "6cqw", height: "0.5cqw", background: c.accent, borderRadius: "1cqw", marginBottom: "3cqw" }} />
          <h2 style={{ fontSize: "5.6cqw", lineHeight: 1.1, fontWeight: 650, letterSpacing: "-0.02em" }}>{inline(slide.title)}</h2>
          {slide.subtitle && <p style={{ fontSize: "2.3cqw", marginTop: "2.2cqw", color: c.muted, lineHeight: 1.35 }}>{inline(slide.subtitle)}</p>}
        </div>
      )}

      {slide.layout === "section" && (
        <div className="absolute inset-0 flex flex-col justify-center px-[9cqw]">
          {index !== undefined && (
            <p style={{ fontSize: "2cqw", color: c.accent, fontWeight: 600, letterSpacing: "0.08em", marginBottom: "1.4cqw" }}>{String(index + 1).padStart(2, "0")}</p>
          )}
          <h2 style={{ fontSize: "5cqw", lineHeight: 1.1, fontWeight: 650, letterSpacing: "-0.02em" }}>{inline(slide.title)}</h2>
          {slide.subtitle && <p style={{ fontSize: "2.2cqw", marginTop: "1.8cqw", color: c.muted }}>{inline(slide.subtitle)}</p>}
        </div>
      )}

      {slide.layout === "quote" && (
        <div className="absolute inset-0 flex flex-col justify-center px-[11cqw]">
          <span aria-hidden style={{ fontSize: "12cqw", lineHeight: 0.6, color: c.accent, fontFamily: "Georgia, serif" }}>
            &ldquo;
          </span>
          <blockquote style={{ fontSize: "3.6cqw", lineHeight: 1.3, fontWeight: 500, marginTop: "1cqw", letterSpacing: "-0.01em" }}>
            {inline(slide.body || slide.title)}
          </blockquote>
          {(slide.subtitle || (slide.body && slide.title)) && (
            <p style={{ fontSize: "2cqw", marginTop: "2.4cqw", color: c.muted }}>{inline(slide.subtitle || slide.title)}</p>
          )}
        </div>
      )}

      {(slide.layout === "content" || slide.layout === "image") && (
        <div className="absolute inset-0 flex flex-col px-[6.5cqw] pb-[5cqw] pt-[5.5cqw]">
          <h2 style={{ fontSize: "3.5cqw", lineHeight: 1.15, fontWeight: 650, letterSpacing: "-0.015em" }}>{inline(slide.title)}</h2>
          {slide.subtitle && <p style={{ fontSize: "1.9cqw", marginTop: "0.8cqw", color: c.muted }}>{inline(slide.subtitle)}</p>}
          <div className="flex min-h-0 flex-1" style={{ gap: "4cqw", marginTop: "3cqw" }}>
            <div className="flex min-w-0 flex-1 flex-col" style={{ fontSize: "2.15cqw", lineHeight: 1.45, gap: "1.6cqw" }}>
              {bullets.length > 0 && (
                <ul className="flex flex-col" style={{ gap: "1.3cqw" }}>
                  {bullets.map((b, i) => (
                    <li key={i} className="flex" style={{ gap: "1.6cqw" }}>
                      <span aria-hidden style={{ flex: "none", width: "0.9cqw", height: "0.9cqw", marginTop: "1.05cqw", borderRadius: "50%", background: c.accent }} />
                      <span>{inline(b)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {slide.body && <MiniMarkdown text={slide.body} />}
            </div>
            {slide.layout === "image" && slide.image && (
              <div className="relative min-h-0 w-[42%] shrink-0 overflow-hidden" style={{ borderRadius: "1.4cqw", background: c.muted + "22" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slide.image} alt={slide.imageAlt ?? ""} className="absolute inset-0 size-full object-cover" referrerPolicy="no-referrer" />
              </div>
            )}
          </div>
        </div>
      )}

      {index !== undefined && total !== undefined && slide.layout !== "title" && (
        <span className="absolute tabular-nums" style={{ right: "3cqw", bottom: "2.4cqw", fontSize: "1.4cqw", color: c.muted }}>
          {index + 1}
        </span>
      )}
    </div>
  );
}

// ─── Sheets ──────────────────────────────────────────────────────────────────

export function SheetGrid({
  sheet,
  maxRows,
  compact,
  selected,
  onSelect,
}: {
  sheet: SheetData;
  maxRows?: number;
  compact?: boolean;
  selected?: { row: number; col: number } | null;
  onSelect?: (cell: { row: number; col: number }) => void;
}) {
  const values = useMemo(() => evaluateSheet(sheet), [sheet]);
  const rows = maxRows ? values.slice(0, maxRows) : values;
  const cell = compact ? "px-2.5 py-1.5" : "px-3 py-2";
  return (
    <table className={cn("border-separate border-spacing-0 tabular-nums", compact ? "text-[12.5px]" : "text-[13.5px]")}>
      <thead>
        {!compact && (
          <tr>
            <th className="sticky left-0 top-0 z-20 h-7 w-11 min-w-11 border-b border-r border-line-subtle bg-surface" />
            {sheet.columns.map((_, i) => (
              <th key={i} className="sticky top-0 z-10 h-7 border-b border-r border-line-subtle bg-surface px-3 text-center text-[11.5px] font-normal text-fg-subtle">
                {colName(i)}
              </th>
            ))}
          </tr>
        )}
        <tr>
          {!compact && (
            <th className="sticky left-0 z-20 border-b border-r border-line-subtle bg-surface text-center text-[11.5px] font-normal text-fg-subtle" style={{ top: 28 }}>
              1
            </th>
          )}
          {sheet.columns.map((c, i) => (
            <th
              key={i}
              className={cn(
                "z-10 whitespace-nowrap border-b border-line bg-overlay text-left font-medium",
                cell,
                !compact && "sticky border-r border-r-line-subtle",
                isNumericColumn(c.type) && "text-right",
              )}
              style={compact ? undefined : { top: 28 }}
            >
              {c.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r} className={cn(compact && r % 2 === 1 && "bg-surface/40")}>
            {!compact && (
              <td className="sticky left-0 z-[5] border-b border-r border-line-subtle bg-surface text-center text-[11.5px] text-fg-subtle">{r + 2}</td>
            )}
            {sheet.columns.map((c, ci) => {
              const v: CellValue = row[ci] ?? null;
              const raw = sheet.rows[r]?.[ci];
              const isFormula = typeof raw === "string" && raw.trim().startsWith("=");
              const err = typeof v === "string" && /^#[A-Z/0!?]+/.test(v);
              const isSel = selected?.row === r && selected?.col === ci;
              const numeric = isNumericColumn(c.type) || typeof v === "number";
              return (
                <td
                  key={ci}
                  onClick={onSelect ? () => onSelect({ row: r, col: ci }) : undefined}
                  className={cn(
                    "max-w-[320px] truncate border-b border-line-subtle",
                    cell,
                    !compact && "border-r",
                    numeric && "text-right",
                    isFormula && !compact && "bg-accent/10",
                    err && "text-danger",
                    onSelect && "cursor-cell",
                    isSel && "outline outline-2 -outline-offset-2 outline-accent-line",
                  )}
                >
                  {formatCell(v, c.type, sheet.currency)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Charts ──────────────────────────────────────────────────────────────────

type Hover = { i: number; x: number; y: number; slice?: number } | null;

function textWidth(s: string, size: number) {
  return measure(s, size, 400);
}

/** A chart drawn at the size it's given. `legend` adds the series key inside the drawing. */
export function ChartSvg({
  chart,
  width,
  height,
  svgRef,
  onHover,
}: {
  chart: ChartData;
  width: number;
  height: number;
  svgRef?: React.Ref<SVGSVGElement>;
  onHover?: (h: Hover) => void;
}) {
  if (width < 40 || height < 40) return null;
  const font = width < 420 ? 11 : 12;
  const series = chart.series.length ? chart.series : [{ name: "", values: [] }];
  const color = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
  const common = { width, height, viewBox: `0 0 ${width} ${height}`, ref: svgRef, fontFamily: SVG_FONT, fontSize: font, role: "img" as const };

  if (chart.type === "pie" || chart.type === "donut") {
    const vals = (series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const side = width >= 460;
    const legendW = side ? Math.min(220, width * 0.4) : 0;
    const legendRows = side ? 0 : Math.ceil(chart.labels.length / Math.max(1, Math.floor(width / 150)));
    const r = Math.max(10, Math.min((width - legendW) / 2, (height - legendRows * 20) / 2) - 10);
    const cx = (width - legendW) / 2;
    const cy = (height - legendRows * 20) / 2;
    const inner = chart.type === "donut" ? r * 0.58 : 0;
    let a0 = -Math.PI / 2;
    const perRow = Math.max(1, Math.floor(width / 150));
    return (
      <svg {...common} aria-label={chart.labels.map((l, i) => `${l}: ${vals[i]}`).join(", ")}>
        {vals.map((v, i) => {
          const a1 = a0 + (v / total) * Math.PI * 2;
          const start = a0;
          a0 = a1;
          if (v <= 0) return null;
          const large = a1 - start > Math.PI ? 1 : 0;
          const p = (ang: number, rad: number) => `${cx + Math.cos(ang) * rad},${cy + Math.sin(ang) * rad}`;
          const full = v / total > 0.9999;
          const d = full
            ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0${inner ? `M${cx - inner},${cy}a${inner},${inner} 0 1,1 ${inner * 2},0a${inner},${inner} 0 1,1 ${-inner * 2},0` : ""}`
            : inner
              ? `M${p(start, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}L${p(a1, inner)}A${inner},${inner} 0 ${large} 0 ${p(start, inner)}Z`
              : `M${cx},${cy}L${p(start, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}Z`;
          const mid = (start + a1) / 2;
          const lr = inner ? (r + inner) / 2 : r * 0.64;
          const pct = (v / total) * 100;
          return (
            <g key={i} onPointerEnter={() => onHover?.({ i, x: cx + Math.cos(mid) * lr, y: cy + Math.sin(mid) * lr, slice: i })} onPointerLeave={() => onHover?.(null)}>
              <path d={d} fill={color(i)} stroke="var(--krts-overlay, #fff)" strokeWidth={1.5} fillRule="evenodd" />
              {pct >= 6 && r > 60 && (
                <text x={cx + Math.cos(mid) * lr} y={cy + Math.sin(mid) * lr} textAnchor="middle" dominantBaseline="central" fill="#fff" fontWeight={600}>
                  {Math.round(pct)}%
                </text>
              )}
            </g>
          );
        })}
        {chart.labels.map((l, i) => {
          const x = side ? width - legendW + 8 : (i % perRow) * (width / perRow) + 8;
          const y = side ? cy - (chart.labels.length * 22) / 2 + i * 22 + 11 : height - legendRows * 20 + Math.floor(i / perRow) * 20 + 10;
          return (
            <g key={`l${i}`}>
              <rect x={x} y={y - 5} width={10} height={10} rx={3} fill={color(i)} />
              <text x={x + 16} y={y} dominantBaseline="central" fill="currentColor">
                {clip(l, side ? legendW - 30 : width / perRow - 30, font)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  const n = chart.labels.length;
  const stacked = !!chart.stacked && chart.type !== "line" && series.length > 1;
  // Value range.
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    if (stacked) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    } else {
      for (const s of series) {
        const v = s.values[i];
        if (v === null || v === undefined) continue;
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
    }
  }
  if (chart.type === "line" && series.every((s) => s.values.every((v) => v === null || v > 0))) {
    // Lines needn't start at zero.
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    if (all.length) {
      const min = Math.min(...all);
      const max = Math.max(...all);
      if (min > (max - min) * 1.5) lo = min - (max - min) * 0.1;
    }
  }
  const ticks = niceTicks(lo, hi, height < 220 ? 3 : 5);
  const t0 = ticks[0];
  const t1 = ticks[ticks.length - 1];
  const unit = chart.unit ?? "";
  const tickLabel = (v: number) => `${shortNumber(v)}${unit && unit.length <= 2 ? unit : ""}`;
  const legend = series.length > 1;
  const top = (legend ? 26 : 8) + 4;
  const horizontal = chart.type === "bar" && !!chart.horizontal;

  if (horizontal) {
    const labelW = Math.min(width * 0.32, Math.max(...chart.labels.map((l) => textWidth(l, font)), 20) + 12);
    const left = labelW + 8;
    const right = 16;
    const bottom = 24 + (chart.xLabel ? 16 : 0);
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const band = plotH / Math.max(1, n);
    const x = (v: number) => left + ((v - t0) / (t1 - t0 || 1)) * plotW;
    const bw = (band * 0.72) / (stacked ? 1 : series.length);
    return (
      <svg {...common} aria-label={describeChart(chart)} onPointerLeave={() => onHover?.(null)}>
        <Legend series={series} width={width} show={legend} font={font} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={top + plotH} stroke="currentColor" strokeOpacity={t === 0 ? 0.35 : 0.1} />
            <text x={x(t)} y={top + plotH + 16} textAnchor="middle" fill="currentColor" fillOpacity={0.6}>
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {chart.labels.map((l, i) => {
          const y0 = top + band * i;
          let acc = 0;
          return (
            <g key={i} onPointerEnter={() => onHover?.({ i, x: left + plotW / 2, y: y0 + band / 2 })}>
              <rect x={left} y={y0} width={plotW} height={band} fill="transparent" />
              <text x={left - 8} y={y0 + band / 2} textAnchor="end" dominantBaseline="central" fill="currentColor" fillOpacity={0.75}>
                {clip(l, labelW - 4, font)}
              </text>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const from = stacked ? acc : 0;
                if (stacked) acc += v;
                const a = x(from);
                const b = x(from + v);
                const yy = stacked ? y0 + band * 0.14 : y0 + band * 0.14 + bw * si;
                return <rect key={si} x={Math.min(a, b)} y={yy} width={Math.max(1, Math.abs(b - a))} height={Math.max(1, bw - 1)} rx={Math.min(3, bw / 3)} fill={color(si)} />;
              })}
            </g>
          );
        })}
        {chart.xLabel && (
          <text x={left + plotW / 2} y={height - 4} textAnchor="middle" fill="currentColor" fillOpacity={0.6}>
            {chart.xLabel}
          </text>
        )}
      </svg>
    );
  }

  const tickW = Math.max(...ticks.map((t) => textWidth(tickLabel(t), font)));
  const left = tickW + 12 + (chart.yLabel ? 18 : 0);
  const right = 12;
  const every = Math.max(1, Math.ceil((n * 56) / Math.max(1, width - left - right)));
  const bottom = 22 + (chart.xLabel ? 16 : 0);
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const band = plotW / Math.max(1, n);
  const y = (v: number) => top + plotH - ((v - t0) / (t1 - t0 || 1)) * plotH;
  const cxOf = (i: number) => left + band * (i + 0.5);
  const base = y(Math.max(t0, Math.min(0, t1)));

  return (
    <svg {...common} aria-label={describeChart(chart)} onPointerLeave={() => onHover?.(null)}>
      <Legend series={series} width={width} show={legend} font={font} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.35 : 0.1} />
          <text x={left - 8} y={y(t)} textAnchor="end" dominantBaseline="central" fill="currentColor" fillOpacity={0.6}>
            {tickLabel(t)}
          </text>
        </g>
      ))}
      {chart.labels.map((l, i) =>
        i % every === 0 ? (
          <text key={i} x={cxOf(i)} y={top + plotH + 15} textAnchor="middle" fill="currentColor" fillOpacity={0.65}>
            {clip(l, band * every - 6, font)}
          </text>
        ) : null,
      )}

      {chart.type === "bar" &&
        chart.labels.map((_, i) => {
          const group = band * 0.72;
          const bw = stacked ? group : group / series.length;
          let pos = 0;
          let neg = 0;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = s.values[i];
                if (v === null || v === undefined) return null;
                let a: number, b: number;
                if (stacked) {
                  const from = v >= 0 ? pos : neg;
                  if (v >= 0) pos += v;
                  else neg += v;
                  a = y(from);
                  b = y(from + v);
                } else {
                  a = base;
                  b = y(v);
                }
                const x0 = left + band * i + (band - group) / 2 + (stacked ? 0 : bw * si);
                return <rect key={si} x={x0} y={Math.min(a, b)} width={Math.max(1, bw - (stacked ? 0 : 1.5))} height={Math.max(1, Math.abs(b - a))} rx={Math.min(3, bw / 4)} fill={color(si)} />;
              })}
            </g>
          );
        })}

      {(chart.type === "line" || chart.type === "area") &&
        (() => {
          const cum = chart.labels.map(() => 0);
          return series.map((s, si) => {
            const pts = s.values.map((v, i) => {
              if (v === null || v === undefined) return null;
              const val = stacked ? (cum[i] += v) : v;
              return [cxOf(i), y(val)] as [number, number];
            });
            const runs: [number, number][][] = [];
            let cur: [number, number][] = [];
            pts.forEach((p) => {
              if (p) cur.push(p);
              else if (cur.length) {
                runs.push(cur);
                cur = [];
              }
            });
            if (cur.length) runs.push(cur);
            return (
              <g key={si}>
                {chart.type === "area" &&
                  runs.map((run, ri) => (
                    <path
                      key={ri}
                      d={`M${run[0][0]},${base}${run.map((p) => `L${p[0]},${p[1]}`).join("")}L${run[run.length - 1][0]},${base}Z`}
                      fill={color(si)}
                      fillOpacity={stacked ? 0.55 : 0.16}
                    />
                  ))}
                {runs.map((run, ri) => (
                  <path key={`l${ri}`} d={run.map((p, j) => `${j ? "L" : "M"}${p[0]},${p[1]}`).join("")} fill="none" stroke={color(si)} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {n <= 40 && pts.map((p, i) => (p ? <circle key={i} cx={p[0]} cy={p[1]} r={n <= 16 ? 3.2 : 2.2} fill={color(si)} /> : null))}
              </g>
            );
          });
        })()}

      {/* Hover targets, one per label. */}
      {onHover &&
        chart.labels.map((_, i) => (
          <rect key={`h${i}`} x={left + band * i} y={top} width={band} height={plotH} fill="transparent" onPointerEnter={() => onHover({ i, x: cxOf(i), y: top + 10 })} />
        ))}

      {chart.yLabel && (
        <text transform={`translate(12 ${top + plotH / 2}) rotate(-90)`} textAnchor="middle" fill="currentColor" fillOpacity={0.6}>
          {chart.yLabel}
        </text>
      )}
      {chart.xLabel && (
        <text x={left + plotW / 2} y={height - 4} textAnchor="middle" fill="currentColor" fillOpacity={0.6}>
          {chart.xLabel}
        </text>
      )}
    </svg>
  );
}

function Legend({ series, width, show, font }: { series: { name: string }[]; width: number; show: boolean; font: number }) {
  if (!show) return null;
  let x = 8;
  return (
    <g>
      {series.map((s, i) => {
        const w = textWidth(s.name, font) + 28;
        if (x + w > width) return null;
        const at = x;
        x += w;
        return (
          <g key={i}>
            <rect x={at} y={8} width={10} height={10} rx={3} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            <text x={at + 15} y={13} dominantBaseline="central" fill="currentColor" fillOpacity={0.8}>
              {s.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function describeChart(c: ChartData) {
  return `${c.type} chart: ${c.series.map((s) => `${s.name} ${s.values.join(", ")}`).join("; ")}`;
}

function clip(s: string, max: number, font: number) {
  if (max <= 0) return "";
  if (textWidth(s, font) <= max) return s;
  let out = s;
  while (out.length > 1 && textWidth(`${out}…`, font) > max) out = out.slice(0, -1);
  return `${out}…`;
}

/** A chart that fills its box, with a tooltip on hover. */
export function ChartView({ chart, height, svgRef, className }: { chart: ChartData; height: number | "fill"; svgRef?: React.Ref<SVGSVGElement>; className?: string }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Hover>(null);
  const h = height === "fill" ? size.height : height;
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${chart.unit ? ` ${chart.unit}` : ""}`);
  return (
    <div ref={ref} className={cn("relative w-full text-fg", className)} style={height === "fill" ? undefined : { height }}>
      <ChartSvg chart={chart} width={size.width} height={h} svgRef={svgRef} onHover={setHover} />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 min-w-[120px] -translate-x-1/2 rounded-[10px] border border-line-subtle bg-overlay px-2.5 py-1.5 text-[12px] shadow-float"
          style={{ left: Math.min(Math.max(hover.x, 70), size.width - 70), top: Math.max(0, hover.y - 8) }}
        >
          <p className="font-medium">{chart.labels[hover.i]}</p>
          {(hover.slice !== undefined ? chart.series.slice(0, 1) : chart.series).map((s, si) => (
            <p key={si} className="flex items-center gap-1.5 tabular-nums text-fg-muted">
              <span className="size-2 rounded-full" style={{ background: CHART_COLORS[(hover.slice ?? si) % CHART_COLORS.length] }} />
              {s.name && <span className="truncate">{s.name}</span>}
              <span className="ml-auto text-fg">{fmt(s.values[hover.i])}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Whiteboards ─────────────────────────────────────────────────────────────

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, size: number, weight: number) {
  if (typeof document === "undefined") return text.length * size * 0.55;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * size * 0.55;
  measureCtx.font = `${weight} ${size}px ${SVG_FONT}`;
  return measureCtx.measureText(text).width;
}

/** Breaks text into lines no wider than `max`. */
export function wrapText(text: string, max: number, size: number, weight = 400): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, size, weight) <= max) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // A word longer than the line breaks where it must.
      let w = word;
      while (measure(w, size, weight) > max && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && measure(w.slice(0, cut), size, weight) > max) cut--;
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

/** Text that fits a box: shrinks the font until the lines fit. */
function fitText(text: string, w: number, h: number, start: number, weight = 400) {
  let size = start;
  let lines = wrapText(text, w, size, weight);
  while (size > 10 && lines.length * size * 1.25 > h) {
    size -= 1;
    lines = wrapText(text, w, size, weight);
  }
  return { size, lines };
}

function TextLines({ lines, x, y, size, anchor = "middle", weight = 400, fill = "currentColor", lineHeight = 1.25 }: { lines: string[]; x: number; y: number; size: number; anchor?: "start" | "middle"; weight?: number; fill?: string; lineHeight?: number }) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} textAnchor={anchor} fill={fill}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? size * 0.9 : size * lineHeight}>
          {l || " "}
        </tspan>
      ))}
    </text>
  );
}

function smoothPath(points: [number, number][]) {
  if (points.length < 3) return points.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("");
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2;
    const my = (points[i][1] + points[i + 1][1]) / 2;
    d += `Q${points[i][0]},${points[i][1]} ${mx},${my}`;
  }
  const last = points[points.length - 1];
  return `${d}L${last[0]},${last[1]}`;
}

const NOTE_INK = "#1f1f1f";

function WbItemView({ it, byId, marker }: { it: WbItem; byId: Map<string, WbItem>; marker: string }) {
  const pal = it.color ? WB_PALETTE[it.color] : null;
  switch (it.type) {
    case "note": {
      const p = pal ?? WB_PALETTE.yellow;
      const { size, lines } = fitText(it.text ?? "", it.w - 24, it.h - 20, 17);
      const blockH = lines.length * size * 1.25;
      return (
        <g>
          <rect x={it.x + 2} y={it.y + 4} width={it.w} height={it.h} rx={6} fill="#000" fillOpacity={0.08} />
          <rect x={it.x} y={it.y} width={it.w} height={it.h} rx={6} fill={p.fill} />
          <TextLines lines={lines} x={it.x + it.w / 2} y={it.y + (it.h - blockH) / 2} size={size} fill={NOTE_INK} />
        </g>
      );
    }
    case "shape": {
      const fill = pal ? pal.fill : "none";
      const stroke = pal ? pal.ink : "currentColor";
      const inset = it.shape === "diamond" ? 0.25 : it.shape === "ellipse" ? 0.15 : 0.06;
      const { size, lines } = fitText(it.text ?? "", it.w * (1 - inset * 2) - 8, it.h * (1 - inset * 2), 16);
      const blockH = lines.length * size * 1.25;
      const shape =
        it.shape === "ellipse" ? (
          <ellipse cx={it.x + it.w / 2} cy={it.y + it.h / 2} rx={it.w / 2} ry={it.h / 2} fill={fill} stroke={stroke} strokeWidth={2} />
        ) : it.shape === "diamond" ? (
          <polygon
            points={`${it.x + it.w / 2},${it.y} ${it.x + it.w},${it.y + it.h / 2} ${it.x + it.w / 2},${it.y + it.h} ${it.x},${it.y + it.h / 2}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ) : (
          <rect x={it.x} y={it.y} width={it.w} height={it.h} rx={12} fill={fill} stroke={stroke} strokeWidth={2} />
        );
      return (
        <g>
          {shape}
          <TextLines lines={lines} x={it.x + it.w / 2} y={it.y + (it.h - blockH) / 2} size={size} fill={pal ? NOTE_INK : "currentColor"} />
        </g>
      );
    }
    case "text": {
      const size = it.size ?? 20;
      const weight = size >= 28 ? 650 : 400;
      const lines = wrapText(it.text ?? "", Math.max(it.w, size * 2), size, weight);
      return <TextLines lines={lines} x={it.x} y={it.y} size={size} anchor="start" weight={weight} fill={pal ? pal.ink : "currentColor"} />;
    }
    case "arrow": {
      const pts = arrowPoints(it, byId);
      if (!pts) return null;
      const stroke = pal ? pal.ink : "currentColor";
      const mid = pts[Math.floor((pts.length - 1) / 2)];
      const next = pts[Math.min(pts.length - 1, Math.floor((pts.length - 1) / 2) + 1)];
      return (
        <g color={stroke}>
          <path
            d={pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("")}
            fill="none"
            stroke="currentColor"
            strokeOpacity={pal ? 1 : 0.7}
            strokeWidth={2}
            strokeDasharray={it.dashed ? "7 6" : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd={`url(#${marker})`}
          />
          {it.text && (
            <text x={(mid[0] + next[0]) / 2} y={(mid[1] + next[1]) / 2 - 8} textAnchor="middle" fontSize={13} fill="currentColor" fillOpacity={0.8}>
              {it.text}
            </text>
          )}
        </g>
      );
    }
    case "stroke":
      return (
        <path
          d={smoothPath(it.points ?? [])}
          fill="none"
          stroke={pal ? pal.ink : "currentColor"}
          strokeWidth={it.width ?? 3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
  }
}

/** The board's drawing, in board coordinates. */
export function WhiteboardItems({ board }: { board: WhiteboardData }) {
  const marker = `wb-arrow-${useId().replace(/:/g, "")}`;
  const byId = useMemo(() => new Map(board.items.map((i) => [i.id, i])), [board.items]);
  // Arrows under everything else, text on top.
  const order = { stroke: 0, arrow: 1, shape: 2, note: 3, text: 4 } as const;
  const items = [...board.items].sort((a, b) => order[a.type] - order[b.type]);
  return (
    <>
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX={8} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M1,1 L9,5 L1,9 Z" fill="currentColor" />
        </marker>
      </defs>
      {items.map((it) => (
        <WbItemView key={it.id} it={it} byId={byId} marker={marker} />
      ))}
    </>
  );
}

/** The whole board, fitted to the box. */
export function WhiteboardSvg({ board, svgRef, className }: { board: WhiteboardData; svgRef?: React.Ref<SVGSVGElement>; className?: string }) {
  const b = boardBounds(board.items);
  return (
    <svg ref={svgRef} viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} width={b.w} height={b.h} className={className} fontFamily={SVG_FONT} preserveAspectRatio="xMidYMid meet" role="img" aria-label={board.items.map((i) => i.text).filter(Boolean).join(", ")}>
      <WhiteboardItems board={board} />
    </svg>
  );
}

/** The board you can pan (drag, scroll) and zoom (pinch, ctrl+scroll, buttons). */
export function WhiteboardCanvas({ board, svgRef, controls }: { board: WhiteboardData; svgRef?: React.Ref<SVGSVGElement>; controls?: (api: { zoom: (f: number) => void; fit: () => void; scale: number }) => ReactNode }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const bounds = useMemo(() => boardBounds(board.items), [board.items]);
  const [view, setView] = useState<{ x: number; y: number; k: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);

  const fitView = useMemo(() => {
    if (!size.width || !size.height) return { x: 0, y: 0, k: 1 };
    const k = Math.min(size.width / bounds.w, size.height / bounds.h, 1.6);
    return { k, x: (size.width - bounds.w * k) / 2 - bounds.x * k, y: (size.height - bounds.h * k) / 2 - bounds.y * k };
  }, [size.width, size.height, bounds]);
  const v = view ?? fitView;

  const zoomAt = (f: number, px: number, py: number) =>
    setView((cur) => {
      const c = cur ?? fitView;
      const k = Math.min(6, Math.max(0.1, c.k * f));
      return { k, x: px - ((px - c.x) * k) / c.k, y: py - ((py - c.y) * k) / c.k };
    });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Non-passive, so scrolling the board doesn't scroll the page.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((cur) => ({ ...(cur ?? fitView), x: (cur ?? fitView).x - e.deltaX, y: (cur ?? fitView).y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  return (
    <div
      ref={ref}
      className="relative size-full touch-none overflow-hidden text-fg"
      style={{ cursor: pointers.current.size ? "grabbing" : "grab", backgroundImage: "radial-gradient(color-mix(in srgb, currentColor 14%, transparent) 1px, transparent 1px)", backgroundSize: `${22 * v.k}px ${22 * v.k}px`, backgroundPosition: `${v.x}px ${v.y}px` }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: v.k };
        }
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        const now = { x: e.clientX, y: e.clientY };
        pointers.current.set(e.pointerId, now);
        if (pointers.current.size === 2 && pinch.current) {
          const [a, b] = [...pointers.current.values()];
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const target = (pinch.current.k * d) / pinch.current.d;
          zoomAt(target / v.k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        } else if (pointers.current.size === 1) {
          setView((cur) => ({ ...(cur ?? fitView), x: (cur ?? fitView).x + now.x - prev.x, y: (cur ?? fitView).y + now.y - prev.y }));
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
      }}
      onDoubleClick={() => setView(null)}
    >
      <svg width={size.width} height={size.height} fontFamily={SVG_FONT} className="block">
        <g transform={`translate(${v.x} ${v.y}) scale(${v.k})`}>
          <WhiteboardItems board={board} />
        </g>
      </svg>
      {/* Hidden full drawing, for exporting. */}
      <div className="hidden">
        <WhiteboardSvg board={board} svgRef={svgRef} />
      </div>
      {controls?.({
        zoom: (f) => zoomAt(f, size.width / 2, size.height / 2),
        fit: () => setView(null),
        scale: v.k,
      })}
    </div>
  );
}

// Re-exported for the card's previews.
export { Fragment };
