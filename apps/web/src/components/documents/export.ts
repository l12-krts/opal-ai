"use client";
// Getting documents out: Markdown and CSV files, PNGs of charts and whiteboards, and printing
// (which is also how a doc or a deck becomes a PDF: the print dialog's "Save as PDF").
import { sheetToCsv, type SheetData } from "@/lib/documents";

export function fileName(title: string, ext: string) {
  const base = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "document";
  return `${base}.${ext}`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadMarkdown(title: string, markdown: string) {
  const body = markdown.trimStart().startsWith("# ") ? markdown : `# ${title}\n\n${markdown}`;
  downloadBlob(new Blob([body], { type: "text/markdown;charset=utf-8" }), fileName(title, "md"));
}

export function downloadCsv(title: string, sheet: SheetData) {
  // A BOM so Excel opens UTF-8 (Greek, €) correctly.
  downloadBlob(new Blob(["﻿", sheetToCsv(sheet)], { type: "text/csv;charset=utf-8" }), fileName(title, "csv"));
}

/** Draws an SVG (a chart or a whiteboard) onto a canvas and saves it as a PNG. */
export async function downloadSvgAsPng(svg: SVGSVGElement, title: string, opts: { scale?: number; padding?: number } = {}) {
  const pad = opts.padding ?? 24;
  const style = getComputedStyle(svg);
  const width = Number(svg.getAttribute("width")) || svg.clientWidth || svg.viewBox.baseVal.width;
  const height = Number(svg.getAttribute("height")) || svg.clientHeight || svg.viewBox.baseVal.height;
  // Big boards stay under the size browsers will draw.
  const scale = Math.min(opts.scale ?? 2, 6000 / (Math.max(width, height) + pad * 2));
  const root = getComputedStyle(document.documentElement);
  const bg = root.getPropertyValue("--krts-overlay").trim() || "#ffffff";

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  // currentColor and the overlay colour resolve here; the image can't see the page's CSS.
  clone.setAttribute("color", style.color || root.getPropertyValue("--krts-fg").trim() || "#1b1b1b");
  clone.style.setProperty("--krts-overlay", bg);
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Couldn't draw the image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil((width + pad * 2) * scale);
    canvas.height = Math.ceil((height + pad * 2) * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, pad * scale, pad * scale, width * scale, height * scale);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Couldn't make the PNG");
    downloadBlob(blob, fileName(title, "png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
