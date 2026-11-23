"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button, SearchField, Skeleton, Switch, TextField, cn, toast } from "krts.ui";
import { IconPlus, IconTrash, IconUser } from "@tabler/icons-react";
import { apiFetch, fetcher } from "@/lib/api";
import { updateSettings, useSettings } from "@/lib/hooks";
import { OpalMark } from "@/components/brand";
import { Confirm, IconButton } from "@/components/ui";
import { EmptyRow, Group, Row, SettingsPage } from "@/components/settings-ui";

type MemoryRow = { id: string; content: string; source: "opal" | "user"; createdAt: string };

export default function MemoryPage() {
  const { data: settings } = useSettings();
  const enabled = settings?.settings.memoryEnabled ?? true;
  const { data, mutate } = useSWR<{ memories: MemoryRow[] }>("/api/memory", fetcher);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [clearing, setClearing] = useState(false);
  const list = data?.memories ?? [];
  const shown = q ? list.filter((m) => m.content.toLowerCase().includes(q.toLowerCase())) : list;

  async function add() {
    const content = draft.trim();
    if (content.length < 2) return;
    try {
      await apiFetch("/api/memory", { method: "POST", json: { content } });
      setDraft("");
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <SettingsPage title="Memory" info="What Opal remembers about you across chats. It adds to this as you talk, and you can change anything here.">
      <Group>
        <Row label="Use memory">
          <Switch size="sm" isSelected={enabled} onChange={(v) => void updateSettings({ memoryEnabled: v })} aria-label="Use memory" />
        </Row>
        <form
          className="flex items-center gap-2 px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <TextField size="sm" aria-label="Something to remember" placeholder="Add something to remember" value={draft} onChange={setDraft} maxLength={500} className="flex-1" />
          <Button size="sm" type="submit" variant="secondary" isIconOnly aria-label="Add memory" isDisabled={draft.trim().length < 2}>
            <IconPlus size={15} stroke={1.75} />
          </Button>
        </form>
      </Group>

      <Group
        title={list.length ? `Saved · ${list.length}` : "Saved"}
        action={
          <>
            {list.length > 8 && <SearchField size="sm" aria-label="Search memories" placeholder="Search" value={q} onChange={setQ} className="w-[180px]" />}
            {list.length > 0 && (
              <Button size="xs" variant="ghost" className="text-fg-muted" onPress={() => setClearing(true)}>
                Clear all
              </Button>
            )}
          </>
        }
        className={cn("transition-opacity duration-200", !enabled && "opacity-60")}
      >
        {!data && (
          <div className="p-3">
            <Skeleton className="h-9" />
          </div>
        )}
        {data && !list.length && <EmptyRow>Nothing yet</EmptyRow>}
        {data && list.length > 0 && !shown.length && <EmptyRow>No matches</EmptyRow>}
        {shown.map((m) => (
          <MemoryItem key={m.id} memory={m} onChanged={() => mutate()} />
        ))}
      </Group>

      <Confirm
        isOpen={clearing}
        onOpenChange={setClearing}
        title="Forget everything?"
        description="All saved memories are deleted. This can't be undone."
        confirmLabel="Forget all"
        variant="danger"
        onConfirm={async () => {
          await apiFetch("/api/memory", { method: "DELETE" });
          setClearing(false);
          await mutate();
        }}
      />
    </SettingsPage>
  );
}

function MemoryItem({ memory: m, onChanged }: { memory: MemoryRow; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(m.content);

  async function save() {
    setEditing(false);
    const next = value.trim();
    if (!next || next === m.content) return setValue(m.content);
    try {
      await apiFetch(`/api/memory/${m.id}`, { method: "PATCH", json: { content: next } });
      onChanged();
    } catch (e) {
      setValue(m.content);
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="group flex items-start gap-3 px-4 py-2.5">
      <span className="mt-[3px] grid size-4 shrink-0 place-items-center text-fg-subtle" aria-label={m.source === "opal" ? "Saved by Opal" : "Added by you"} role="img">
        {m.source === "opal" ? <OpalMark size={13} /> : <IconUser size={15} stroke={1.5} />}
      </span>
      {editing ? (
        <input
          autoFocus
          value={value}
          maxLength={500}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setValue(m.content);
              setEditing(false);
            }
          }}
          aria-label="Edit memory"
          className="-my-1 min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-2 py-1 text-[13.5px] outline-none focus:border-accent-line"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-w-0 flex-1 cursor-text text-left text-[13.5px] leading-[1.45] text-fg/90"
          aria-label={`Edit: ${m.content}`}
        >
          {m.content}
        </button>
      )}
      <div className="-my-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        <IconButton
          label="Forget"
          onPress={async () => {
            await apiFetch(`/api/memory/${m.id}`, { method: "DELETE" });
            onChanged();
          }}
        >
          <IconTrash size={15} stroke={1.5} />
        </IconButton>
      </div>
    </div>
  );
}
