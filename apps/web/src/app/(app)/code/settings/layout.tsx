import { CodeSettingsShell } from "@/components/code/code-settings-shell";

export const metadata = { title: "Code settings" };

export default function CodeSettingsLayout({ children }: { children: React.ReactNode }) {
  return <CodeSettingsShell>{children}</CodeSettingsShell>;
}
