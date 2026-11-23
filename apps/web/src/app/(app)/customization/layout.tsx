import { CustomizationShell } from "@/components/settings-shell";

export const metadata = { title: "Customization" };

export default function CustomizationLayout({ children }: { children: React.ReactNode }) {
  return <CustomizationShell>{children}</CustomizationShell>;
}
