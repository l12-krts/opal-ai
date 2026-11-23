"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Button, Skeleton } from "krts.ui";
import { IconDownload, IconPrinter } from "@tabler/icons-react";
import { fetcher } from "@/lib/api";
import { loadAtlas, renderHandwriting, type Atlas, type GlyphData, type Ink, type Paper } from "@/lib/handwriting/render";

const atlasCache = new Map<string, Promise<Atlas>>();

function handFamily() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-hand").trim();
  return v || "cursive";
}

export function HandwritingView({
  markdown,
  profileId,
  paper,
  ink,
  title,
  compact,
}: {
  markdown: string;
  profileId: string | null;
  paper: Paper;
  ink: Ink;
  title?: string;
  compact?: boolean;
}) {
  const { data, error } = useSWR<{ glyphs: GlyphData[] }>(profileId ? `/api/handwriting/profiles/${profileId}` : null, fetcher, {
    revalidateOnFocus: false,
  });
  const holder = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<HTMLCanvasElement[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (profileId && !data && !error) return;
      setBusy(true);
      const family = handFamily();
      await document.fonts.load(`24px ${family}`).catch(() => {});
      let atlas: Atlas | null = null;
      if (profileId && data?.glyphs.length) {
        let p = atlasCache.get(profileId);
        if (!p) {
          p = loadAtlas(data.glyphs);
          atlasCache.set(profileId, p);
        }
        atlas = await p;
      }
      const out = await renderHandwriting(markdown, atlas, { paper, ink, fallbackFont: family, seed: hash(markdown) });
      if (!cancelled) {
        setPages(out);
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [markdown, profileId, paper, ink, data, error]);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    el.replaceChildren(
      ...pages.map((cv) => {
        cv.style.width = "100%";
        cv.style.height = "auto";
        cv.className = "rounded-[6px] border border-line-subtle shadow-control";
        return cv;
      }),
    );
  }, [pages]);

  function download() {
    pages.forEach((cv, i) => {
      const a = document.createElement("a");
      a.download = `${(title ?? "handwriting").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 40) || "handwriting"}-${i + 1}.png`;
      a.href = cv.toDataURL("image/png");
      a.click();
    });
  }

  function print() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.title = title ?? "Handwriting";
    const style = w.document.createElement("style");
    style.textContent = "@page{size:A4;margin:0}body{margin:0}img{width:210mm;height:297mm;display:block;page-break-after:always}";
    w.document.head.appendChild(style);
    for (const cv of pages) {
      const img = w.document.createElement("img");
      img.src = cv.toDataURL("image/png");
      w.document.body.appendChild(img);
    }
    setTimeout(() => w.print(), 300);
  }

  return (
    <div className="flex flex-col gap-2">
      {busy && <Skeleton className={compact ? "aspect-[210/297] w-full max-w-[380px] rounded-[6px]" : "aspect-[210/297] w-full rounded-[6px]"} />}
      <div ref={holder} className={compact ? "flex max-w-[380px] flex-col gap-3" : "flex flex-col gap-4"} hidden={busy} />
      {!busy && pages.length > 0 && (
        <div className="flex gap-1.5">
          <Button size="xs" variant="secondary" startContent={<IconDownload size={14} stroke={1.5} />} onPress={download}>
            Download
          </Button>
          <Button size="xs" variant="ghost" startContent={<IconPrinter size={14} stroke={1.5} />} onPress={print}>
            Print
          </Button>
        </div>
      )}
    </div>
  );
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
