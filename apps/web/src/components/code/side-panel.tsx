"use client";

// The Changes / Terminal panel beside a thread. Opening it by click is occasional, so it slides
// in to show where it lives (spatial consistency): on desktop the column opens with the app's
// drawer curve while the card inside settles from the right; on phones it rises from the bottom
// like a sheet and leaves the same way. Opened with a keyboard shortcut it appears instantly.
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const DRAWER = [0.32, 0.72, 0, 1] as const; // --ease-drawer
const EASE_OUT = [0.23, 1, 0.32, 1] as const; // --ease-out

function useDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

function usePanelWidth() {
  const [w, setW] = useState(520);
  useEffect(() => {
    const on = () => setW(Math.min(560, Math.max(380, Math.round(window.innerWidth * 0.42))));
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export function SidePanel({ open, instant, contentKey, children }: { open: boolean; instant: boolean; contentKey: string; children: React.ReactNode }) {
  const desktop = useDesktop();
  const width = usePanelWidth();
  const reduce = useReducedMotion();
  const still = instant || Boolean(reduce);

  const content = (
    // Switching Changes ↔ Terminal crossfades the content only; the panel stays put.
    <motion.div
      key={contentKey}
      initial={still ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: EASE_OUT }}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </motion.div>
  );

  if (desktop) {
    return (
      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            key="panel"
            initial={{ width: 0 }}
            animate={{ width }}
            exit={{ width: 0 }}
            transition={still ? { duration: 0 } : { duration: 0.3, ease: DRAWER }}
            className="shrink-0 overflow-hidden"
          >
            {/* Fixed inner width: the terminal and diff lay out once, at their final size. */}
            <div className="flex h-full flex-col py-2 pr-2" style={{ width }}>
              <motion.div
                initial={still ? false : { opacity: 0, transform: "translateX(16px)" }}
                animate={{ opacity: 1, transform: "translateX(0px)" }}
                exit={still ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transform: "translateX(16px)" }}
                transition={{ duration: 0.24, ease: EASE_OUT }}
                className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-line-subtle bg-overlay shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
              >
                {content}
              </motion.div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="sheet"
          initial={still ? { opacity: 0 } : { transform: "translateY(100%)" }}
          animate={still ? { opacity: 1 } : { transform: "translateY(0%)" }}
          exit={still ? { opacity: 0 } : { transform: "translateY(100%)" }}
          transition={still ? { duration: instant ? 0 : 0.2 } : { duration: 0.36, ease: DRAWER }}
          className="fixed inset-0 z-30 flex flex-col bg-bg"
        >
          {content}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
