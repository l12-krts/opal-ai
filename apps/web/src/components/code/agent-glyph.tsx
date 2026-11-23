import { IconBrandOpenai } from "@tabler/icons-react";
import { cn } from "krts.ui";

/** Small mark for a coding agent: a burst for Claude Code, the OpenAI knot for Codex. */
export function AgentGlyph({ agent, size = 16, className }: { agent: string; size?: number; className?: string }) {
  if (agent === "codex") return <IconBrandOpenai size={size} stroke={1.6} className={cn("shrink-0 text-fg", className)} aria-label="Codex" />;
  const rays = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cn("shrink-0 text-[#d97757]", className)} aria-label="Claude Code" role="img">
      {rays.map((a, i) => (
        <line
          key={i}
          x1={12 + Math.cos(a) * 2.6}
          y1={12 + Math.sin(a) * 2.6}
          x2={12 + Math.cos(a) * (i % 2 ? 8.2 : 10)}
          y2={12 + Math.sin(a) * (i % 2 ? 8.2 : 10)}
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
