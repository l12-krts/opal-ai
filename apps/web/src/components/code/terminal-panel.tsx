"use client";

// A live terminal on a machine (xterm.js ↔ runner pty): a shell in a thread's folder, or a single
// command such as an agent's sign-in.
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { IconRefresh } from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { onTerminal } from "@/lib/code-client";
import { IconButton } from "../ui";

export type TerminalStatus = "starting" | "open" | "closed" | "error";

export function TerminalPanel({ threadId }: { threadId: string }) {
  const [session, setSession] = useState(0);
  const [status, setStatus] = useState<TerminalStatus>("starting");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle pl-4 pr-11">
        <span className="text-[13.5px] font-medium">Terminal</span>
        {status === "starting" && <span className="text-[12px] text-fg-subtle">Starting…</span>}
        {status === "closed" && <span className="text-[12px] text-fg-subtle">Exited</span>}
        <div className="ml-auto">
          <IconButton label="New terminal" onPress={() => setSession((n) => n + 1)}>
            <IconRefresh size={15} stroke={1.5} />
          </IconButton>
        </div>
      </div>
      <TerminalView
        key={`${threadId}:${session}`}
        start={(cols, rows) => apiFetch<{ termId: string }>("/api/code/terminals", { method: "POST", json: { threadId, cols, rows } }).then((r) => r.termId)}
        onStatus={setStatus}
      />
    </div>
  );
}

/**
 * The xterm itself. `start` asks the server for a terminal of the given size and returns its id;
 * remount (change `key`) to start a new one. `onOutput` sees everything the terminal prints.
 */
export function TerminalView({
  start,
  onStatus,
  onOutput,
  className,
}: {
  start: (cols: number, rows: number) => Promise<string>;
  onStatus?: (s: TerminalStatus) => void;
  onOutput?: (data: string) => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Callbacks can change every render; the terminal starts once per mount.
  const cb = useRef({ start, onStatus, onOutput });
  cb.current = { start, onStatus, onOutput };

  useEffect(() => {
    let disposed = false;
    let termId: string | null = null;
    let cleanup = () => {};
    const status = (s: TerminalStatus) => cb.current.onStatus?.(s);
    status("starting");

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !host.current) return;
      const dark = document.documentElement.classList.contains("dark");
      const css = getComputedStyle(document.documentElement);
      const term = new Terminal({
        // Canvas fonts can't read CSS variables, so pass the resolved family names.
        fontFamily: `${css.getPropertyValue("--font-jetbrains").trim() || "Consolas"}, monospace`,
        fontSize: 12.5,
        lineHeight: 1.25,
        cursorBlink: true,
        allowProposedApi: false,
        theme: dark
          ? { background: "#131313", foreground: "#e6e6e6", cursor: "#e6e6e6", selectionBackground: "#ffffff33" }
          : { background: "#fcfcfc", foreground: "#1b1b1b", cursor: "#1b1b1b", selectionBackground: "#0000001f" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host.current);
      fit.fit();

      try {
        termId = await cb.current.start(term.cols, term.rows);
      } catch (e) {
        term.write(`\r\n${(e as Error).message}\r\n`);
        status("error");
        cleanup = () => term.dispose();
        return;
      }
      if (disposed) {
        void apiFetch(`/api/code/terminals/${termId}`, { method: "DELETE" }).catch(() => {});
        term.dispose();
        return;
      }
      status("open");

      const off = onTerminal(termId, (data) => {
        if (data === null) {
          term.write("\r\n[process exited]\r\n");
          status("closed");
        } else {
          term.write(data);
          cb.current.onOutput?.(data);
        }
      });

      // Batch keystrokes so typing doesn't send one request per key.
      let buf = "";
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        const data = buf;
        buf = "";
        if (data && termId) void apiFetch(`/api/code/terminals/${termId}`, { method: "POST", json: { input: data } }).catch(() => {});
      };
      const input = term.onData((d) => {
        buf += d;
        timer ??= setTimeout(flush, 12);
      });

      const ro = new ResizeObserver(() => {
        try {
          fit.fit();
          if (termId) void apiFetch(`/api/code/terminals/${termId}`, { method: "POST", json: { cols: term.cols, rows: term.rows } }).catch(() => {});
        } catch {}
      });
      ro.observe(host.current);
      term.focus();

      cleanup = () => {
        ro.disconnect();
        input.dispose();
        off();
        term.dispose();
        if (termId) void apiFetch(`/api/code/terminals/${termId}`, { method: "DELETE" }).catch(() => {});
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return <div ref={host} className={className ?? "min-h-0 flex-1 bg-bg px-2 py-1.5"} />;
}
