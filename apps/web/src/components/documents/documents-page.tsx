"use client";
// Every document Opal and your agents made, newest change first: open one full screen, jump to
// the chat it came from, or delete it.
import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Button, Menu, MenuItem, MenuSeparator, MenuTrigger, SegmentedControl, Segment, Skeleton, toast } from "krts.ui";
import { IconDots, IconFiles, IconMessage, IconTrash } from "@tabler/icons-react";
import { apiFetch, fetcher } from "@/lib/api";
import { DOC_KINDS, KIND_LABEL, toSnapshot, type DocKind, type DocSnapshot } from "@/lib/documents";
import { Confirm, EmptyState } from "../ui";
import { DocPreview, DocumentViewer, kindIcon } from "./document";

type Row = { id: string; kind: string; title: string; createdAt: string; updatedAt: string; conversationId: string | null; data: Record<string, unknown> };
type Filter = "all" | DocKind;

const KEY = `/api/artifacts?kinds=${DOC_KINDS.join(",")}&data=1`;

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function DocumentsPage() {
  const { data, isLoading, mutate } = useSWR<{ artifacts: Row[] }>(KEY, fetcher);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<{ snap: DocSnapshot; conversationId: string | null } | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const docs = useMemo(
    () =>
      (data?.artifacts ?? [])
        .map((r) => ({ row: r, snap: toSnapshot(r) }))
        .filter((d): d is { row: Row; snap: DocSnapshot } => !!d.snap && (filter === "all" || d.snap.kind === filter)),
    [data, filter],
  );

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1080px] px-4 pb-16 pt-4 sm:px-8 sm:pt-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 max-md:pl-9">
          <div>
            <h1 className="text-[20px] font-medium tracking-[-0.01em]">Documents</h1>
            <p className="mt-0.5 text-[13.5px] text-fg-muted">Docs, slides, sheets, charts and whiteboards from your chats and agents.</p>
          </div>
        </div>
        <div className="-mx-1 mb-5 overflow-x-auto px-1">
          <SegmentedControl
            aria-label="Kind"
            size="sm"
            selectedKeys={[filter]}
            onSelectionChange={(k) => {
              const v = [...k][0] as Filter | undefined;
              if (v) setFilter(v);
            }}
          >
            <Segment id="all">All</Segment>
            {DOC_KINDS.map((k) => (
              <Segment key={k} id={k}>
                {KIND_LABEL[k].many}
              </Segment>
            ))}
          </SegmentedControl>
        </div>

        {isLoading && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[214px] rounded-card" />
            ))}
          </div>
        )}

        {!isLoading && !docs.length && (
          <EmptyState
            icon={<IconFiles size={22} stroke={1.5} />}
            title={filter === "all" ? "No documents yet" : `No ${KIND_LABEL[filter].many.toLowerCase()} yet`}
            body="Ask Opal in any chat: “write a one-page plan”, “make slides about…”, “put this in a sheet”, “chart these numbers”, “brainstorm on a whiteboard”."
            action={
              <Link href="/" className="text-[13px] text-fg underline underline-offset-2">
                Start a chat
              </Link>
            }
          />
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {docs.map(({ row, snap }) => {
            const Icon = kindIcon(snap.kind, snap.data);
            return (
              <div key={row.id} className="group relative overflow-hidden rounded-card border border-line-subtle bg-overlay transition-shadow hover:shadow-float">
                <div className="pointer-events-none" inert>
                  <div className="h-[150px] overflow-hidden border-b border-line-subtle">
                    <DocPreview snap={snap} height={150} />
                  </div>
                  <div className="flex items-center gap-2.5 py-2.5 pl-3 pr-10">
                    <Icon size={17} stroke={1.5} className="shrink-0 text-fg-muted" />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{snap.title}</p>
                      <p className="truncate text-[12px] text-fg-muted">
                        {KIND_LABEL[snap.kind].one} · {ago(row.updatedAt)}
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen({ snap, conversationId: row.conversationId })}
                  aria-label={`Open ${snap.title}`}
                  className="absolute inset-0 rounded-card outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-line"
                />
                <div className="absolute bottom-2.5 right-2">
                  <MenuTrigger>
                    <Button variant="ghost" size="xs" isIconOnly aria-label={`Options for ${snap.title}`} className="text-fg-muted">
                      <IconDots size={15} stroke={1.5} />
                    </Button>
                    <Menu
                      placement="bottom end"
                      onAction={(key) => {
                        if (key === "chat" && row.conversationId) window.location.assign(`/c/${row.conversationId}`);
                        if (key === "delete") setDeleting(row);
                      }}
                    >
                      {row.conversationId ? (
                        <MenuItem id="chat" icon={<IconMessage size={15} stroke={1.5} />}>
                          Open chat
                        </MenuItem>
                      ) : null}
                      {row.conversationId ? <MenuSeparator /> : null}
                      <MenuItem id="delete" variant="danger" icon={<IconTrash size={15} stroke={1.5} />}>
                        Delete
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {open && <DocumentViewer snap={open.snap} conversationId={open.conversationId} showChatLink onClose={() => setOpen(null)} />}

      <Confirm
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this document?"
        description={`“${deleting?.title ?? ""}” is deleted for good. Chats that showed it keep their copy.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await apiFetch(`/api/artifacts/${deleting.id}`, { method: "DELETE" });
            await mutate();
          } catch (err) {
            toast.error((err as Error).message);
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}
