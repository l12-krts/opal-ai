"use client";
// "Flight" of a sent message: the text leaves the composer and lands as a bubble in the thread.
// The composer records where its text was; the new bubble reads that on mount and animates from
// there to its own position (FLIP), using WAAPI so it runs off the main thread.

type Flight = { text: string; rect: DOMRect; at: number };

let pending: Flight | null = null;

export function launchFlight(text: string, rect: DOMRect) {
  pending = { text, rect, at: performance.now() };
}

export function landFlight(text: string, el: HTMLElement) {
  const f = pending;
  if (!f || performance.now() - f.at > 1200 || f.text.trim() !== text.trim()) return;
  pending = null;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const to = el.getBoundingClientRect();
  if (reduce) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
    return;
  }
  // Align the bubble's text box with where the text sat in the composer.
  const dx = f.rect.left - to.left;
  const dy = f.rect.top - to.top;
  const sx = Math.min(1.08, Math.max(0.92, f.rect.width / Math.max(1, to.width)));
  el.style.transformOrigin = "top left";
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, 1)`, backgroundColor: "transparent", boxShadow: "none" },
      { transform: "translate(0, 0) scale(1)", backgroundColor: "var(--color-bubble)" },
    ],
    { duration: 320, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
}
