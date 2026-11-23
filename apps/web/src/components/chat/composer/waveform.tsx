"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Bars that follow the microphone level. Written straight to the DOM each frame, not via state. */
export function Waveform({ analyser, bars = 36 }: { analyser: RefObject<AnalyserNode | null>; bars?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const data = new Uint8Array(128);
    const tick = () => {
      const el = ref.current;
      const node = analyser.current;
      if (el) {
        if (node) node.getByteFrequencyData(data);
        const n = el.children.length;
        const center = (n - 1) / 2;
        for (let i = 0; i < n; i++) {
          // Loudest speech frequencies in the middle, higher ones toward the edges.
          const dist = Math.abs(i - center) / center;
          const v = node ? data[2 + Math.floor(dist * 44)] / 255 : 0;
          const h = Math.max(0.14, Math.min(1, v * 1.5 * (1 - dist * 0.4)));
          (el.children[i] as HTMLElement).style.transform = `scaleY(${h.toFixed(3)})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <div ref={ref} aria-hidden="true" className="flex h-6 items-center gap-[3px]">
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="h-full w-[3px] rounded-full bg-fg/75 transition-transform duration-75 ease-out" style={{ transform: "scaleY(0.14)" }} />
      ))}
    </div>
  );
}
