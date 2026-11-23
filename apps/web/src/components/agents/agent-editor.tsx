"use client";
// Create or edit an agent: a name, a shape and a color. That's all an agent is.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Modal, TextField, cn, toast } from "krts.ui";
import { IconTrash } from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { refreshAgents } from "@/lib/hooks";
import { AGENT_COLORS } from "@/lib/types";
import { AGENT_SHAPES } from "@/lib/agent-shapes";
import { t } from "@/lib/i18n";
import { AgentFace } from "../agent-face";
import { Confirm } from "../ui";

export type EditableAgent = { id: string; name: string; color: string; shape?: string };

export function AgentEditor({ agent, onClose }: { agent?: EditableAgent; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(agent?.name ?? "");
  const [color, setColor] = useState(agent?.color ?? AGENT_COLORS[1].value);
  const [shape, setShape] = useState(() => agent?.shape ?? AGENT_SHAPES[Math.floor(Math.random() * AGENT_SHAPES.length)].id);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const valid = name.trim().length >= 2;

  async function save() {
    if (!valid) return;
    setPending(true);
    setError(undefined);
    try {
      const body = { name: name.trim(), color, shape };
      if (agent) {
        await apiFetch(`/api/agents/${agent.id}`, { method: "PATCH", json: body });
        toast.success("Saved");
      } else {
        const { agent: row } = await apiFetch<{ agent: { id: string } }>("/api/agents", { method: "POST", json: body });
        router.push(`/agents/${row.id}`);
      }
      await refreshAgents();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Modal isOpen={!confirmDelete} onOpenChange={(o) => !o && onClose()} size="sm">
        <Dialog
          title={agent ? t("agents.edit") : t("agents.new")}
          footer={(close) => (
            <>
              {agent && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mr-auto text-danger"
                  startContent={<IconTrash size={15} stroke={1.5} />}
                  onPress={() => setConfirmDelete(true)}
                >
                  {t("common.delete")}
                </Button>
              )}
              <Button size="sm" variant="ghost" onPress={close}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" variant="primary" isPending={pending} isDisabled={!valid} onPress={save}>
                {agent ? t("agents.save") : t("agents.create")}
              </Button>
            </>
          )}
        >
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid place-items-center pb-1 pt-2">
              <AgentFace shape={shape} color={color} size={88} seed={name || "new"} />
            </div>

            <TextField size="sm" label={t("agents.name")} value={name} onChange={setName} maxLength={24} autoFocus placeholder="Scout" />

            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t("agents.shape")}</legend>
              <div className="grid grid-cols-6 gap-1.5">
                {AGENT_SHAPES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={s.label}
                    aria-pressed={shape === s.id}
                    title={s.label}
                    onClick={() => setShape(s.id)}
                    className={cn(
                      "pressable grid aspect-square place-items-center rounded-[12px] transition-colors duration-150",
                      shape === s.id ? "bg-surface-hover ring-2 ring-fg/80" : "hover:bg-surface",
                    )}
                  >
                    <AgentFace shape={s.id} color={color} size={30} blink={false} />
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t("agents.color")}</legend>
              <div className="flex flex-wrap gap-2">
                {AGENT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={c.id}
                    aria-pressed={color === c.value}
                    onClick={() => setColor(c.value)}
                    className={cn("pressable size-7 rounded-full ring-offset-2 ring-offset-overlay", color === c.value && "ring-2 ring-fg")}
                    style={{ background: c.value }}
                  />
                ))}
              </div>
            </fieldset>

            {error && <p className="text-[13px] text-danger">{error}</p>}
          </form>
        </Dialog>
      </Modal>

      {agent && (
        <Confirm
          isOpen={confirmDelete}
          onOpenChange={(o: boolean) => {
            if (!o) setConfirmDelete(false);
          }}
          title={`Delete ${agent.name}?`}
          description={t("agents.deleteConfirm")}
          confirmLabel={t("common.delete")}
          variant="danger"
          onConfirm={async () => {
            await apiFetch(`/api/agents/${agent.id}`, { method: "DELETE" });
            await refreshAgents();
            onClose();
            router.push("/agents");
          }}
        />
      )}
    </>
  );
}
