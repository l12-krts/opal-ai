"use client";

import { tail } from "@/components/code/command-palette";
import { useState } from "react";
import Link from "next/link";
import { mutate } from "swr";
import { Button, Skeleton } from "krts.ui";
import { IconBrandGit, IconFolder, IconPlus, IconTrash } from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { STATE_KEY, useCodeState } from "@/lib/code-client";
import type { ProjectView } from "@/lib/code-types";
import { NewProjectDialog } from "@/components/code/new-project-dialog";
import { EmptyRow, Group, SettingsPage } from "@/components/settings-ui";
import { Confirm, IconButton } from "@/components/ui";

export default function ProjectsPage() {
  const { data } = useCodeState();
  const [creating, setCreating] = useState(false);
  const noMachines = data && !data.machines.length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SettingsPage
        title="Projects"
        info="A project is a folder on one of your machines. New projects are created in that machine's projects folder."
        action={
          <Button size="sm" variant="primary" isDisabled={!data?.machines.length} startContent={<IconPlus size={15} stroke={1.75} />} onPress={() => setCreating(true)}>
            New project
          </Button>
        }
      >
        {!data && <Skeleton className="h-24 rounded-[14px]" />}
        {noMachines && (
          <Group>
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px]">
              <span className="text-fg-muted">Connect a machine first.</span>
              <Link href="/code/machines" className="text-accent-line underline underline-offset-2">
                Machines
              </Link>
            </div>
          </Group>
        )}
        {data?.machines.map((m) => {
          const list = data.projects.filter((p) => p.machineId === m.id);
          return (
            <Group key={m.id} title={m.name}>
              {!list.length && <EmptyRow>No projects on this machine</EmptyRow>}
              {list.map((p) => (
                <ProjectRow key={p.id} p={p} />
              ))}
            </Group>
          );
        })}
      </SettingsPage>
      {creating && data && <NewProjectDialog machines={data.machines} onClose={() => setCreating(false)} />}
    </div>
  );
}

function ProjectRow({ p }: { p: ProjectView }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="group flex min-h-12 items-center gap-3 px-4 py-2.5">
      <IconFolder size={17} stroke={1.5} className="shrink-0 text-fg-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13.5px]">
          {p.name}
          {p.isGit && <IconBrandGit size={13} stroke={1.5} className="text-fg-subtle" aria-label="Git repository" />}
        </div>
        <div className="truncate font-mono text-[11.5px] text-fg-subtle" title={p.path}>{tail(p.path, 72)}</div>
      </div>
      <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        <IconButton label="Remove from Opal" onPress={() => setConfirm(true)}>
          <IconTrash size={15} stroke={1.5} />
        </IconButton>
      </div>
      <Confirm
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={`Remove ${p.name}?`}
        description="It's removed from Opal only. The folder stays on the machine."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={async () => {
          await apiFetch(`/api/code/projects/${p.id}`, { method: "DELETE" });
          await mutate(STATE_KEY);
          setConfirm(false);
        }}
      />
    </div>
  );
}
