"use client";
// A file an agent attached from its computer (share_file): a card in the chat that opens a viewer.
// Images, PDFs, text, audio and video show in place; anything else offers a download.

import { useEffect, useState } from "react";
import { Button, Modal, Dialog, cn } from "krts.ui";
import {
  IconAlertTriangle,
  IconDownload,
  IconFile,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconLoader2,
  IconMovie,
  IconMusic,
  IconPhoto,
  IconPresentation,
} from "@tabler/icons-react";

type SharedFileView = { id: string; name: string; mediaType: string; kind: "image" | "pdf" | "text" | "file"; size: number; url: string };
type Part = { state: string; input?: { path?: string; name?: string }; output?: { ok?: boolean; error?: string; file?: SharedFileView }; errorText?: string };

export function SharedFile({ part, streaming }: { part: Part; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const file = part.output?.file;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const name = file?.name ?? part.input?.name ?? part.input?.path?.split("/").pop() ?? "file";

  if (!file) {
    const failed = part.state === "output-error" || part.output?.ok === false;
    return (
      <div className="flex h-14 w-full max-w-[320px] items-center gap-3 rounded-[12px] border border-line-subtle bg-overlay py-2 pl-2 pr-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-surface text-fg-muted">
          {running && streaming ? <IconLoader2 size={17} stroke={1.5} className="animate-spin motion-reduce:animate-none" /> : failed ? <IconAlertTriangle size={17} stroke={1.5} className="text-danger" /> : <IconFile size={17} stroke={1.5} />}
        </span>
        <span className="min-w-0">
          <span className={cn("block truncate text-[13.5px]", running && streaming && "shimmer-text")}>{name}</span>
          <span className="block truncate text-[12px] text-fg-subtle">
            {failed ? (part.output?.error ?? part.errorText ?? "Couldn't attach the file") : running && streaming ? "Attaching…" : "Not attached"}
          </span>
        </span>
      </div>
    );
  }

  const Icon = iconFor(file);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable flex h-14 w-full max-w-[320px] items-center gap-3 rounded-[12px] border border-line-subtle bg-overlay py-2 pl-2 pr-3 text-left hover:bg-surface"
      >
        {file.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt="" className="size-10 shrink-0 rounded-[8px] object-cover" />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-surface text-fg-muted">
            <Icon size={18} stroke={1.5} />
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-[13.5px]">{file.name}</span>
          <span className="block truncate text-[12px] text-fg-subtle">
            {typeLabel(file)} · {formatSize(file.size)}
          </span>
        </span>
      </button>
      {open && <FileViewer file={file} onClose={() => setOpen(false)} />}
    </>
  );
}

function FileViewer({ file, onClose }: { file: SharedFileView; onClose: () => void }) {
  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} size="lg">
      <Dialog
        title={file.name}
        description={`${typeLabel(file)} · ${formatSize(file.size)}`}
        footer={(close) => (
          <>
            <Button size="sm" variant="ghost" onPress={close}>
              Close
            </Button>
            <Button size="sm" variant="primary" onPress={() => download(file)}>
              <IconDownload size={15} stroke={1.75} />
              Download
            </Button>
          </>
        )}
      >
        <Preview file={file} />
      </Dialog>
    </Modal>
  );
}

function Preview({ file }: { file: SharedFileView }) {
  const media = file.mediaType.startsWith("audio/") ? "audio" : file.mediaType.startsWith("video/") ? "video" : null;
  const svg = file.mediaType === "image/svg+xml";
  const wantsBlob = file.kind === "pdf" || media !== null || svg;
  const [blob, setBlob] = useState<string>();
  const [text, setText] = useState<string>();
  const [failed, setFailed] = useState(false);

  // The server sends everything but plain images as a download, so the viewer fetches the bytes
  // and shows them from a local URL with the right type.
  useEffect(() => {
    if (!wantsBlob && file.kind !== "text") return;
    let url: string | undefined;
    let cancelled = false;
    fetch(file.url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) return;
        if (svg || wantsBlob) {
          url = URL.createObjectURL(new Blob([buf], { type: file.mediaType }));
          setBlob(url);
        } else {
          setText(new TextDecoder().decode(buf));
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.url, file.mediaType, file.kind, svg, wantsBlob]);

  if (failed) return <p className="py-10 text-center text-[13.5px] text-fg-muted">Couldn&apos;t load the file.</p>;

  if (file.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={file.url} alt={file.name} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-[8px] object-contain" />;
  }
  if (file.kind === "file" && !media) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <span className="grid size-14 place-items-center rounded-[14px] bg-surface text-fg-muted">
          {(() => {
            const Icon = iconFor(file);
            return <Icon size={26} stroke={1.5} />;
          })()}
        </span>
        <p className="text-[13.5px] text-fg-muted">No preview for this kind of file. Download it to open it.</p>
      </div>
    );
  }
  if (!blob && text === undefined) {
    return (
      <div className="grid h-40 place-items-center text-fg-subtle">
        <IconLoader2 size={18} stroke={1.5} className="animate-spin motion-reduce:animate-none" />
      </div>
    );
  }
  if (svg && blob) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={blob} alt={file.name} className="mx-auto max-h-[70vh] w-auto max-w-full object-contain" />;
  }
  if (file.kind === "pdf" && blob) return <iframe src={blob} title={file.name} className="h-[70vh] w-full rounded-[8px] border border-line-subtle bg-white" />;
  if (media === "audio" && blob) return <audio src={blob} controls className="w-full" />;
  if (media === "video" && blob) return <video src={blob} controls className="max-h-[70vh] w-full rounded-[8px] bg-black" />;
  const rows = text !== undefined && (file.mediaType === "text/csv" || file.name.toLowerCase().endsWith(".csv")) ? parseCsv(text) : null;
  if (rows && rows.length > 0) {
    const [head, ...body] = rows;
    return (
      <div className="max-h-[70vh] overflow-auto rounded-[8px] border border-line-subtle">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead className="sticky top-0 bg-surface">
            <tr>
              {head.map((cell, i) => (
                <th key={i} className="whitespace-nowrap border-b border-line-subtle px-3 py-1.5 text-left font-medium">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="border-b border-line-subtle last:border-0">
                {head.map((_, c) => (
                  <td key={c} className="whitespace-nowrap px-3 py-1.5 text-fg/85">
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-code p-3 font-mono text-[12.5px] leading-5 text-fg/90">
      {text}
    </pre>
  );
}

/** A CSV as rows (quoted fields, doubled quotes and newlines in quotes), up to 2,000 rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < 2000; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function download(file: SharedFileView) {
  const a = document.createElement("a");
  a.href = file.url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function iconFor(file: SharedFileView) {
  const t = file.mediaType;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.kind === "image" || t === "image/svg+xml") return IconPhoto;
  if (file.kind === "pdf") return IconFileTypePdf;
  if (t.startsWith("audio/")) return IconMusic;
  if (t.startsWith("video/")) return IconMovie;
  if (["xlsx", "xls", "csv"].includes(ext)) return IconFileSpreadsheet;
  if (["pptx", "ppt", "key"].includes(ext)) return IconPresentation;
  if (["zip", "gz", "tar", "tgz", "7z"].includes(ext)) return IconFileZip;
  if (file.kind === "text" || ["docx", "doc"].includes(ext)) return IconFileText;
  return IconFile;
}

function typeLabel(file: SharedFileView) {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toUpperCase() : "";
  if (file.kind === "pdf") return "PDF";
  if (file.kind === "image") return ext || "Image";
  return ext || (file.kind === "text" ? "Text" : "File");
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
