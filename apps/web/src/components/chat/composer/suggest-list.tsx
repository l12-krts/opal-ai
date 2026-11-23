"use client";
// The popover above the composer for "/" commands, "@" mentions and the model list.
// Focus stays in the textarea; the list is driven by aria-activedescendant.
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "krts.ui";
import { IconCheck } from "@tabler/icons-react";
import { t } from "@/lib/i18n";

export type SuggestItem = {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  selected?: boolean;
};

export function SuggestList({
  id,
  title,
  items,
  active,
  onPick,
  onHover,
}: {
  id: string;
  title: string;
  items: SuggestItem[];
  active: number;
  onPick: (item: SuggestItem) => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="opal-pop absolute inset-x-0 bottom-full z-20 mb-2 origin-bottom overflow-hidden rounded-[20px] border border-line-subtle bg-overlay shadow-float">
      <p className="px-3.5 pb-1 pt-2.5 text-[12px] font-medium text-fg-subtle">{title}</p>
      <div ref={listRef} id={id} role="listbox" aria-label={title} className="max-h-[288px] overflow-y-auto px-1.5 pb-1.5">
        {items.length === 0 && <p className="px-2 py-2 text-[13.5px] text-fg-muted">{t("composer.noMatches")}</p>}
        {items.map((item, i) => (
          <div
            key={item.id}
            id={`${id}-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === active}
            // Keep focus in the textarea while clicking.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(item)}
            onMouseMove={() => i !== active && onHover(i)}
            className={cn(
              "flex h-9 cursor-default select-none items-center gap-2.5 rounded-[14px] px-2.5 text-[14px]",
              i === active ? "bg-surface-hover text-fg" : "text-fg/90",
            )}
          >
            {item.icon && <span className="grid size-4 shrink-0 place-items-center text-fg-muted">{item.icon}</span>}
            <span className="truncate">{item.label}</span>
            {item.hint && <span className="ml-auto shrink-0 pl-3 text-[12.5px] text-fg-subtle">{item.hint}</span>}
            {item.selected && <IconCheck size={14} stroke={1.75} className={cn("shrink-0", !item.hint && "ml-auto")} />}
          </div>
        ))}
      </div>
    </div>
  );
}
