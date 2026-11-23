import type { Metadata } from "next";
import { CommandPalette } from "@/components/code/command-palette";
import { SignInPanel } from "@/components/code/sign-in-panel";

export const metadata: Metadata = { title: "Opal Code" };

export default function CodeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {children}
      <CommandPalette />
      <SignInPanel />
    </div>
  );
}
