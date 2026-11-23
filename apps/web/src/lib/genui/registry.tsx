"use client";
// json-render registry: catalog components rendered with krts.ui + Tailwind, in Opal's style.
import { defineRegistry } from "@json-render/react";
import { Badge, Separator, cn } from "krts.ui";
import { catalog } from "./catalog";
import { useChatActions } from "@/components/chat/chat-context";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent" | null | undefined;

const toneText: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  accent: "text-accent-line",
  neutral: "text-fg-muted",
};

function GenButton({ label, prompt, primary }: { label: string; prompt: string; primary?: boolean | null }) {
  const { send } = useChatActions();
  return (
    <button
      type="button"
      onClick={() => send(prompt)}
      className={cn(
        "pressable inline-flex h-8 items-center rounded-[8px] px-3 text-[13px] font-medium",
        primary ? "btn-accent" : "border border-line bg-surface hover:bg-surface-hover",
      )}
    >
      {label}
    </button>
  );
}

function safeHttps(href: string) {
  try {
    const u = new URL(href);
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export const { registry } = defineRegistry(catalog, {
  components: {
    Stack: ({ props, children }) => (
      <div
        className={cn(
          "flex",
          props.direction === "horizontal" ? "flex-row flex-wrap items-center" : "flex-col",
          props.gap === "sm" ? "gap-2" : props.gap === "lg" ? "gap-5" : "gap-3",
        )}
      >
        {children}
      </div>
    ),
    Grid: ({ props, children }) => {
      const cols = Math.min(4, Math.max(1, props.columns ?? 2));
      return (
        <div className={cn("grid gap-3", cols >= 2 && "sm:grid-cols-2", cols >= 3 && "lg:grid-cols-3", cols >= 4 && "xl:grid-cols-4")}>{children}</div>
      );
    },
    Card: ({ props, children }) => (
      <section className="rounded-[12px] border border-line-subtle bg-overlay p-4">
        {props.title && <h3 className="text-[14px] font-medium">{props.title}</h3>}
        {props.subtitle && <p className="mt-0.5 text-[12.5px] text-fg-muted">{props.subtitle}</p>}
        <div className={cn((props.title || props.subtitle) && "mt-3", "flex flex-col gap-3")}>{children}</div>
      </section>
    ),
    Heading: ({ props }) => {
      const level = props.level ?? 2;
      const cls = level === 1 ? "text-[18px]" : level === 2 ? "text-[16px]" : "text-[14.5px]";
      return <p className={cn(cls, "font-medium")}>{props.text}</p>;
    },
    Text: ({ props }) => <p className={cn(props.size === "sm" ? "text-[13px]" : "text-[14.5px]", "leading-6", props.muted && "text-fg-muted")}>{props.text}</p>,
    Metric: ({ props }) => (
      <div>
        <p className="text-[12.5px] text-fg-muted">{props.label}</p>
        <p className="mt-0.5 text-[22px] font-medium tabular-nums">{props.value}</p>
        {props.change && <p className={cn("text-[12.5px] tabular-nums", toneText[(props.tone as Tone) ?? "neutral"] ?? "text-fg-muted")}>{props.change}</p>}
      </div>
    ),
    Badge: ({ props }) => (
      <Badge tone={props.tone === "accent" || !props.tone ? "neutral" : (props.tone as "success" | "warning" | "danger" | "neutral")}>{props.text}</Badge>
    ),
    KeyValue: ({ props }) => (
      <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
        {props.items.map((it, i) => (
          <div key={i} className="contents">
            <dt className="text-fg-muted">{it.key}</dt>
            <dd className="tabular-nums">{it.value}</dd>
          </div>
        ))}
      </dl>
    ),
    List: ({ props }) => {
      const Tag = props.ordered ? "ol" : "ul";
      return (
        <Tag className={cn("flex flex-col gap-1 pl-5 text-[14px] marker:text-fg-subtle", props.ordered ? "list-decimal" : "list-disc")}>
          {props.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </Tag>
      );
    },
    Table: ({ props }) => (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px] tabular-nums">
          <thead>
            <tr>
              {props.columns.map((c, i) => (
                <th key={i} className="border-b border-line-subtle px-2 py-1.5 text-left font-medium text-fg-muted">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.slice(0, 50).map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} className="border-b border-line-subtle px-2 py-1.5">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    BarChart: ({ props }) => {
      const max = Math.max(1, ...props.data.map((d) => Math.abs(d.value)));
      return (
        <figure>
          {props.title && <figcaption className="mb-2 text-[13px] font-medium">{props.title}</figcaption>}
          <div className="flex flex-col gap-1.5">
            {props.data.slice(0, 24).map((d, i) => (
              <div key={i} className="grid grid-cols-[minmax(70px,30%)_1fr_auto] items-center gap-2 text-[12.5px]">
                <span className="truncate text-fg-muted">{d.label}</span>
                <div className="h-2.5 rounded-full">
                  <div className="h-full rounded-full bg-fg/70" style={{ width: `${(Math.abs(d.value) / max) * 100}%` }} />
                </div>
                <span className="tabular-nums">
                  {d.value}
                  {props.unit ?? ""}
                </span>
              </div>
            ))}
          </div>
        </figure>
      );
    },
    Progress: ({ props }) => (
      <div>
        <div className="mb-1 flex justify-between text-[12.5px]">
          <span className="text-fg-muted">{props.label}</span>
          <span className="tabular-nums">{Math.round(props.value)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface">
          <div className="h-full rounded-full bg-fg/75" style={{ width: `${props.value}%` }} />
        </div>
      </div>
    ),
    Steps: ({ props }) => (
      <ol className="flex flex-col gap-2">
        {props.items.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[11px] tabular-nums",
                s.done ? "border-transparent bg-fg text-bg" : "border-line text-fg-muted",
              )}
            >
              {i + 1}
            </span>
            <div>
              <p className={cn("text-[14px]", s.done && "text-fg-muted line-through decoration-fg-subtle")}>{s.title}</p>
              {s.detail && <p className="text-[12.5px] text-fg-muted">{s.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    ),
    Callout: ({ props }) => (
      <div className={cn("rounded-[10px] border px-3 py-2.5", props.tone === "danger" ? "border-danger/30 bg-danger-soft" : props.tone === "warning" ? "border-warning/30 bg-warning/10" : "border-line-subtle bg-surface/60")}>
        {props.title && <p className="text-[13.5px] font-medium">{props.title}</p>}
        <p className="text-[13.5px] leading-6">{props.text}</p>
      </div>
    ),
    Image: ({ props }) => {
      const src = safeHttps(props.src);
      if (!src) return null;
      return (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={props.alt} className="max-h-80 rounded-[10px] border border-line-subtle object-cover" loading="lazy" referrerPolicy="no-referrer" />
          {props.caption && <figcaption className="mt-1 text-[12px] text-fg-muted">{props.caption}</figcaption>}
        </figure>
      );
    },
    Link: ({ props }) => {
      const href = safeHttps(props.href);
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-[14px] text-accent-line underline underline-offset-2">
          {props.text}
        </a>
      ) : (
        <span>{props.text}</span>
      );
    },
    Button: ({ props }) => <GenButton label={props.label} prompt={props.prompt} primary={props.primary} />,
    Separator: () => <Separator />,
  },
  actions: {
    send_prompt: async () => {},
  },
});
