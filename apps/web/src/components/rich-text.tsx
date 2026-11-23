"use client";

// Message text with @mentions and a leading /skill drawn as chips (chat and Opal Code bubbles).
import Link from "next/link";
import { IconFile, IconWand } from "@tabler/icons-react";
import { useAgents, useSkills } from "@/lib/hooks";
import { useCodeState } from "@/lib/code-client";
import { leadingSkill, richParts, type Mention } from "@/lib/code-types";
import { AgentFace } from "./agent-face";
import { AgentGlyph } from "./code/agent-glyph";

const chip =
  "mx-px inline-flex max-w-full items-center gap-1 rounded-[7px] border border-line/60 bg-overlay/80 px-1.5 align-[-0.12em] text-[0.93em] font-medium leading-[1.45] text-fg";

function MentionChip({ m, text }: { m: Mention; text: string }) {
  const { data: agents } = useAgents();
  const { data: code } = useCodeState();
  if (m.kind === "file")
    return (
      <span className={chip} title={m.id}>
        <IconFile size={13} stroke={1.6} className="shrink-0 text-fg-muted" />
        <span className="truncate font-mono text-[0.92em] font-normal">{m.label}</span>
      </span>
    );
  if (m.kind === "thread") {
    const t = code?.threads.find((x) => x.id === m.id);
    return (
      <Link href={`/code/t/${m.id}`} className={`${chip} hover:bg-surface`}>
        {t ? <AgentGlyph agent={t.agent} size={12} /> : null}
        <span className="truncate">{m.label}</span>
      </Link>
    );
  }
  const a = agents?.agents.find((x) => x.id === m.id || x.name === m.label);
  return (
    <span className={chip}>
      {a && <AgentFace shape={a.shape} color={a.color} size={14} seed={a.name} />}
      <span className="truncate">{a ? text.slice(1) : text}</span>
    </span>
  );
}

export function SkillChip({ name }: { name: string }) {
  return (
    <span className={chip}>
      <IconWand size={13} stroke={1.6} className="shrink-0 text-fg-muted" />/{name}
    </span>
  );
}

export function RichText({ text, mentions, skill }: { text: string; mentions?: Mention[]; skill?: string | null }) {
  const parts = richParts(text, mentions ?? [], skill ?? undefined);
  return (
    <>
      {parts.map((p, i) =>
        p.type === "text" ? <span key={i}>{p.text}</span> : p.type === "skill" ? <SkillChip key={i} name={p.name} /> : <MentionChip key={i} m={p.mention} text={p.text} />,
      )}
    </>
  );
}

/** Opal chat: @Agent names and a leading /skill (from the user's chat skills) become chips. */
export function ChatText({ text }: { text: string }) {
  const { data: agents } = useAgents();
  const { data: skills } = useSkills();
  const mentions: Mention[] = (agents?.agents ?? []).filter((a) => text.includes(`@${a.name}`)).map((a) => ({ kind: "agent", id: a.id, label: a.name }));
  const skill = leadingSkill(text, (skills?.skills ?? []).filter((s) => s.enabled).map((s) => s.name));
  return <RichText text={text} mentions={mentions} skill={skill} />;
}
