"use client";

import { cn } from "krts.ui";
import { IconAlertTriangle, IconClipboardText, IconFileText, IconFileTypePdf, IconLoader2, IconX } from "@tabler/icons-react";
import { t } from "@/lib/i18n";
import type { Attachment } from "./use-attachments";

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={t("composer.remove", { name })}
      // Always visible: touch screens have no hover. A larger invisible hit area sits around it.
      className="pressable absolute -right-1.5 -top-1.5 z-10 grid size-5 place-items-center rounded-full bg-fg text-bg shadow-control before:absolute before:-inset-2 before:content-['']"
    >
      <IconX size={11} stroke={2.25} />
    </button>
  );
}

export function AttachmentChips({ items, onRemove }: { items: Attachment[]; onRemove: (key: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Attachments">
      {items.map((a) => (
        <li key={a.key} className="opal-pop relative">
          {a.kind === "image" && a.previewUrl ? (
            <div
              className={cn(
                "relative size-14 overflow-hidden rounded-[12px] border",
                a.status === "error" ? "border-danger" : "border-line-subtle",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.previewUrl}
                alt={a.name}
                className={cn("size-full object-cover transition-opacity duration-200", a.status === "uploading" && "opacity-50")}
              />
              {a.status === "uploading" && (
                <span className="absolute inset-0 grid place-items-center" aria-label={t("composer.uploading")}>
                  <IconLoader2 size={16} stroke={1.75} className="animate-spin text-fg motion-reduce:animate-none" />
                </span>
              )}
            </div>
          ) : (
            <div
              className={cn(
                "flex h-14 max-w-[232px] items-center gap-2.5 rounded-[12px] border bg-overlay py-2 pl-2 pr-3.5",
                a.status === "error" ? "border-danger" : "border-line-subtle",
              )}
              title={a.name}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-surface text-fg-muted">
                {a.status === "uploading" ? (
                  <IconLoader2 size={16} stroke={1.75} className="animate-spin motion-reduce:animate-none" aria-label={t("composer.uploading")} />
                ) : a.status === "error" ? (
                  <IconAlertTriangle size={16} stroke={1.5} className="text-danger" />
                ) : a.pasted ? (
                  <IconClipboardText size={17} stroke={1.5} />
                ) : a.kind === "pdf" ? (
                  <IconFileTypePdf size={17} stroke={1.5} />
                ) : (
                  <IconFileText size={17} stroke={1.5} />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] leading-5 text-fg">{a.name}</span>
                <span className={cn("truncate text-[12px] leading-4", a.status === "error" ? "text-danger" : "text-fg-subtle")}>
                  {a.status === "error"
                    ? t("composer.uploadFailed")
                    : a.pasted
                      ? t("composer.lines", { n: a.pasted.lines })
                      : `${a.kind === "pdf" ? "PDF" : (a.name.split(".").pop() ?? "").toUpperCase().slice(0, 5) || "Text"} · ${formatBytes(a.size)}`}
                </span>
              </span>
            </div>
          )}
          {a.status !== "uploading" && <RemoveButton name={a.name} onRemove={() => onRemove(a.key)} />}
        </li>
      ))}
    </ul>
  );
}
