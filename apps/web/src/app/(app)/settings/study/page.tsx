"use client";

import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Button, Dialog, Modal, Select, SelectItem, Skeleton, TextField, toast } from "krts.ui";
import { IconArrowRight, IconCards, IconListCheck, IconSchool } from "@tabler/icons-react";
import { apiFetch, fetcher } from "@/lib/api";
import { Quiz } from "@/components/chat/parts/quiz";
import { Flashcards } from "@/components/chat/parts/flashcards";
import { ChatActionsProvider } from "@/components/chat/chat-context";
import { EmptyRow, Group, Row, SettingsPage, Status } from "@/components/settings-ui";

const GRADES: [string, string][] = [
  ["K01", "Α΄ Δημοτικού"],
  ["K02", "Β΄ Δημοτικού"],
  ["K03", "Γ΄ Δημοτικού"],
  ["K04", "Δ΄ Δημοτικού"],
  ["K05", "Ε΄ Δημοτικού"],
  ["K06", "ΣΤ΄ Δημοτικού"],
  ["K07", "Α΄ Γυμνασίου"],
  ["K08", "Β΄ Γυμνασίου"],
  ["K09", "Γ΄ Γυμνασίου"],
  ["K10", "Α΄ Λυκείου"],
  ["K11", "Β΄ Λυκείου"],
  ["K12", "Γ΄ Λυκείου"],
];

type ArtifactRow = { id: string; kind: "quiz" | "flashcards" | "handwriting"; title: string; createdAt: string };

export default function StudySettingsPage() {
  const router = useRouter();
  const startStudy = (prompt?: string) => {
    const key = Date.now().toString(36);
    router.push(`/?mode=study&new=${key}${prompt ? `&q=${encodeURIComponent(prompt)}` : ""}`);
  };

  return (
    <SettingsPage
      title="Study"
      info="Study AI reads your textbooks and course material, then explains, quizzes and makes flashcards. Any chat or agent can call it."
      action={
        <Button size="sm" variant="primary" startContent={<IconSchool size={15} stroke={1.5} />} onPress={() => startStudy()}>
          Start studying
        </Button>
      }
    >
      <EclassGroup />
      <TextbooksGroup onStudy={startStudy} />
      <PracticeGroup />
    </SettingsPage>
  );
}

function EclassGroup() {
  const { data, mutate } = useSWR<{ sources: { kind: string; label: string; config: Record<string, string> }[] }>("/api/study/sources", fetcher);
  const eclass = data?.sources.find((s) => s.kind === "eclass");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const dirty = Boolean(url || username || password);

  async function save() {
    setPending(true);
    try {
      await apiFetch("/api/study/sources", { method: "PUT", json: { kind: "eclass", baseUrl: url || eclass?.config.baseUrl, username: username || eclass?.config.username } });
      if (password) {
        await apiFetch("/api/secrets", { method: "POST", json: { name: "ECLASS_PASSWORD", label: "eClass password", description: "Used by the Study AI to read your eClass", value: password } });
      }
      setUrl("");
      setUsername("");
      setPassword("");
      await mutate();
      toast.success("eClass saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Group
        title="Open eClass"
        info="Your university's eClass. If it only allows single sign-on, Study AI signs in with its own browser instead."
        action={<Status ok={Boolean(eclass)}>{eclass ? eclass.label : "Not set up"}</Status>}
      >
        <Row label="Address">
          <TextField
            aria-label="eClass address"
            size="sm"
            type="url"
            value={url}
            onChange={setUrl}
            placeholder={eclass?.config.baseUrl ?? "https://eclass.uoa.gr"}
            className="w-[min(52vw,260px)]"
          />
        </Row>
        <Row label="Username">
          <TextField
            aria-label="eClass username"
            size="sm"
            value={username}
            onChange={setUsername}
            placeholder={eclass?.config.username ?? ""}
            className="w-[min(52vw,260px)]"
          />
        </Row>
        <Row label="Password" info="Kept encrypted in your secrets vault. The AI never sees it.">
          <TextField
            aria-label="eClass password"
            size="sm"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            placeholder={eclass ? "Saved" : ""}
            className="w-[min(52vw,260px)]"
          />
        </Row>
        {(dirty || !eclass) && (
          <div className="flex justify-end px-4 py-2.5">
            <Button size="sm" type="submit" variant="secondary" isPending={pending} isDisabled={!eclass ? !url || !username : !dirty}>
              Save
            </Button>
          </div>
        )}
      </Group>
    </form>
  );
}

function TextbooksGroup({ onStudy }: { onStudy: (p: string) => void }) {
  const [grade, setGrade] = useState("K10");
  const { data, isLoading } = useSWR<{ items: { id: string; title: string; subtitle?: string }[] }>(`/api/study/browse?source=ebooks&ref=grade:${grade}`, fetcher, {
    revalidateOnFocus: false,
  });
  const books = (data?.items ?? []).filter((b, i, arr) => arr.findIndex((x) => x.title === b.title) === i);

  return (
    <Group
      title="Textbooks"
      info="School books from ebooks.edu.gr."
      action={
        <Select
          aria-label="Grade"
          size="sm"
          className="w-[170px]"
          selectedKey={grade}
          onSelectionChange={(k) => k && setGrade(String(k))}
          items={GRADES.map(([id, label]) => ({ id, label }))}
        >
          {(item: { id: string; label: string }) => (
            <SelectItem id={item.id} textValue={item.label}>
              {item.label}
            </SelectItem>
          )}
        </Select>
      }
      className="max-h-[380px] overflow-y-auto"
    >
      {isLoading && (
        <div className="flex flex-col gap-2 p-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      )}
      {!isLoading && !books.length && <EmptyRow>No books for this grade right now</EmptyRow>}
      {books.slice(0, 80).map((b) => (
        <Row key={b.id} label={b.title} sub={b.subtitle}>
          <Button
            size="xs"
            variant="ghost"
            endContent={<IconArrowRight size={13} stroke={1.5} />}
            onPress={() => onStudy(`Βοήθησέ με να μελετήσω το βιβλίο «${b.title}». Ref: ${b.id}`)}
          >
            Study
          </Button>
        </Row>
      ))}
    </Group>
  );
}

function PracticeGroup() {
  const { data, isLoading } = useSWR<{ artifacts: ArtifactRow[] }>("/api/artifacts?kinds=quiz,flashcards", fetcher);
  const [open, setOpen] = useState<string | null>(null);
  const list = data?.artifacts ?? [];

  return (
    <Group title="Practice" info="Quizzes and flashcards you make in chats.">
      {isLoading && (
        <div className="p-3">
          <Skeleton className="h-9" />
        </div>
      )}
      {!isLoading && !list.length && <EmptyRow>Nothing yet</EmptyRow>}
      {list.map((a) => (
        <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="pressable block w-full text-left hover:bg-surface/60">
          <Row
            icon={a.kind === "quiz" ? <IconListCheck size={16} stroke={1.5} /> : <IconCards size={16} stroke={1.5} />}
            label={a.title}
          >
            <span className="text-[12px] tabular-nums text-fg-subtle">{new Date(a.createdAt).toLocaleDateString()}</span>
          </Row>
        </button>
      ))}
      {open && <ArtifactDialog id={open} onClose={() => setOpen(null)} />}
    </Group>
  );
}

function ArtifactDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useSWR<{ artifact: { kind: string; title: string; data: any } }>(`/api/artifacts/${id}`, fetcher);
  const a = data?.artifact;
  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} size="lg">
      <Dialog title={a?.title ?? " "}>
        <ChatActionsProvider value={{ nerd: false, send: () => {}, approve: () => {}, answerTool: () => {}, regenerate: () => {}, openSandbox: () => {} }}>
          {!a && <Skeleton className="h-64 rounded-[12px]" />}
          {a?.kind === "quiz" && <Quiz title={a.title} questions={a.data.questions} />}
          {a?.kind === "flashcards" && <Flashcards title={a.title} cards={a.data.cards} />}
        </ChatActionsProvider>
      </Dialog>
    </Modal>
  );
}
