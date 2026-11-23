"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { KrtsProvider, Toaster } from "krts.ui";
import { MotionConfig } from "motion/react";
import { ACCENT_KEY, DEFAULT_ACCENT, isAccent, type AccentId } from "@/lib/accents";

export type ThemePref = "system" | "light" | "dark";

const ThemeCtx = createContext<{ theme: ThemePref; setTheme: (t: ThemePref) => void; accent: AccentId; setAccent: (a: AccentId) => void }>({
  theme: "system",
  setTheme: () => {},
  accent: DEFAULT_ACCENT,
  setAccent: () => {},
});

export const useTheme = () => useContext(ThemeCtx);

function applyTheme(t: ThemePref) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>("system");
  const [accent, setAccentState] = useState<AccentId>(DEFAULT_ACCENT);

  useEffect(() => {
    try {
      const saved = (localStorage.getItem("opal-theme") as ThemePref | null) ?? "system";
      setThemeState(saved);
      const a = localStorage.getItem(ACCENT_KEY);
      if (isAccent(a)) setAccentState(a);
    } catch {}
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: ThemePref) => {
    setThemeState(t);
    try {
      localStorage.setItem("opal-theme", t);
    } catch {}
    applyTheme(t);
  }, []);

  const setAccent = useCallback((a: AccentId) => {
    setAccentState(a);
    try {
      localStorage.setItem(ACCENT_KEY, a);
    } catch {}
    document.documentElement.setAttribute("data-accent", a);
  }, []);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, accent, setAccent }}>
      <MotionConfig reducedMotion="user">
        <KrtsProvider menuAnimation="scale">
          {children}
          <Toaster position="bottom-center" />
        </KrtsProvider>
      </MotionConfig>
    </ThemeCtx.Provider>
  );
}
