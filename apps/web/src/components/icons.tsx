// Opal's own icons, drawn to match Tabler's (24px grid, round stroke, currentColor).
import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "stroke"> & { size?: number; stroke?: number };

/** Agents: a round face with two eyes, like the agents themselves. */
export function IconAgent({ size = 24, stroke = 2, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.75v2.5M14.5 9.75v2.5" />
    </svg>
  );
}
