"use client";
// A document in the chat (a card with a preview), full screen (the viewer), and on paper.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import useSWR from "swr";
import { Dialog as RACDialog, Modal as RACModal, ModalOverlay } from "react-aria-components";
import { Button, Menu, MenuItem, MenuSeparator, MenuTrigger, Skeleton, cn, toast } from "krts.ui";
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconChalkboard,
  IconChartArea,
  IconChartBar,
  IconChartDonut,
  IconChartLine,
  IconChartPie,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconFileText,
  IconFocusCentered,
  IconMessage,
  IconNotes,
  IconPhoto,
  IconPlayerPlay,
  IconPresentation,
  IconPrinter,
  IconTable,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { fetcher } from "@/lib/api";
import {
  KIND_LABEL,
  colName,
  describeContent,
  evaluateSheet,
  formatCell,
  toSnapshot,
  type ChartData,
  type DocData,
  type DocKind,
  type DocSnapshot,
  type SheetData,
  type SlidesData,
  type WhiteboardData,
} from "@/lib/documents";
import { Markdown } from "../chat/parts/markdown";
import { IconButton } from "../ui";
import { downloadCsv, downloadMarkdown, downloadSvgAsPng } from "./export";
import { ChartView, SheetGrid, SlideView, WhiteboardCanvas, WhiteboardSvg, useSize } from "./views";

type IconType = typeof IconFileText;

export function kindIcon(kind: DocKind, data?: unknown): IconType {
  switch (kind) {
    case "doc":
      return IconFileText;
    case "slides":
      return IconPresentation;
    case "sheet":
      return IconTable;
    case "whiteboard":
      return IconChalkboard;
    case "chart": {
      const t = (data as ChartData | undefined)?.type;
      return t === "line" ? IconChartLine : t === "area" ? IconChartArea : t === "pie" ? IconChartPie : t === "donut" ? IconChartDonut : IconChartBar;
    }
  }
}

// ─── Preview ─────────────────────────────────────────────────────────────────

/** A glance at the document, for cards and the Documents page. Not interactive. */
export function DocPreview({ snap, height, svgRef }: { snap: DocSnapshot; height: number; svgRef?: React.Ref<SVGSVGElement> }) {
  switch (snap.kind) {
    case "doc": {
      const md = (snap.data as DocData).markdown;
      return (
        <div className="relative h-full overflow-hidden bg-overlay px-5 pt-4" aria-hidden>
          <div className="prose-opal pointer-events-none text-[13px] [&_h1]:text-[17px] [&_h2]:text-[15px]">
            <Markdown text={md.slice(0, 1600)} />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-overlay" />
        </div>
      );
    }
    case "slides": {
      const d = snap.data as SlidesData;
      return (
        <div className="flex h-full gap-2.5 overflow-hidden bg-surface/50 p-3" aria-hidden>
          {d.slides.slice(0, 6).map((s, i) => (
            <div key={i} className="h-full shrink-0 overflow-hidden rounded-[6px] shadow-sm ring-1 ring-line-subtle" style={{ aspectRatio: "16 / 9" }}>
              <SlideView slide={s} theme={d.theme} index={i} total={d.slides.length} />
            </div>
          ))}
          {!d.slides.length && <Skeleton className="h-full rounded-[6px]" style={{ aspectRatio: "16 / 9" }} />}
        </div>
      );
    }
    case "sheet":
      return (
        <div className="pointer-events-none h-full overflow-hidden bg-overlay" aria-hidden>
          <SheetGrid sheet={snap.data as SheetData} compact maxRows={Math.max(3, Math.floor((height - 34) / 29))} />
        </div>
      );
    case "chart":
      return (
        <div className="h-full bg-overlay px-3 pb-2 pt-3">
          <ChartView chart={snap.data as ChartData} height={height - 20} svgRef={svgRef} />
        </div>
      );
    case "whiteboard":
      return (
        <div
          className="h-full p-3 text-fg"
          aria-hidden
          style={{ backgroundImage: "radial-gradient(color-mix(in srgb, currentColor 13%, transparent) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
        >
          <WhiteboardSvg board={snap.data as WhiteboardData} svgRef={svgRef} className="size-full" />
        </div>
      );
  }
}

// ─── Exporting ───────────────────────────────────────────────────────────────

type Action = { id: string; label: string; icon: ReactNode; run: () => void | Promise<void> };

function slidesOutline(title: string, d: SlidesData) {
  return [
    `# ${title}`,
    ...d.slides.map((s, i) => {
      const parts = [`## ${i + 1}. ${s.title}`];
      if (s.subtitle) parts.push(`_${s.subtitle}_`);
      if (s.bullets?.length) parts.push(s.bullets.map((b) => `- ${b}`).join("\n"));
      if (s.body) parts.push(s.body);
      if (s.notes) parts.push(`> Notes: ${s.notes.replace(/\n/g, " ")}`);
      return parts.join("\n\n");
    }),
  ].join("\n\n");
}

function sheetTsv(d: SheetData) {
  const values = evaluateSheet(d);
  return [d.columns.map((c) => c.name).join("\t"), ...values.map((r) => r.map((v) => (v === null ? "" : String(v))).join("\t"))].join("\n");
}

function chartAsSheet(c: ChartData): SheetData {
  return {
    columns: [{ name: "Label", type: "text" }, ...c.series.map((s, i) => ({ name: s.name || `Series ${i + 1}`, type: "number" as const }))],
    rows: c.labels.map((l, i) => [l, ...c.series.map((s) => s.values[i] ?? null)]),
  };
}

const I = { size: 15, stroke: 1.5 } as const;

function actionsFor(snap: DocSnapshot, svg: () => SVGSVGElement | null, print: () => void): Action[] {
  const t = snap.title;
  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  };
  const png = async () => {
    const el = svg();
    if (!el) return;
    try {
      await downloadSvgAsPng(el, t);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  switch (snap.kind) {
    case "doc": {
      const md = (snap.data as DocData).markdown;
      return [
        { id: "md", label: "Download Markdown", icon: <IconDownload {...I} />, run: () => downloadMarkdown(t, md) },
        { id: "print", label: "Print or save as PDF", icon: <IconPrinter {...I} />, run: print },
        { id: "copy", label: "Copy Markdown", icon: <IconCopy {...I} />, run: () => copy(md, "Markdown") },
      ];
    }
    case "slides":
      return [
        { id: "print", label: "Print or save as PDF", icon: <IconPrinter {...I} />, run: print },
        { id: "md", label: "Download outline (Markdown)", icon: <IconDownload {...I} />, run: () => downloadMarkdown(t, slidesOutline(t, snap.data as SlidesData)) },
      ];
    case "sheet":
      return [
        { id: "csv", label: "Download CSV", icon: <IconDownload {...I} />, run: () => downloadCsv(t, snap.data as SheetData) },
        { id: "copy", label: "Copy as table", icon: <IconCopy {...I} />, run: () => copy(sheetTsv(snap.data as SheetData), "Table") },
      ];
    case "chart":
      return [
        { id: "png", label: "Download PNG", icon: <IconPhoto {...I} />, run: png },
        { id: "csv", label: "Download data (CSV)", icon: <IconDownload {...I} />, run: () => downloadCsv(t, chartAsSheet(snap.data as ChartData)) },
      ];
    case "whiteboard":
      return [{ id: "png", label: "Download PNG", icon: <IconPhoto {...I} />, run: png }];
  }
}

/** The download menu, and the print root while printing. */
function ExportMenu({ snap, svg, variant = "icon" }: { snap: DocSnapshot; svg: () => SVGSVGElement | null; variant?: "icon" | "button" }) {
  const [printing, setPrinting] = useState(false);
  const actions = actionsFor(snap, svg, () => setPrinting(true));
  return (
    <>
      <MenuTrigger>
        {variant === "icon" ? (
          <Button variant="ghost" size="sm" isIconOnly aria-label="Download or export" className="text-fg-muted hover:text-fg">
            <IconDownload size={17} stroke={1.5} />
          </Button>
        ) : (
          <Button variant="secondary" size="sm" startContent={<IconDownload size={15} stroke={1.5} />}>
            Export
          </Button>
        )}
        <Menu placement="bottom end" onAction={(key) => void actions.find((a) => a.id === key)?.run()}>
          {actions.map((a) => (
            <MenuItem key={a.id} id={a.id} icon={a.icon}>
              {a.label}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
      {printing && <PrintRoot snap={snap} onDone={() => setPrinting(false)} />}
    </>
  );
}

/** Renders the document for paper and opens the print dialog; gone again after. */
function PrintRoot({ snap, onDone }: { snap: DocSnapshot; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const after = () => done.current();
    window.addEventListener("afterprint", after);
    // Let the slides' images and the layout settle first.
    const t = setTimeout(() => {
      window.print();
      // Some browsers don't send afterprint; print() blocks until the dialog closes anyway.
      setTimeout(() => done.current(), 500);
    }, 400);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  let content: ReactNode = null;
  if (snap.kind === "doc") {
    const md = (snap.data as DocData).markdown;
    content = (
      <>
        <style>{"@page { size: A4; margin: 18mm 16mm; }"}</style>
        <article className="prose-opal" style={{ fontSize: "11.5pt" }}>
          {!/^\s*#\s/.test(md) && <h1>{snap.title}</h1>}
          <Markdown text={md} />
        </article>
      </>
    );
  } else if (snap.kind === "slides") {
    const d = snap.data as SlidesData;
    content = (
      <>
        <style>{"@page { size: 13.333in 7.5in; margin: 0; }"}</style>
        {d.slides.map((s, i) => (
          <div key={i} className="print-page overflow-hidden" style={{ width: "13.333in", height: "7.5in" }}>
            <SlideView slide={s} theme={d.theme} index={i} total={d.slides.length} className="h-full" />
          </div>
        ))}
      </>
    );
  }
  return createPortal(<div className="opal-print-root">{content}</div>, document.body);
}

// ─── Card ────────────────────────────────────────────────────────────────────

const PREVIEW_H = 188;

/** A document in the chat: a preview to open it full screen, its name, what's in it, and export. */
export function DocumentCard({ snap, building, conversationId }: { snap: DocSnapshot; building?: boolean; conversationId?: string }) {
  const [open, setOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const Icon = kindIcon(snap.kind, snap.data);
  const label = KIND_LABEL[snap.kind].one;
  return (
    <div className="w-full max-w-[640px] overflow-hidden rounded-card border border-line-subtle bg-overlay">
      {/* The preview may hold buttons of its own (a doc's tables), so the button sits over it. */}
      <div className="group relative w-full overflow-hidden" style={{ height: PREVIEW_H }}>
        <div className="pointer-events-none size-full" inert>
          <DocPreview snap={snap} height={PREVIEW_H} svgRef={svgRef} />
        </div>
        <button
          type="button"
          onClick={() => !building && setOpen(true)}
          aria-label={`Open ${snap.title || label}`}
          disabled={building}
          className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-line"
        />
        {!building && (
          <span className="pointer-events-none absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-overlay/90 text-fg-muted opacity-0 shadow-sm ring-1 ring-line-subtle transition-opacity duration-150 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <IconArrowsMaximize size={15} stroke={1.5} />
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-line-subtle py-2 pl-3 pr-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-surface text-fg-muted">
          <Icon size={18} stroke={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{snap.title || label}</p>
          <p className="truncate text-[12.5px] text-fg-muted">
            {building ? (
              <span className="shimmer-text">Writing {label.toLowerCase()}</span>
            ) : (
              <>
                {label} · {describeContent(snap.kind, snap.data)}
                {snap.version > 1 && ` · Version ${snap.version}`}
              </>
            )}
          </p>
        </div>
        {!building && (
          <>
            <ExportMenu snap={snap} svg={() => svgRef.current} />
            <Button size="sm" variant="secondary" onPress={() => setOpen(true)}>
              Open
            </Button>
          </>
        )}
      </div>
      {open && <DocumentViewer snap={snap} onClose={() => setOpen(false)} conversationId={conversationId} />}
    </div>
  );
}

// ─── Viewer ──────────────────────────────────────────────────────────────────

/**
 * Full screen. Opens on the version it was given; when the document has changed since, offers
 * the latest.
 */
export function DocumentViewer({ snap: given, onClose, conversationId, showChatLink }: { snap: DocSnapshot; onClose: () => void; conversationId?: string | null; showChatLink?: boolean }) {
  const { data } = useSWR<{ artifact: { id: string; kind: string; title: string; data: Record<string, unknown>; conversationId: string | null } }>(
    given.id ? `/api/artifacts/${given.id}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const latest = useMemo(() => (data ? toSnapshot(data.artifact) : null), [data]);
  const [useLatest, setUseLatest] = useState(false);
  const snap = useLatest && latest ? latest : given;
  const newer = latest && latest.version > given.version && !useLatest;
  const svgRef = useRef<SVGSVGElement>(null);
  const Icon = kindIcon(snap.kind, snap.data);
  const chatId = conversationId ?? data?.artifact.conversationId ?? null;

  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(o) => !o && onClose()}
      className="fixed inset-0 z-50 bg-black/35 transition-opacity duration-200 ease-out entering:opacity-0 exiting:opacity-0 exiting:duration-150"
    >
      <RACModal className="fixed inset-0 flex outline-none transition-[opacity,transform] duration-250 ease-out entering:scale-[0.985] entering:opacity-0 exiting:opacity-0 exiting:duration-150 motion-reduce:entering:scale-100 sm:inset-3">
        <RACDialog aria-label={snap.title} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg text-fg outline-none sm:rounded-[16px] sm:border sm:border-line-subtle sm:shadow-float">
          <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line-subtle pl-3 pr-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-surface text-fg-muted">
              <Icon size={17} stroke={1.5} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[14.5px] font-medium leading-5">{snap.title}</h2>
              <p className="truncate text-[12px] leading-4 text-fg-muted">
                {KIND_LABEL[snap.kind].one} · {describeContent(snap.kind, snap.data)} · Version {snap.version}
              </p>
            </div>
            {newer && (
              <Button size="xs" variant="secondary" onPress={() => setUseLatest(true)} className="max-sm:hidden">
                Show latest (version {latest!.version})
              </Button>
            )}
            {showChatLink && chatId && (
              <Link href={`/c/${chatId}`} onClick={onClose} className="pressable hidden h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-fg-muted hover:bg-surface hover:text-fg sm:flex">
                <IconMessage size={15} stroke={1.5} />
                Open chat
              </Link>
            )}
            <ExportMenu snap={snap} svg={() => svgRef.current} variant="button" />
            <IconButton label="Close" onPress={onClose} size="sm">
              <IconX size={17} stroke={1.5} />
            </IconButton>
          </header>
          {newer && (
            <button type="button" onClick={() => setUseLatest(true)} className="border-b border-line-subtle bg-surface/60 px-4 py-2 text-left text-[13px] text-fg-muted sm:hidden">
              This is version {given.version}. <span className="text-fg underline underline-offset-2">Show the latest (version {latest!.version})</span>
            </button>
          )}
          <div className="relative min-h-0 flex-1">
            <ViewerBody snap={snap} svgRef={svgRef} />
          </div>
        </RACDialog>
      </RACModal>
    </ModalOverlay>
  );
}

function ViewerBody({ snap, svgRef }: { snap: DocSnapshot; svgRef: React.RefObject<SVGSVGElement | null> }) {
  switch (snap.kind) {
    case "doc":
      return (
        <div className="absolute inset-0 overflow-y-auto">
          <article className="prose-opal mx-auto max-w-[760px] px-5 pb-24 pt-8 sm:px-8 sm:pt-12" style={{ fontSize: 16 }}>
            <Markdown text={(snap.data as DocData).markdown} />
          </article>
        </div>
      );
    case "slides":
      return <SlidesStage deck={snap.data as SlidesData} />;
    case "sheet":
      return <SheetStage sheet={snap.data as SheetData} />;
    case "chart": {
      const c = snap.data as ChartData;
      return (
        <div className="absolute inset-0 flex flex-col overflow-y-auto px-4 pb-6 pt-6 sm:px-10 sm:pt-10">
          <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col">
            <h3 className="mb-4 text-[18px] font-medium tracking-[-0.01em]">{snap.title}</h3>
            <ChartView chart={c} height="fill" svgRef={svgRef} className="min-h-[280px] flex-1" />
            {c.caption && <p className="mt-4 text-[13px] text-fg-muted">{c.caption}</p>}
          </div>
        </div>
      );
    }
    case "whiteboard":
      return (
        <div className="absolute inset-0">
          <WhiteboardCanvas
            board={snap.data as WhiteboardData}
            svgRef={svgRef}
            controls={({ zoom, fit, scale }) => (
              <div className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-full border border-line-subtle bg-overlay p-1 shadow-float" onPointerDown={(e) => e.stopPropagation()}>
                <IconButton label="Zoom out" onPress={() => zoom(1 / 1.25)}>
                  <IconZoomOut size={16} stroke={1.5} />
                </IconButton>
                <span className="w-11 text-center text-[12px] tabular-nums text-fg-muted">{Math.round(scale * 100)}%</span>
                <IconButton label="Zoom in" onPress={() => zoom(1.25)}>
                  <IconZoomIn size={16} stroke={1.5} />
                </IconButton>
                <IconButton label="Fit to screen" onPress={fit}>
                  <IconFocusCentered size={16} stroke={1.5} />
                </IconButton>
              </div>
            )}
          />
        </div>
      );
  }
}

// ─── Slides, full screen ─────────────────────────────────────────────────────

function SlidesStage({ deck }: { deck: SlidesData }) {
  const [i, setI] = useState(0);
  const [notes, setNotes] = useState(false);
  const [stageRef, stage] = useSize<HTMLDivElement>();
  const presentRef = useRef<HTMLDivElement>(null);
  const [presenting, setPresenting] = useState(false);
  const thumbs = useRef<HTMLDivElement>(null);
  const n = deck.slides.length;
  const idx = Math.min(i, Math.max(0, n - 1));
  const slide = deck.slides[idx];
  const go = (d: number) => setI((x) => Math.min(n - 1, Math.max(0, Math.min(x, n - 1) + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && presenting)) {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(n - 1);
    };
    const onFs = () => setPresenting(document.fullscreenElement === presentRef.current && !!presentRef.current);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  });

  useEffect(() => {
    thumbs.current?.querySelector(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [idx]);

  if (!slide) return <p className="p-8 text-[14px] text-fg-muted">No slides yet.</p>;
  const w = Math.max(0, Math.min(stage.width - 32, ((stage.height - 32) * 16) / 9));

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={stageRef} className="relative min-h-0 flex-1 bg-surface/40">
        <div className="absolute inset-0 grid place-items-center">
          <div style={{ width: w }} className="overflow-hidden rounded-[10px] shadow-float ring-1 ring-line-subtle">
            <SlideView slide={slide} theme={deck.theme} index={idx} total={n} />
          </div>
        </div>
        <div className="absolute inset-y-0 left-2 flex items-center">
          <IconButton label="Previous slide" onPress={() => go(-1)} isDisabled={idx === 0} className="size-9 rounded-full bg-overlay/80 shadow-sm">
            <IconChevronLeft size={18} stroke={1.5} />
          </IconButton>
        </div>
        <div className="absolute inset-y-0 right-2 flex items-center">
          <IconButton label="Next slide" onPress={() => go(1)} isDisabled={idx === n - 1} className="size-9 rounded-full bg-overlay/80 shadow-sm">
            <IconChevronRight size={18} stroke={1.5} />
          </IconButton>
        </div>
      </div>

      {notes && (
        <div className="max-h-[28%] shrink-0 overflow-y-auto border-t border-line-subtle px-5 py-3 text-[14px] leading-6">
          <p className="mb-1 text-[12px] font-medium text-fg-muted">Speaker notes</p>
          {slide.notes ? <p className="whitespace-pre-wrap">{slide.notes}</p> : <p className="text-fg-subtle">No notes on this slide.</p>}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-line-subtle py-2 pl-2 pr-3">
        <div ref={thumbs} className="flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-1">
          {deck.slides.map((s, j) => (
            <button
              key={j}
              type="button"
              data-i={j}
              onClick={() => setI(j)}
              aria-label={`Slide ${j + 1}: ${s.title}`}
              aria-current={j === idx}
              className={cn(
                "pressable w-[104px] shrink-0 overflow-hidden rounded-[6px] ring-1 transition-shadow",
                j === idx ? "ring-2 ring-accent-line" : "ring-line-subtle opacity-80 hover:opacity-100",
              )}
            >
              <SlideView slide={s} theme={deck.theme} />
            </button>
          ))}
        </div>
        <span className="shrink-0 text-[12.5px] tabular-nums text-fg-muted">
          {idx + 1} / {n}
        </span>
        <IconButton label={notes ? "Hide speaker notes" : "Show speaker notes"} onPress={() => setNotes((x) => !x)} className={cn(notes && "bg-surface text-fg")}>
          <IconNotes size={16} stroke={1.5} />
        </IconButton>
        <Button size="sm" variant="secondary" startContent={<IconPlayerPlay size={14} stroke={1.5} />} onPress={() => presentRef.current?.requestFullscreen?.()}>
          Present
        </Button>
      </div>

      {/* Presenting: the slide alone on a black screen. Click or → for the next one, Esc to stop. */}
      <div
        ref={presentRef}
        onClick={(e) => (e.clientX < window.innerWidth / 4 ? go(-1) : go(1))}
        className={cn("fixed inset-0 z-[60] place-items-center bg-black", presenting ? "grid" : "hidden")}
      >
        {presenting && (
          <div style={{ width: `min(100vw, ${(100 * 16) / 9}vh)` }}>
            <SlideView slide={slide} theme={deck.theme} index={idx} total={n} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sheets, full screen ─────────────────────────────────────────────────────

function SheetStage({ sheet }: { sheet: SheetData }) {
  const [sel, setSel] = useState<{ row: number; col: number } | null>(null);
  const values = useMemo(() => evaluateSheet(sheet), [sheet]);
  const raw = sel ? sheet.rows[sel.row]?.[sel.col] : null;
  const col = sel ? sheet.columns[sel.col] : null;
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line-subtle px-3 text-[13px]">
        <span className="w-12 shrink-0 rounded-[6px] bg-surface px-2 py-0.5 text-center font-mono text-[12px] text-fg-muted">{sel ? `${colName(sel.col)}${sel.row + 2}` : "–"}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
          {sel ? (
            typeof raw === "string" && raw.trim().startsWith("=") ? (
              <>
                {raw} <span className="text-fg-subtle">= {formatCell(values[sel.row]?.[sel.col] ?? null, col?.type ?? "text", sheet.currency)}</span>
              </>
            ) : (
              String(raw ?? "")
            )
          ) : (
            <span className="font-sans text-fg-subtle">Select a cell to see its value or formula</span>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <SheetGrid sheet={sheet} selected={sel} onSelect={setSel} />
      </div>
    </div>
  );
}

// ─── In the chat ─────────────────────────────────────────────────────────────

/** A failed create or update: a quiet line with the reason. */
export function DocumentError({ label, error }: { label: string; error?: string }) {
  return (
    <div className="flex items-start gap-2 text-[13.5px] text-fg-muted">
      <IconAlertTriangle size={15} stroke={1.5} className="mt-0.5 shrink-0 text-danger" />
      <span>
        {label}
        {error && <span className="text-fg-subtle">: {error}</span>}
      </span>
    </div>
  );
}
