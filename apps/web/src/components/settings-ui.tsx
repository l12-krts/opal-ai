"use client";
// Building blocks for Settings and Customization pages: grouped cards of rows, a title, and an
// (i) that holds any explanation (hover, focus or tap), so pages stay quiet by default.
import { useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Tooltip, TooltipTrigger, cn } from "krts.ui";
import { IconInfoCircle } from "@tabler/icons-react";

export function InfoTip({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipTrigger isOpen={open} onOpenChange={setOpen} delay={250} closeDelay={80}>
      <AriaButton
        aria-label={text}
        onPress={() => setOpen((o) => !o)}
        className={cn(
          "inline-grid size-5 shrink-0 cursor-default place-items-center rounded-full text-fg-subtle outline-none transition-colors duration-150 hover:text-fg-muted data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent-line",
          className,
        )}
      >
        <IconInfoCircle size={15} stroke={1.5} />
      </AriaButton>
      <Tooltip placement="top" className="max-w-[260px] text-pretty">
        {text}
      </Tooltip>
    </TooltipTrigger>
  );
}

export function SettingsPage({
  title,
  info,
  action,
  wide,
  children,
}: {
  title: string;
  info?: string;
  action?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full px-5 pb-16 pt-8 md:px-8 md:pt-10", wide ? "max-w-[980px]" : "max-w-[680px]")}>
      <header className="mb-6 flex min-h-9 items-center gap-1.5">
        <h1 className="text-[20px] font-medium tracking-[-0.01em]">{title}</h1>
        {info && <InfoTip text={info} />}
        {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
      </header>
      <div className="flex flex-col gap-7">{children}</div>
    </div>
  );
}

/** A titled card of rows. */
export function Group({
  title,
  info,
  action,
  bare,
  className,
  children,
}: {
  title?: string;
  info?: string;
  action?: React.ReactNode;
  /** No card around the content (for grids and wide layouts). */
  bare?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      {(title || action) && (
        <div className="mb-2 flex min-h-7 items-center gap-1 px-1">
          {title && <h2 className="text-[13px] font-medium text-fg-muted">{title}</h2>}
          {info && <InfoTip text={info} />}
          {action && <div className="ml-auto flex items-center gap-1.5">{action}</div>}
        </div>
      )}
      {bare ? (
        <div className={className}>{children}</div>
      ) : (
        <div className={cn("divide-y divide-line-subtle overflow-hidden rounded-[14px] border border-line-subtle bg-overlay", className)}>{children}</div>
      )}
    </section>
  );
}

/** Label on the left, control on the right. */
export function Row({
  label,
  info,
  icon,
  sub,
  className,
  children,
}: {
  label: React.ReactNode;
  info?: string;
  icon?: React.ReactNode;
  /** A second, quieter line under the label. Only for values, never for explanations. */
  sub?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-h-12 items-center gap-3 px-4 py-2.5", className)}>
      {icon && <span className="grid shrink-0 place-items-center text-fg-muted">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[13.5px]">{label}</span>
          {info && <InfoTip text={info} />}
        </div>
        {sub && <div className="truncate text-[12px] text-fg-subtle">{sub}</div>}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** A muted single line inside a group, for "nothing here yet". */
export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3.5 text-[13px] text-fg-subtle">{children}</div>;
}

export function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted">
      <span className={cn("size-1.5 rounded-full", ok ? "bg-success" : "bg-fg-subtle")} />
      {children}
    </span>
  );
}
