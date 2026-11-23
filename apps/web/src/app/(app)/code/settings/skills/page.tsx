"use client";

// Opal Code → Settings → Skills. Instructions you hand to coding agents with "/Skill name" in
// the Code composer. Separate from Opal chat's skills.
import { useState } from "react";
import { mutate } from "swr";
import { Button, Dialog, Modal, Skeleton, Switch, TextAreaField, TextField, toast } from "krts.ui";
import { IconPlus, IconTrash, IconWand } from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { CODE_SKILLS_KEY, useCodeSkills } from "@/lib/code-client";
import type { CodeSkillView } from "@/lib/code-types";
import { Confirm } from "@/components/ui";
import { Group, InfoTip, Row, SettingsPage } from "@/components/settings-ui";

type Draft = Partial<CodeSkillView>;

const EXAMPLES: Draft[] = [
  {
    name: "Review",
    description: "Review the current changes before I commit",
    instructions: `Review the uncommitted changes (git diff) as a strict senior reviewer.
1. List real bugs first, each with file:line and a one-line fix.
2. Then risky patterns (security, races, missing error handling).
3. Skip style nits unless they hide a bug.
Do not edit files; report only.`,
  },
  {
    name: "Tests",
    description: "Write tests for what I just changed",
    instructions: `Find the code changed in this branch and write focused tests for it using the project's existing test setup.
Cover the main path and the edge cases that could break.
Run the tests and fix any test that fails because of the test itself. Report anything that fails because of the code.`,
  },
  {
    name: "Ship",
    description: "Typecheck, test, then commit with a clear message",
    instructions: `1. Run the project's typecheck and tests; fix what fails.
2. Commit with a short imperative subject line and a short body explaining why.
3. Don't push unless I ask.`,
  },
];

export default function CodeSkillsPage() {
  const { data } = useCodeSkills();
  const [editing, setEditing] = useState<Draft | null>(null);
  const list = data?.skills ?? [];
  const examples = EXAMPLES.filter((e) => !list.some((s) => s.name.toLowerCase() === e.name!.toLowerCase()));

  async function toggle(s: CodeSkillView, enabled: boolean) {
    await mutate<{ skills: CodeSkillView[] }>(
      CODE_SKILLS_KEY,
      async (cur) => {
        await apiFetch(`/api/code/skills/${s.id}`, { method: "PATCH", json: { enabled } });
        return cur;
      },
      { optimisticData: (cur) => ({ skills: (cur?.skills ?? []).map((x) => (x.id === s.id ? { ...x, enabled } : x)) }), revalidate: true },
    ).catch((e: Error) => toast.error(e.message));
  }

  return (
    <SettingsPage
      title="Skills"
      info="Instructions for coding agents. Type / in the Code composer to use one. These are separate from Opal chat's skills."
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
                <Row icon={<IconWand size={16} stroke={1.5} />} label={`/${s.name}`} sub={s.description || undefined} />
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
            <Row key={e.name} icon={<IconWand size={16} stroke={1.5} />} label={`/${e.name}`} sub={e.description}>
              <Button size="xs" variant="ghost" onPress={() => setEditing(e)}>
                Use
              </Button>
            </Row>
          ))}
        </Group>
      )}

      {editing && <SkillEditor skill={editing} onClose={() => setEditing(null)} />}
    </SettingsPage>
  );
}

function SkillEditor({ skill, onClose }: { skill: Draft; onClose: () => void }) {
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
      if (skill.id) await apiFetch(`/api/code/skills/${skill.id}`, { method: "PATCH", json });
      else await apiFetch("/api/code/skills", { method: "POST", json });
      toast.success(skill.id ? "Saved" : `/${json.name} added`);
      await mutate(CODE_SKILLS_KEY);
      onClose();
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
            <TextField size="sm" label="Name" value={name} onChange={setName} maxLength={40} autoFocus={!skill.name} placeholder="Review" />
            <div>
              <div className="mb-1.5 flex items-center gap-1 text-sm font-medium">
                When to use
                <InfoTip text="Shown next to the skill in the / menu." />
              </div>
              <TextField size="sm" aria-label="When to use" value={description} onChange={setDescription} maxLength={240} placeholder="Review the current changes" />
            </div>
            <TextAreaField label="Instructions" rows={10} value={instructions} onChange={setInstructions} maxLength={12000} placeholder="What the agent should do, step by step" className="font-mono text-[13px]" />
            {error && <p className="text-[13px] text-danger">{error}</p>}
          </form>
        </Dialog>
      </Modal>
      {skill.id && (
        <Confirm
          isOpen={confirmDelete}
          onOpenChange={(o: boolean) => !o && setConfirmDelete(false)}
          title={`Delete /${skill.name}?`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={async () => {
            await apiFetch(`/api/code/skills/${skill.id}`, { method: "DELETE" });
            await mutate(CODE_SKILLS_KEY);
            onClose();
          }}
        />
      )}
    </>
  );
}
