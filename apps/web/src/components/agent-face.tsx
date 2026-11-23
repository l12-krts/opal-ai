"use client";
// An agent's face: its body shape in its color, with two eyes. Eyes blink now and then (bigger
// faces only) and glance around while the agent is working.
import { cn } from "krts.ui";
import { shapeOf } from "@/lib/agent-shapes";
import { OpalMark } from "./brand";

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function AgentFace({
  shape,
  color,
  size = 20,
  working = false,
  blink,
  seed = "",
  className,
}: {
  shape?: string | null;
  color: string;
  size?: number;
  working?: boolean;
  /** Defaults to on for faces 24px and up. */
  blink?: boolean;
  /** Varies blink timing between faces. */
  seed?: string;
  className?: string;
}) {
  const s = shapeOf(shape);
  const { y, gap, w, h } = s.eyes;
  const doBlink = blink ?? size >= 24;
  const n = hash(seed || `${shape}${color}`);
  const blinkStyle = doBlink ? { animationDuration: `${4.2 + (n % 30) / 10}s`, animationDelay: `-${(n % 47) / 10}s` } : undefined;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className={cn("shrink-0 overflow-visible", className)}>
      <path d={s.path} fill={color} />
      <g className={working ? "agent-eyes-look" : undefined}>
        <g className={doBlink ? "agent-eyes-blink" : undefined} style={blinkStyle}>
          <rect x={50 - gap / 2 - w / 2} y={y - h / 2} width={w} height={h} rx={w / 2} fill="#fff" />
          <rect x={50 + gap / 2 - w / 2} y={y - h / 2} width={w} height={h} rx={w / 2} fill="#fff" />
        </g>
      </g>
    </svg>
  );
}

/** Who sent an agent message: Opal (the mark) or an agent (its face). */
export function SenderFace({
  sender,
  size = 16,
}: {
  sender: { kind?: string; name: string; color?: string; shape?: string | null };
  size?: number;
}) {
  if (sender.kind === "opal" || !sender.color) return <OpalMark size={Math.round(size * 0.9)} className="shrink-0 text-fg" />;
  return <AgentFace shape={sender.shape} color={sender.color} size={size} seed={sender.name} />;
}
