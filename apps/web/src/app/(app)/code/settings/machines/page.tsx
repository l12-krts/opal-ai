"use client";

import { tail } from "@/components/code/command-palette";
import { useEffect, useState } from "react";
import { Badge, Button, Dialog, Modal, Skeleton, TextField, cn, toast } from "krts.ui";
import { IconCheck, IconCopy, IconDots, IconPlus, IconServer2 } from "@tabler/icons-react";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "krts.ui";
import { apiFetch } from "@/lib/api";
import { relTime, STATE_KEY, useCodeState } from "@/lib/code-client";
import { agentLabel, type MachineView } from "@/lib/code-types";
import { EmptyRow, Group, SettingsPage } from "@/components/settings-ui";
import { Confirm } from "@/components/ui";
import { needsSignIn, openSignIn } from "@/lib/code-signin";
import { mutate } from "swr";

export default function MachinesPage() {
  const { data } = useCodeState();
  const [pairing, setPairing] = useState(false);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SettingsPage
        title="Machines"
        info="Computers that run your coding agents. Each one runs the Opal runner, which connects out to Opal, so it works behind a router or over Tailscale."
        action={
          <Button size="sm" variant="primary" startContent={<IconPlus size={15} stroke={1.75} />} onPress={() => setPairing(true)}>
            Connect a machine
          </Button>
        }
      >
        {!data && <Skeleton className="h-24 rounded-[14px]" />}
        {data && (
          <Group>
            {!data.machines.length && <EmptyRow>No machines yet</EmptyRow>}
            {data.machines.map((m) => (
              <MachineRow key={m.id} m={m} />
            ))}
          </Group>
        )}
      </SettingsPage>
      {pairing && <PairDialog onClose={() => setPairing(false)} />}
    </div>
  );
}

function MachineRow({ m }: { m: MachineView }) {
  const [editRoot, setEditRoot] = useState(false);
  const [root, setRoot] = useState(m.projectsRoot);
  const [name, setName] = useState(m.name);
  const [confirm, setConfirm] = useState(false);

  async function save() {
    try {
      await apiFetch(`/api/code/machines/${m.id}`, { method: "PATCH", json: { name: name.trim(), projectsRoot: root.trim() } });
      await mutate(STATE_KEY);
      setEditRoot(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-surface text-fg-muted">
          <IconServer2 size={17} stroke={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13.5px]">
            <span className="truncate font-medium">{m.name}</span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted">
              <span className={cn("size-1.5 rounded-full", m.online ? "bg-success" : "bg-fg-subtle/60")} />
              {m.online ? "Online" : m.lastSeenAt ? `Seen ${relTime(m.lastSeenAt)} ago` : "Never connected"}
            </span>
          </div>
          <div className="truncate font-mono text-[11.5px] text-fg-subtle" title={m.projectsRoot}>{tail(m.projectsRoot, 72)}</div>
        </div>
        <MenuTrigger>
          <Button variant="ghost" size="xs" isIconOnly aria-label="Machine options" className="text-fg-muted">
            <IconDots size={16} stroke={1.5} />
          </Button>
          <Menu placement="bottom end" onAction={(k) => (k === "edit" ? setEditRoot(true) : setConfirm(true))}>
            <MenuItem id="edit">Rename or change folder</MenuItem>
            <MenuSeparator />
            <MenuItem id="remove" variant="danger">
              Remove
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      {m.agents.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 pl-11">
          {m.agents.map((a) => (
            <Badge key={a.id} tone={a.ok ? "neutral" : "warning"} title={a.note}>
              {agentLabel(a.id)}
              {a.version ? ` ${a.version}` : a.ok ? "" : " · not set up"}
            </Badge>
          ))}
        </div>
      )}
      {m.agents.some((a) => !a.ok && a.note) && (
        <ul className="mt-1.5 space-y-0.5 pl-11 text-[12px] text-fg-subtle">
          {m.agents
            .filter((a) => !a.ok && a.note)
            .map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className="min-w-0">{a.note}</span>
                {m.online && needsSignIn(a) && (
                  <Button size="xs" variant="secondary" onPress={() => openSignIn({ machineId: m.id, agent: a.id as "claude" | "codex" })}>
                    Sign in to {agentLabel(a.id)}
                  </Button>
                )}
              </li>
            ))}
        </ul>
      )}
      {editRoot && (
        <form
          className="mt-3 flex flex-col gap-2 pl-11 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextField size="sm" aria-label="Name" value={name} onChange={setName} className="sm:w-40" />
          <TextField size="sm" aria-label="Projects folder" value={root} onChange={setRoot} className="flex-1 font-mono" />
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onPress={() => setEditRoot(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      )}
      <Confirm
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={`Remove ${m.name}?`}
        description="Its projects and threads are removed from Opal and the runner is signed out. Nothing on the machine is deleted."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={async () => {
          await apiFetch(`/api/code/machines/${m.id}`, { method: "DELETE" });
          await mutate(STATE_KEY);
          setConfirm(false);
        }}
      />
    </div>
  );
}

function Copyable({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-line-subtle bg-code px-3 py-2">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[12.5px] leading-5">{text}</code>
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }}
        className="pressable -mr-1 grid size-6 shrink-0 place-items-center rounded-[6px] text-fg-muted hover:bg-surface hover:text-fg"
      >
        {done ? <IconCheck size={14} stroke={1.75} /> : <IconCopy size={14} stroke={1.5} />}
      </button>
    </div>
  );
}

type Pairing = { code: string; expiresAt: string; origins: { origin: string; label: string }[]; appImage: string[] };

function PairDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<Pairing | null>(null);
  const [error, setError] = useState<string>();
  const [how, setHow] = useState<"linux" | "source">("linux");
  const [pick, setPick] = useState(0);
  const { data } = useCodeState();
  const [startCount] = useState(() => data?.machines.length ?? 0);

  useEffect(() => {
    apiFetch<Pairing>("/api/code/machines", { method: "POST" }).then(
      (p) => {
        setCode(p);
        if (!p.appImage.length) setHow("source");
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  const paired = (data?.machines.length ?? 0) > startCount;
  const origin = code?.origins[pick]?.origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const tabs = [
    { id: "linux" as const, label: "Linux (AppImage)" },
    { id: "source" as const, label: "From source" },
  ];

  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} size="md">
      <Dialog
        title="Connect a machine"
        footer={(close) => (
          <Button size="sm" variant={paired ? "primary" : "ghost"} onPress={close}>
            {paired ? "Done" : "Close"}
          </Button>
        )}
      >
        <div className="flex flex-col gap-4 text-[13.5px]">
          <div className="inline-flex h-8 self-start rounded-[16px] bg-surface p-0.5" role="radiogroup" aria-label="How to install">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={how === t.id}
                onClick={() => setHow(t.id)}
                className={cn(
                  "inline-flex h-7 items-center rounded-[14px] px-3 text-[12.5px] transition-colors",
                  how === t.id ? "bg-overlay text-fg shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-fg-muted hover:text-fg",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {code && code.origins.length > 1 && (
            <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-muted">
              <span className="whitespace-nowrap">Opal&apos;s address from that machine</span>
              <select
                value={pick}
                onChange={(e) => setPick(Number(e.target.value))}
                className="h-7 min-w-0 rounded-[8px] border border-line-subtle bg-overlay px-2 font-mono text-[12px] text-fg"
              >
                {code.origins.map((o, i) => (
                  <option key={o.origin} value={i}>
                    {o.origin} ({o.label})
                  </option>
                ))}
              </select>
            </label>
          )}

          {how === "linux" ? (
            <>
              <p className="text-fg-muted">
                Run this on the Linux machine (64-bit Intel or ARM, such as a Raspberry Pi or an Umbrel VM). It installs the runner with Claude Code built in, connects it, and starts it as a service.
              </p>
              {code ? (
                code.appImage.length ? (
                  <Copyable text={`curl -fsSL '${origin}/api/code/runner/install?code=${code.code}' | sh`} />
                ) : (
                  <p className="text-[12.5px] text-warning">
                    The AppImage hasn&apos;t been built on this server. Run <code className="font-mono">npm run appimage</code> in apps/runner, or install from source.
                  </p>
                )
              ) : error ? (
                <p className="text-danger">{error}</p>
              ) : (
                <Skeleton className="h-9 rounded-[10px]" />
              )}
              <p className="text-[12.5px] text-fg-subtle">
                The machine needs Git for projects. If Claude Code isn&apos;t signed in there yet, a Sign in button shows up on the machine once it connects.
              </p>
            </>
          ) : (
            <>
              <p className="text-fg-muted">The machine needs Node 22+, Git, and Claude Code or Codex. Run this in the opal-ai repo on that machine:</p>
              <div className="flex flex-col gap-2">
                <Copyable text="cd apps/runner && npm install" />
                {code ? <Copyable text={`npm run pair -- ${origin} ${code.code} --root ~/Projects`} /> : error ? <p className="text-danger">{error}</p> : <Skeleton className="h-9 rounded-[10px]" />}
                <Copyable text="npm start" />
              </div>
            </>
          )}
          <p className="text-[12.5px] text-fg-subtle">The code works once and expires in 15 minutes. New projects go in ~/Projects; change it any time.</p>
          {paired && (
            <p className="flex items-center gap-1.5 text-success">
              <IconCheck size={15} stroke={1.75} /> Connected
            </p>
          )}
        </div>
      </Dialog>
    </Modal>
  );
}
