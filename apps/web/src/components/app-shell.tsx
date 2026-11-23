"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Drawer, cn } from "krts.ui";
import { IconLayoutSidebar } from "@tabler/icons-react";
import { RAIL_EASE, RAIL_WIDTH, SIDEBAR_WIDTH, Sidebar } from "./sidebar";
import { ChatHost } from "./chat/chat-host";
import { CodeSidebar } from "./code/code-sidebar";
import { IconButton } from "./ui";
import { t } from "@/lib/i18n";
import { useSettings } from "@/lib/hooks";
import { useTheme } from "./providers";

const RAIL_KEY = "opal.rail";
const CODE_SIDEBAR_WIDTH = 288;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Agents, Customization and Settings bring their own list, so the main sidebar becomes a rail there.
  const section = ["/agents", "/customization", "/settings"].find((p) => pathname === p || pathname.startsWith(`${p}/`)) ?? null;
  const isChat = pathname === "/" || pathname.startsWith("/c/");
  // Opal Code is its own app: its Inbox replaces the main sidebar.
  const isCode = pathname === "/code" || pathname.startsWith("/code/");
  // The sidebar is also a rail when the user collapsed it. Expanding it inside a section lasts
  // until you leave that section.
  const [manualRail, setManualRail] = useState(false);
  const [sectionExpanded, setSectionExpanded] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const rail = section ? !sectionExpanded : manualRail;
  const { data } = useSettings();
  const { setTheme, theme, setAccent, accent } = useTheme();

  useLayoutEffect(() => {
    try {
      setManualRail(localStorage.getItem(RAIL_KEY) === "1");
    } catch {}
    // Don't animate the restored state on first paint.
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => setSectionExpanded(false), [section]);

  const toggle = () => {
    if (section) return setSectionExpanded((v) => !v);
    setManualRail((v) => {
      try {
        localStorage.setItem(RAIL_KEY, v ? "0" : "1");
      } catch {}
      return !v;
    });
  };
  const toggleRef = { current: toggle };
  toggleRef.current = toggle;

  // Server-side theme preference wins once loaded (keeps devices in sync).
  useEffect(() => {
    const t = data?.settings.theme;
    if (t && t !== theme) setTheme(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.settings.theme]);

  useEffect(() => {
    const a = data?.settings.accent;
    if (a && a !== accent) setAccent(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.settings.accent]);

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-bg">
      <aside
        className={cn("hidden shrink-0 overflow-hidden border-r border-line-subtle bg-sidebar md:flex", animate && `transition-[width] ${RAIL_EASE}`)}
        style={{ width: isCode ? CODE_SIDEBAR_WIDTH : rail ? RAIL_WIDTH : SIDEBAR_WIDTH }}
      >
        {/* Switching between Opal and Opal Code swaps the whole sidebar; a short fade keeps it from flashing. */}
        <div key={isCode ? "code" : "main"} className={cn("flex h-full w-full min-w-0", animate && "opal-fade")}>
          {isCode ? <CodeSidebar /> : <Sidebar rail={rail} onToggle={toggle} />}
        </div>
      </aside>

      <Drawer side="left" isOpen={mobileOpen} onOpenChange={setMobileOpen} className="w-[288px] bg-sidebar p-0">
        {isCode ? <CodeSidebar onNavigate={() => setMobileOpen(false)} /> : <Sidebar onToggle={() => setMobileOpen(false)} />}
      </Drawer>

      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* In an agent's thread the top-left spot is its Back button (to the agent list). */}
        <div className={cn("absolute left-2 top-2 z-20 flex gap-1 md:hidden", /^\/agents\/./.test(pathname) && "hidden")}>
          <IconButton label={t("nav.expand")} onPress={() => setMobileOpen(true)}>
            <IconLayoutSidebar size={18} stroke={1.5} />
          </IconButton>
        </div>
        {isChat ? <ChatHost /> : section || isCode ? <div className="flex min-h-0 flex-1">{children}</div> : <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>}
      </main>
    </div>
  );
}
