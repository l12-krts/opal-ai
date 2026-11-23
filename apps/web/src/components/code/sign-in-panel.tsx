"use client";

// The sidebar where you sign an agent in on one of your machines. It runs the agent's own sign-in
// (`claude auth login`, `codex login --device-auth`) in a terminal on that machine: you open the
// link it prints, approve, and paste the code back. When the runner sees the new sign-in, the
// panel says so.
import { useMemo, useState } from "react";
import { Button, Drawer } from "krts.ui";
import { IconCircleCheck, IconExternalLink, IconRefresh, IconX } from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { useCodeState } from "@/lib/code-client";
import { agentLabel } from "@/lib/code-types";
import { closeSignIn, useSignIn } from "@/lib/code-signin";
import { IconButton } from "../ui";
import { TerminalView, type TerminalStatus } from "./terminal-panel";

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]/g;

export function SignInPanel() {
  const target = useSignIn();
  return (
    <Drawer side="right" isOpen={Boolean(target)} onOpenChange={(o) => !o && closeSignIn()} className="w-[min(94vw,560px)] p-0">
      {target && <SignInBody key={`${target.machineId}:${target.agent}`} machineId={target.machineId} agent={target.agent} />}
    </Drawer>
  );
}

function SignInBody({ machineId, agent }: { machineId: string; agent: "claude" | "codex" }) {
  const { data } = useCodeState();
  const machine = data?.machines.find((m) => m.id === machineId);
  const info = machine?.agents.find((a) => a.id === agent);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<TerminalStatus>("starting");
  const [output, setOutput] = useState("");
  const label = agentLabel(agent);

  // The newest link the sign-in printed, so it can be opened with a click.
  const link = useMemo(() => {
    const urls = output.replace(ANSI, "").match(/https:\/\/[^\s"'<>]+/g);
    return urls?.at(-1) ?? null;
  }, [output]);

  const done = info?.signedIn === true || (info?.ok === true && status === "closed");

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">Sign in to {label}</div>
          <div className="truncate text-[12px] text-fg-muted">on {machine?.name ?? "this machine"}</div>
        </div>
        <IconButton label="Close" onPress={closeSignIn}>
          <IconX size={16} stroke={1.5} />
        </IconButton>
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 border-b border-line-subtle px-4 py-3 text-[13px]">
        {done ? (
          <div className="flex items-center gap-2 text-success">
            <IconCircleCheck size={17} stroke={1.75} />
            <span>
              {label} is signed in on {machine?.name}.
            </span>
            <Button size="sm" variant="primary" className="ml-auto" onPress={closeSignIn}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <ol className="list-decimal space-y-0.5 pl-4 text-fg-muted">
              <li>Open the sign-in link and approve.</li>
              <li>{agent === "codex" ? "Enter the code it shows on that page." : "Copy the code you're given, paste it in the terminal below, and press Enter."}</li>
            </ol>
            <div className="flex items-center gap-2">
              {link ? (
                <Button
                  size="sm"
                  variant="primary"
                  startContent={<IconExternalLink size={15} stroke={1.75} />}
                  onPress={() => window.open(link, "_blank", "noopener,noreferrer")}
                >
                  Open sign-in page
                </Button>
              ) : (
                <span className="text-[12.5px] text-fg-subtle">{status === "error" ? "Couldn't start the sign-in." : "Waiting for the sign-in link…"}</span>
              )}
              {(status === "closed" || status === "error") && (
                <Button
                  size="sm"
                  variant="ghost"
                  startContent={<IconRefresh size={15} stroke={1.5} />}
                  onPress={() => {
                    setOutput("");
                    setAttempt((n) => n + 1);
                  }}
                >
                  Start again
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      <TerminalView
        key={attempt}
        start={(cols, rows) =>
          apiFetch<{ termId: string }>(`/api/code/machines/${machineId}/login`, { method: "POST", json: { agent, cols, rows } }).then((r) => r.termId)
        }
        onStatus={setStatus}
        onOutput={(d) => setOutput((o) => (o + d).slice(-20_000))}
      />
    </div>
  );
}
