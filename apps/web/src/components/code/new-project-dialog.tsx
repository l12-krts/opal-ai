"use client";

import { tail } from "./command-palette";
import { useState } from "react";
import { mutate } from "swr";
import { Button, Dialog, Modal, Select, SelectItem, Switch, TextField, toast } from "krts.ui";
import { apiFetch } from "@/lib/api";
import { STATE_KEY } from "@/lib/code-client";
import type { MachineView, ProjectView } from "@/lib/code-types";

export function NewProjectDialog({ machines, onClose, onCreated }: { machines: MachineView[]; onClose: () => void; onCreated?: (p: ProjectView) => void }) {
  const [machineId, setMachineId] = useState(machines.find((m) => m.online)?.id ?? machines[0]?.id ?? "");
  const [name, setName] = useState("");
  const [existing, setExisting] = useState(false);
  const [path, setPath] = useState("");
  const [git, setGit] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const machine = machines.find((m) => m.id === machineId);
  const sep = machine?.os === "win32" ? "\\" : "/";
  const valid = name.trim().length > 0 && (!existing || path.trim().length > 1);

  async function create() {
    if (!valid) return;
    setPending(true);
    setError(undefined);
    try {
      const { project } = await apiFetch<{ project: ProjectView }>("/api/code/projects", {
        method: "POST",
        json: { machineId, name: name.trim(), git, ...(existing ? { existingPath: path.trim() } : {}) },
      });
      await mutate(STATE_KEY);
      toast.success(`${project.name} is ready`);
      onCreated?.(project);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} size="sm">
      <Dialog
        title="New project"
        footer={(close) => (
          <>
            <Button size="sm" variant="ghost" onPress={close}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" isPending={pending} isDisabled={!valid || !machine?.online} onPress={create}>
              Create
            </Button>
          </>
        )}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          {machines.length > 1 && (
            <Select label="Machine" size="sm" selectedKey={machineId} onSelectionChange={(k) => setMachineId(String(k))} items={machines.map((m) => ({ id: m.id, label: m.online ? m.name : `${m.name} (offline)` }))}>
              {(item: { id: string; label: string }) => (
                <SelectItem id={item.id} textValue={item.label}>
                  {item.label}
                </SelectItem>
              )}
            </Select>
          )}
          <TextField size="sm" label="Name" value={name} onChange={setName} autoFocus maxLength={60} placeholder="my-app" />
          {existing ? (
            <TextField size="sm" label="Folder" value={path} onChange={setPath} placeholder={machine?.os === "win32" ? "C:\\code\\my-app" : "~/code/my-app"} className="font-mono" />
          ) : (
            <p className="-mt-2 truncate font-mono text-[12px] text-fg-subtle">
              {tail(`${machine?.projectsRoot ?? ""}${sep}${name.trim() || "name"}`, 56)}
            </p>
          )}
          <div className="flex flex-col gap-2.5 text-[13.5px]">
            <Switch size="sm" isSelected={existing} onChange={setExisting}>
              Use an existing folder
            </Switch>
            {!existing && (
              <Switch size="sm" isSelected={git} onChange={setGit}>
                Git repository
              </Switch>
            )}
          </div>
          {machine && !machine.online && <p className="text-[13px] text-warning">{machine.name} is offline.</p>}
          {error && <p className="text-[13px] text-danger">{error}</p>}
        </form>
      </Dialog>
    </Modal>
  );
}
