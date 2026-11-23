import { AgentsShell } from "@/components/agents/agents-shell";

export const metadata = { title: "Agents" };

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return <AgentsShell>{children}</AgentsShell>;
}
