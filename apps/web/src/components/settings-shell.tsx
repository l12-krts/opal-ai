"use client";
// Settings and Customization: a section list next to the (collapsed) main sidebar, like the
// Agents tab. On phones the list becomes a row of pills above the page.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "krts.ui";
import { IconAdjustmentsHorizontal, IconBook2, IconBrain, IconKey, IconPlugConnected, IconSignature, IconWand } from "@tabler/icons-react";
import { t } from "@/lib/i18n";

export type Section = { href: string; label: string; icon: React.ComponentType<{ size?: number; stroke?: number; className?: string }> };

const SETTINGS: Section[] = [
  { href: "/settings", label: t("settings.general"), icon: IconAdjustmentsHorizontal },
  { href: "/settings/study", label: t("nav.study"), icon: IconBook2 },
  { href: "/settings/handwriting", label: t("nav.handwriting"), icon: IconSignature },
  { href: "/settings/secrets", label: t("settings.vault"), icon: IconKey },
];

const CUSTOMIZATION: Section[] = [
  { href: "/customization", label: t("custom.memory"), icon: IconBrain },
  { href: "/customization/skills", label: t("custom.skills"), icon: IconWand },
  { href: "/customization/connectors", label: t("nav.connectors"), icon: IconPlugConnected },
];

export function SettingsShell({ children }: { children: React.ReactNode }) {
  return (
    <SectionShell title={t("settings.title")} sections={SETTINGS} id="settings">
      {children}
    </SectionShell>
  );
}

export function CustomizationShell({ children }: { children: React.ReactNode }) {
  return (
    <SectionShell title={t("nav.customization")} sections={CUSTOMIZATION} id="customization">
      {children}
    </SectionShell>
  );
}

export function SectionShell({ title, sections, id, children }: { title: string; sections: Section[]; id: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const root = sections[0].href;
  const isActive = (href: string) => (href === root ? pathname === root : pathname.startsWith(href));

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line-subtle bg-bg md:flex">
        <div className="flex h-14 shrink-0 items-center px-4">
          <h1 className="text-[17px] font-medium tracking-[-0.01em]">{title}</h1>
        </div>
        <nav aria-label={title} className="flex flex-col gap-0.5 px-2">
          {sections.map((s) => {
            const active = isActive(s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "pressable relative flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] transition-colors duration-150",
                  active ? "text-fg" : "text-fg/75 hover:bg-surface hover:text-fg",
                )}
              >
                {active && (
                  <motion.span
                    layoutId={`${id}-active`}
                    transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                    className="absolute inset-0 rounded-[10px] bg-surface-hover"
                  />
                )}
                <s.icon size={17} stroke={1.5} className="relative shrink-0" />
                <span className="relative">{s.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <nav
          aria-label={title}
          className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-line-subtle bg-bg/90 py-2 pl-12 pr-4 backdrop-blur md:hidden"
        >
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              aria-current={isActive(s.href) ? "page" : undefined}
              className={cn(
                "pressable flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px]",
                isActive(s.href) ? "bg-surface-hover text-fg" : "text-fg-muted hover:bg-surface",
              )}
            >
              <s.icon size={15} stroke={1.5} />
              {s.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
