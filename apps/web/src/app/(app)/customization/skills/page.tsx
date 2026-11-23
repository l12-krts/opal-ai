"use client";

import { useState } from "react";
import { Button, Dialog, Modal, Skeleton, Switch, TextAreaField, TextField, toast } from "krts.ui";
import { IconPlus, IconTrash, IconWand } from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { refreshSkills, useSkills, type SkillRow } from "@/lib/hooks";
import { Confirm } from "@/components/ui";
import { Group, InfoTip, Row, SettingsPage } from "@/components/settings-ui";

type Draft = Partial<SkillRow>;

const EXAMPLES: Draft[] = [
  {
    name: "Exam prep",
    description: "When I'm preparing for a test or exam",
    instructions: `1. If I didn't say, ask for the subject, the chapters and the exam date.
2. Find the material with the study tools and read it.
3. Write a one-page summary of the key points.
4. Make a 10-question quiz with an explanation for every option, then flashcards for definitions.
5. End with a short revision plan up to the exam date.`,
  },
  {
    name: "Email in my voice",
    description: "When writing or replying to an email",
    instructions: `Write like me: short, warm, no corporate phrases.
Reply in the language the other person used.
Start with the point and end with one clear next step.
Sign with my first name only.
Show me the draft. Never send without asking.`,
  },
  {
    name: "Research brief",
    description: "When I ask to research or compare something",
    instructions: `Search the web for at least four good sources and read them.
Then write:
- a three-sentence summary
- a comparison table when there are options
- pros and cons, and a recommendation
List the sources with links at the end.`,
  },
];

export default function SkillsPage() {
  const { data, mutate } = useSkills();
  const [editing, setEditing] = useState<Draft | null>(null);
  const list = data?.skills ?? [];
  const examples = EXAMPLES.filter((e) => !list.some((s) => s.name.toLowerCase() === e.name!.toLowerCase()));

  async function toggle(s: SkillRow, enabled: boolean) {
    await mutate(
      async (cur) => {
        await apiFetch(`/api/skills/${s.id}`, { method: "PATCH", json: { enabled } });
        return cur;
      },
      { optimisticData: (cur) => ({ skills: (cur?.skills ?? []).map((x) => (x.id === s.id ? { ...x, enabled } : x)) }), revalidate: true },
    ).catch((e: Error) => toast.error(e.message));
  }

  return (
    <SettingsPage
      title="Skills"
      info="Instructions Opal follows when a task fits. Type / in a chat to use one directly."
      action={
        <Button size="sm" variant="primary" startContent={<IconPlus size={15} stroke={1.75} />} onPress={() => setEditing({})}>
          New skill
        </Button>
      }
    >
      {!data && <Skeleton className="h-24 rounded-[14px]" />}

      {list.length > 0 && (
        <Group>
          {list.map((s) => (
            <div key={s.id} className="flex items-center">
              <button type="button" onClick={() => setEditing(s)} className="pressable min-w-0 flex-1 text-left hover:bg-surface/60">
                <Row icon={<IconWand size={16} stroke={1.5} />} label={s.name} sub={s.description || undefined} />
              </button>
              <div className="px-4">
                <Switch size="sm" isSelected={s.enabled} onChange={(v) => void toggle(s, v)} aria-label={`Use ${s.name}`} />
              </div>
            </div>
          ))}
        </Group>
      )}

      {data && examples.length > 0 && (
        <Group title={list.length ? "Examples" : "Start from an example"}>
          {examples.map((e) => (
            <Row key={e.name} icon={<IconWand size={16} stroke={1.5} />} label={e.name} sub={e.description}>
              <Button size="xs" variant="ghost" onPress={() => setEditing(e)}>
                Use
              </Button>
            </Row>
          ))}
        </Group>
      )}

      {editing && (
        <SkillEditor
          skill={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refreshSkills();
          }}
        />
      )}
    </SettingsPage>
  );
}

function SkillEditor({ skill, onClose, onSaved }: { skill: Draft; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(skill.name ?? "");
  const [description, setDescription] = useState(skill.description ?? "");
  const [instructions, setInstructions] = useState(skill.instructions ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const valid = name.trim().length >= 2 && instructions.trim().length >= 10;

  async function save() {
    if (!valid) return;
    setPending(true);
    setError(undefined);
    try {
      const json = { name: name.trim(), description: description.trim(), instructions: instructions.trim() };
      if (skill.id) await apiFetch(`/api/skills/${skill.id}`, { method: "PATCH", json });
      else await apiFetch("/api/skills", { method: "POST", json });
      toast.success(skill.id ? "Saved" : `${json.name} added`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Modal isOpen={!confirmDelete} onOpenChange={(o) => !o && onClose()} size="md">
        <Dialog
          title={skill.id ? "Edit skill" : "New skill"}
          footer={(close) => (
            <>
              {skill.id && (
                <Button size="sm" variant="ghost" className="mr-auto text-danger" startContent={<IconTrash size={15} stroke={1.5} />} onPress={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
              <Button size="sm" variant="ghost" onPress={close}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" isPending={pending} isDisabled={!valid} onPress={save}>
                Save
              </Button>
            </>
          )}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <TextField size="sm" label="Name" value={name} onChange={setName} maxLength={40} autoFocus={!skill.name} placeholder="Exam prep" />
            <div>
              <div className="mb-1.5 flex items-center gap-1 text-sm font-medium">
                When to use
                <InfoTip text="Opal reads this to decide when to load the skill." />
              </div>
              <TextField size="sm" aria-label="When to use" value={description} onChange={setDescription} maxLength={240} placeholder="When I'm preparing for an exam" />
            </div>
            <TextAreaField label="Instructions" rows={11} value={instructions} onChange={setInstructions} maxLength={12000} placeholder="Steps, tone, format…" className="text-[13.5px]" />
            {error && <p className="text-[13px] text-danger">{error}</p>}
          </form>
        </Dialog>
      </Modal>
      {skill.id && (
        <Confirm
          isOpen={confirmDelete}
          onOpenChange={(o: boolean) => !o && setConfirmDelete(false)}
          title={`Delete ${skill.name}?`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={async () => {
            await apiFetch(`/api/skills/${skill.id}`, { method: "DELETE" });
            onSaved();
          }}
        />
      )}
    </>
  );
}
