"use client";

import useSWR from "swr";
import { Tab, TabList, TabPanel, Tabs, cn } from "krts.ui";
import { IconFile, IconFolder, IconX } from "@tabler/icons-react";
import { fetcher } from "@/lib/api";
import { setPanel, useSandboxes } from "@/lib/sandbox-store";
import { IconButton } from "../ui";
import { AgentFace } from "../agent-face";
import { useChatActions } from "./chat-context";

type SandboxResponse = {
  sandbox: null | {
    status: string;
    lastUrl: string | null;
    lastScreenshot: string | null;
    files: { type: string; path: string; size: number }[];
  };
};

export function SandboxPanel({ variant = "side" }: { variant?: "side" | "drawer" }) {
  const { frames, focus } = useSandboxes();
  const { nerd } = useChatActions();
  const ids = Object.keys(frames);
  const active = focus && (frames[focus] || !ids.length) ? focus : ids[0];
  const live = active ? frames[active] : undefined;
  const { data } = useSWR<SandboxResponse>(active ? `/api/sandbox/${active}` : null, fetcher, { refreshInterval: 8000 });
  const shot = live?.screenshot ?? data?.sandbox?.lastScreenshot ?? undefined;
  const url = live?.url ?? data?.sandbox?.lastUrl ?? undefined;

  return (
    <aside className={variant === "side" ? "flex w-[min(44vw,520px)] shrink-0 flex-col border-l border-line-subtle bg-bg" : "flex h-full w-full flex-col bg-bg"}>
      <div className="flex h-12 items-center gap-2 border-b border-line-subtle px-3">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setPanel(true, id)}
              className={cn(
                "pressable flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px]",
                id === active ? "bg-surface-hover text-fg" : "text-fg-muted hover:bg-surface",
              )}
            >
              <AgentFace shape={frames[id].shape} color={frames[id].color} size={16} seed={frames[id].agentName} />
              {frames[id].agentName}
            </button>
          ))}
          {!ids.length && <span className="text-[13px] text-fg-muted">Agent computer</span>}
        </div>
        <IconButton label="Close" onPress={() => setPanel(false)}>
          <IconX size={16} stroke={1.5} />
        </IconButton>
      </div>

      <Tabs className="flex min-h-0 flex-1 flex-col">
        <TabList aria-label="Computer" variant="underline" className="px-3">
          <Tab id="browser">Browser</Tab>
          <Tab id="terminal">Terminal</Tab>
          <Tab id="files">Files</Tab>
        </TabList>
        <TabPanel id="browser" className="min-h-0 flex-1 overflow-y-auto p-3">
          {url && <p className="mb-2 truncate rounded-[8px] bg-surface px-2.5 py-1.5 font-mono text-[12px] text-fg-muted">{url}</p>}
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot} alt={live?.title ?? "Browser screenshot"} className="w-full rounded-[8px] border border-line-subtle" />
          ) : (
            <p className="text-[13px] text-fg-muted">The browser hasn&apos;t opened a page yet.</p>
          )}
        </TabPanel>
        <TabPanel id="terminal" className="min-h-0 flex-1 overflow-y-auto p-3">
          {live?.terminalLog?.length ? (
            <div className="flex flex-col gap-3 rounded-[10px] bg-[#111] p-3 font-mono text-[12px] leading-5 text-[#e6e6e6]">
              {live.terminalLog.map((t, i) =>
                t ? (
                  <div key={i}>
                    <p className="text-[#8ec2ff]">$ {t.command}</p>
                    <pre className="whitespace-pre-wrap break-words text-[#cfcfcf]">{t.output || " "}</pre>
                    {t.exitCode !== 0 && <p className="text-[#ff8a8a]">exit {t.exitCode}</p>}
                  </div>
                ) : null,
              )}
            </div>
          ) : (
            <p className="text-[13px] text-fg-muted">No commands yet.</p>
          )}
        </TabPanel>
        <TabPanel id="files" className="min-h-0 flex-1 overflow-y-auto p-3">
          {data?.sandbox?.files?.length ? (
            <ul className="flex flex-col gap-0.5 font-mono text-[12.5px]">
              {data.sandbox.files.map((f) => (
                <li key={f.path} className="flex items-center gap-2 py-0.5" style={{ paddingLeft: `${(f.path.split("/").length - 1) * 14}px` }}>
                  {f.type === "dir" ? <IconFolder size={14} stroke={1.5} className="text-fg-muted" /> : <IconFile size={14} stroke={1.5} className="text-fg-subtle" />}
                  <span className="truncate">{f.path.split("/").pop()}</span>
                  {f.type !== "dir" && <span className="ml-auto text-[11px] tabular-nums text-fg-subtle">{formatSize(f.size)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-muted">The workspace is empty.</p>
          )}
          {nerd && data?.sandbox && <p className="mt-3 font-mono text-[11px] text-fg-subtle">container status: {data.sandbox.status}</p>}
        </TabPanel>
      </Tabs>
    </aside>
  );
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
