"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "krts.ui";
import { IconChevronRight } from "@tabler/icons-react";
import { t } from "@/lib/i18n";
import { Collapse } from "./collapsible";

export function Reasoning({ text, streaming, defaultOpen }: { text: string; streaming: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const started = useRef<number>(Date.now());
  const [secs, setSecs] = useState<number | null>(null);

  useEffect(() => {
    if (!streaming && secs === null) setSecs(Math.max(1, Math.round((Date.now() - started.current) / 1000)));
  }, [streaming, secs]);

  if (!text.trim() && !streaming) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable -ml-1 inline-flex items-center gap-1 rounded-[6px] px-1 py-0.5 text-[13.5px] text-fg-muted hover:text-fg"
      >
        {streaming ? <span className="shimmer-text">{t("chat.thinking")}</span> : <span>{secs ? t("chat.thought", { s: secs }) : t("chat.thinking")}</span>}
        <IconChevronRight size={14} stroke={1.5} className={cn("transition-transform duration-200", open && "rotate-90")} />
      </button>
      <Collapse open={open}>
        <div className="mt-1.5 max-h-[420px] overflow-y-auto whitespace-pre-wrap border-l border-line pl-3 text-[13.5px] leading-6 text-fg-muted">
          {text}
        </div>
      </Collapse>
    </div>
  );
}
