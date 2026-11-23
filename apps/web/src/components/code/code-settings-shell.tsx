"use client";
// Opal Code has its own settings, separate from Opal chat's.
import { IconAdjustmentsHorizontal, IconFolder, IconServer2, IconWand } from "@tabler/icons-react";
import { SectionShell, type Section } from "../settings-shell";

const CODE: Section[] = [
  { href: "/code/settings", label: "General", icon: IconAdjustmentsHorizontal },
  { href: "/code/settings/skills", label: "Skills", icon: IconWand },
  { href: "/code/settings/projects", label: "Projects", icon: IconFolder },
  { href: "/code/settings/machines", label: "Machines", icon: IconServer2 },
];

export function CodeSettingsShell({ children }: { children: React.ReactNode }) {
  return (
    <SectionShell title="Code settings" sections={CODE} id="code-settings">
      {children}
    </SectionShell>
  );
}
