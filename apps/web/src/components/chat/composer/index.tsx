"use client";
// The composer. One line by default: [+] text [mic/send]. When the text wraps, or files, modes
// or tools are added, it grows into two rows and the controls move to a footer.
// Complexity lives in the "+" menu, "/" commands and "@" mentions, not in more buttons.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import type { FileUIPart } from "ai";
import { Button, Kbd, WithTooltip, cn } from "krts.ui";
import {
  IconArrowUp,
  IconBook2,
  IconCards,
  IconClockHour4,
  IconCpu,
  IconListCheck,
  IconMicrophone,
  IconPaperclip,
  IconPencilPlus,
  IconPhotoUp,
  IconPlayerStopFilled,
  IconSignature,
  IconUsersGroup,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import type { ChatMode } from "@/lib/types";
import { launchFlight } from "@/lib/flight";
import { useAgents, useSettings, useSkills } from "@/lib/hooks";
import { leadingSkill } from "@/lib/code-types";
import { t, type MessageKey } from "@/lib/i18n";
import { AgentFace } from "../../agent-face";
import { AttachmentChips } from "./attachment-chips";
import { ModelPicker, PlusMenu, TOGGLES, type ToggleId } from "./menus";
import { SuggestList, type SuggestItem } from "./suggest-list";
import { ACCEPT, useAttachments } from "./use-attachments";
import { useVoice } from "./use-voice";
import { Waveform } from "./waveform";

export type ComposerTools = { agents: boolean; handwriting: boolean };
export type ComposerMessage = { text: string; files: FileUIPart[] };

const LINE = 24;
const MAX_LINES = 5;
// Horizontal space the one-line layout gives to everything but text: padding, "+", send.
const NARROW_INSET = 100;
const PASTE_AS_FILE_CHARS = 2500;
const PASTE_AS_FILE_LINES = 40;
// Same duration and curve as the shell's height transition, so the two read as one motion.
const MORPH = { duration: 0.24, ease: [0.23, 1, 0.32, 1] as const };

const IDEAS: Record<ChatMode, MessageKey[]> = {
  chat: ["idea.chat.0", "idea.chat.1", "idea.chat.2", "idea.chat.3"],
  study: ["idea.study.0", "idea.study.1", "idea.study.2"],
};

type Trigger = { kind: "slash" | "mention"; query: string; start: number; end: number };

function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const slash = /^\/([\p{L}\p{N}_-]*)$/u.exec(before);
  if (slash && !text.slice(caret).trim()) return { kind: "slash", query: slash[1].toLowerCase(), start: 0, end: caret };
  const at = /(^|\s)@([\p{L}\p{N}_.-]{0,30})$/u.exec(before);
  if (at) return { kind: "mention", query: at[2].toLowerCase(), start: caret - at[2].length - 1, end: caret };
  return null;
}

let canvas: HTMLCanvasElement | null = null;
function textWidth(text: string, el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const ctx = (canvas ??= document.createElement("canvas")).getContext("2d");
  if (!ctx) return 0;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return ctx.measureText(text).width;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function Composer({
  onSend,
  onStop,
  busy,
  mode,
  onModeChange,
  tools,
  onToolsChange,
  agentName,
  model,
  onModelChange,
  modelLocked = false,
  autoFocus,
  showIdeas,
  queued,
  onCancelQueued,
  errorTick = 0,
}: {
  onSend: (message: ComposerMessage) => void;
  onStop: () => void;
  busy: boolean;
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;
  tools: ComposerTools;
  onToolsChange: (tools: ComposerTools) => void;
  agentName?: string;
  model: string | null;
  onModelChange: (m: string | null) => void;
  /** Auto already picked this chat's model: show it, but it can't be changed. */
  modelLocked?: boolean;
  autoFocus?: boolean;
  showIdeas?: boolean;
  queued?: ComposerMessage | null;
  onCancelQueued?: () => void;
  errorTick?: number;
}) {
  const router = useRouter();
  const listId = useId();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [touched, setTouched] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [width, setWidth] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelList, setModelList] = useState(false);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ideaIndex] = useState(() => Math.floor(Math.random() * 12));

  const shellRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: settings } = useSettings();
  const { data: agentsData } = useAgents();
  const { data: skillsData } = useSkills();
  const nerd = settings?.settings.nerdMode ?? false;
  const allModels = settings?.models ?? [];
  // Everyone picks between Opal's named models; nerd mode adds the raw provider models.
  const models = useMemo(() => allModels.filter((m) => m.tier || nerd), [allModels, nerd]);
  const currentModel = allModels.find((m) => m.id === (model ?? settings?.settings.model ?? settings?.defaultModel));
  const agents = useMemo(() => agentsData?.agents ?? [], [agentsData]);

  const attach = useAttachments();

  const focus = useCallback(() => taRef.current?.focus(), []);

  const voice = useVoice((spoken) => {
    // The spoken text goes out like a typed message, with any files already added.
    onSend({ text: spoken, files: attach.take() });
  });
  const listening = voice.state === "listening";

  const toggles = useMemo(() => {
    const s = new Set<ToggleId>();
    if (mode === "study") s.add("study");
    if (tools.agents) s.add("agents");
    if (tools.handwriting) s.add("handwriting");
    return s;
  }, [mode, tools]);

  const toggle = useCallback(
    (id: ToggleId) => {
      if (id === "study") onModeChange(mode === "study" ? "chat" : "study");
      else onToolsChange({ ...tools, [id]: !tools[id] });
    },
    [mode, tools, onModeChange, onToolsChange],
  );

  const expanded = multiline || attach.items.length > 0 || toggles.size > 0;
  const hasContent = text.trim().length > 0 || attach.ready > 0;
  const canSend = hasContent && !attach.uploading;

  // ── Autosize, and decide between the one-line and two-row layouts ──────────
  useLayoutEffect(() => {
    const ta = taRef.current;
    const form = formRef.current;
    if (!ta || !form) return;
    ta.style.height = "auto";
    const cs = getComputedStyle(ta);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const max = LINE * MAX_LINES + padY;
    const sh = ta.scrollHeight;
    ta.style.height = `${Math.min(sh, max)}px`;
    setOverflowing(sh > max + 1);
    if (!text) {
      if (multiline) setMultiline(false);
      return;
    }
    if (!expanded) {
      if (sh - padY > LINE * 1.5) setMultiline(true);
    } else {
      // Measured against the one-line width with some slack, so it doesn't flip back and forth.
      const narrow = form.clientWidth - NARROW_INSET;
      const multi = text.includes("\n") || textWidth(text, ta) > narrow * (multiline ? 0.94 : 1);
      if (multi !== multiline) setMultiline(multi);
    }
  }, [text, expanded, multiline, width]);

  // The shell follows the form's height with a CSS transition. Set straight on the DOM from the
  // observer, which runs after layout and before paint, so there is no frame of mismatch.
  useLayoutEffect(() => {
    const form = formRef.current;
    const shell = shellRef.current;
    if (!form || !shell) return;
    shell.style.height = `${form.offsetHeight}px`;
    const ro = new ResizeObserver(() => {
      shell.style.height = `${form.offsetHeight}px`;
      setWidth(form.clientWidth);
    });
    ro.observe(form);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (autoFocus && window.matchMedia("(pointer: fine)").matches) focus();
  }, [autoFocus, focus]);

  // Typing anywhere focuses the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox]")) return;
      focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  // Files can be dropped anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) {
        attach.add(files);
        focus();
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [attach.add, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape cancels voice wherever focus is.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") voice.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, voice.cancel]); // eslint-disable-line react-hooks/exhaustive-deps

  // A failed send shakes the box once.
  useEffect(() => {
    if (!errorTick || !shellRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    shellRef.current.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(-2px)" }, { transform: "translateX(0)" }],
      { duration: 320, easing: "ease-out" },
    );
  }, [errorTick]);

  // ── "/" commands, "@" mentions, model list ──────────────────────────────────
  const trigger = useMemo(() => (listening ? null : detectTrigger(text, caret)), [text, caret, listening]);
  const triggerKey = modelList ? "model" : trigger ? `${trigger.kind}:${trigger.start}` : null;
  const popoverOpen = Boolean(triggerKey) && triggerKey !== dismissed && (modelList || trigger!.kind === "slash" || agents.length > 0);

  const commands = useMemo(() => {
    const list: (SuggestItem & { keywords: string })[] = [
      { id: "files", label: t("cmd.files"), hint: "/files", icon: <IconPaperclip size={16} stroke={1.5} />, keywords: "attach upload photo image file pdf" },
      { id: "study", label: mode === "study" ? t("cmd.studyOff") : t("cmd.study"), hint: "/study", icon: <IconBook2 size={16} stroke={1.5} />, keywords: "learn book course school" },
      { id: "agents", label: tools.agents ? t("cmd.agentsOff") : t("cmd.agents"), hint: "/agents", icon: <IconUsersGroup size={16} stroke={1.5} />, keywords: "delegate parallel team" },
      {
        id: "handwriting",
        label: tools.handwriting ? t("cmd.handwritingOff") : t("cmd.handwriting"),
        hint: "/handwriting",
        icon: <IconSignature size={16} stroke={1.5} />,
        keywords: "hand write notes pen",
      },
      { id: "quiz", label: t("cmd.quiz"), hint: "/quiz", icon: <IconListCheck size={16} stroke={1.5} />, keywords: "test questions exam" },
      { id: "flashcards", label: t("cmd.flashcards"), hint: "/flashcards", icon: <IconCards size={16} stroke={1.5} />, keywords: "cards memorize" },
      ...(models.length && !modelLocked ? [{ id: "model", label: t("cmd.model"), hint: "/model", icon: <IconCpu size={16} stroke={1.5} />, keywords: "llm switch lightning thinking" }] : []),
      { id: "new", label: t("cmd.new"), hint: "/new", icon: <IconPencilPlus size={16} stroke={1.5} />, keywords: "clear fresh start" },
      // The user's skills (Customization → Skills).
      ...(skillsData?.skills ?? [])
        .filter((s) => s.enabled)
        .map((s) => ({ id: `skill:${s.name}`, label: s.name, hint: "Skill", icon: <IconWand size={16} stroke={1.5} />, keywords: `skill ${s.description}`.toLowerCase() })),
    ];
    return list;
  }, [mode, tools, models.length, modelLocked, skillsData]);

  const items: SuggestItem[] = useMemo(() => {
    if (!popoverOpen) return [];
    if (modelList) {
      const q = text.trim().toLowerCase();
      return models
        .filter((m) => !q || m.label.toLowerCase().includes(q) || m.providerLabel.toLowerCase().includes(q))
        .map((m) => ({ id: m.id, label: m.label, hint: m.description ?? m.providerLabel, selected: m.id === currentModel?.id }));
    }
    if (!trigger) return [];
    const q = trigger.query;
    if (trigger.kind === "slash") {
      return commands.filter((c) => !q || c.id.startsWith(q) || c.label.toLowerCase().includes(q) || c.keywords.includes(q));
    }
    return agents
      .filter((a) => !q || a.name.toLowerCase().startsWith(q) || a.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((a) => ({ id: a.id, label: a.name, icon: <AgentFace shape={a.shape} color={a.color} size={16} seed={a.name} /> }));
  }, [popoverOpen, modelList, trigger, commands, agents, models, text, currentModel?.id]);

  useEffect(() => setActive(0), [triggerKey, trigger?.query, modelList]);

  const setTextAndCaret = (value: string, pos = value.length) => {
    setText(value);
    setCaret(pos);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  function runCommand(id: string) {
    if (id.startsWith("skill:")) {
      // A "/Skill name" token: shown as a chip, and the server tells Opal to load that skill.
      setTextAndCaret(`/${id.slice(6)} `);
      return;
    }
    switch (id) {
      case "files":
        setTextAndCaret("");
        fileRef.current?.click();
        return;
      case "study":
      case "agents":
      case "handwriting":
        setTextAndCaret("");
        toggle(id);
        return;
      case "quiz":
      case "flashcards":
        if (mode !== "study") onModeChange("study");
        setTextAndCaret(t(id === "quiz" ? "cmd.quizTemplate" : "cmd.flashcardsTemplate"));
        return;
      case "model":
        setTextAndCaret("");
        setModelList(true);
        return;
      case "new":
        setTextAndCaret("");
        router.push(`/?new=${Date.now().toString(36)}`);
        return;
    }
  }

  function pick(item: SuggestItem) {
    if (modelList) {
      onModelChange(item.id);
      setModelList(false);
      setTextAndCaret("");
      return;
    }
    if (!trigger) return;
    if (trigger.kind === "slash") return runCommand(item.id);
    const insert = `@${item.label} `;
    setTextAndCaret(text.slice(0, trigger.start) + insert + text.slice(trigger.end), trigger.start + insert.length);
  }

  // ── Sending ─────────────────────────────────────────────────────────────────
  function submit() {
    if (listening || !canSend) return;
    const value = text.trim();
    const ta = taRef.current;
    if (value && !busy && ta) {
      const r = ta.getBoundingClientRect();
      const cs = getComputedStyle(ta);
      launchFlight(
        value,
        new DOMRect(
          r.left + parseFloat(cs.paddingLeft),
          r.top + parseFloat(cs.paddingTop),
          r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
          r.height,
        ),
      );
    }
    onSend({ text: value, files: attach.take() });
    setText("");
    setCaret(0);
    setTouched(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (popoverOpen) {
      if (e.key === "ArrowDown" && items.length) {
        e.preventDefault();
        setActive((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp" && items.length) {
        e.preventDefault();
        setActive((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        if (items[active]) {
          e.preventDefault();
          pick(items[active]);
          return;
        }
        // Typing a filter for the model list should never send it as a message.
        if (modelList) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(triggerKey);
        setModelList(false);
        return;
      }
    }
    if (e.key === "Tab" && !e.shiftKey && !text && idea) {
      e.preventDefault();
      setTextAndCaret(idea);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length) {
      e.preventDefault();
      attach.add(files);
      return;
    }
    const pasted = e.clipboardData.getData("text/plain");
    const lines = pasted.split("\n").length;
    if (pasted.length > PASTE_AS_FILE_CHARS || lines > PASTE_AS_FILE_LINES) {
      // Long text becomes an attachment instead of flooding the box.
      e.preventDefault();
      attach.add([new File([pasted], "pasted-text.txt", { type: "text/plain" })], { pasted: { lines } });
    }
  }

  // ── Placeholder, ideas, mentions ────────────────────────────────────────────
  const ideaKeys = IDEAS[mode];
  const idea = showIdeas && !touched && !agentName && !listening ? t(ideaKeys[ideaIndex % ideaKeys.length]) : null;
  const placeholder = agentName
    ? t("composer.placeholderAgent", { name: agentName })
    : mode === "study"
      ? t("composer.placeholderStudy")
      : t("composer.placeholder");

  const mentionRe = useMemo(
    () => (agents.length ? new RegExp(`@(?:${agents.map((a) => escapeRe(a.name)).join("|")})(?![\\p{L}\\p{N}_])`, "giu") : null),
    [agents],
  );
  const skillNames = useMemo(() => (skillsData?.skills ?? []).filter((s) => s.enabled).map((s) => s.name), [skillsData]);
  const highlighted = useMemo(() => {
    const skill = leadingSkill(text, skillNames);
    if (!skill && (!mentionRe || !text.includes("@"))) return null;
    const out: React.ReactNode[] = [];
    let last = 0;
    if (skill) {
      out.push(
        <mark key="skill" className="opal-mention">
          {text.slice(0, skill.length + 1)}
        </mark>,
      );
      last = skill.length + 1;
    }
    for (const m of mentionRe ? text.matchAll(mentionRe) : []) {
      if ((m.index ?? 0) < last) continue;
      out.push(text.slice(last, m.index));
      out.push(
        <mark key={m.index} className="opal-mention">
          {m[0]}
        </mark>,
      );
      last = (m.index ?? 0) + m[0].length;
    }
    if (!last) return null;
    out.push(text.slice(last));
    return out;
  }, [text, mentionRe, skillNames]);

  // Text box padding per layout. The overlays (placeholder, mentions, voice) reuse it.
  const pad = expanded ? "px-1.5 pt-1 pb-1.5" : "px-2 py-1";

  type Btn = "stop" | "send" | "mic" | "voice";
  const btn: Btn = listening ? "voice" : busy ? "stop" : !hasContent && voice.supported ? "mic" : "send";
  const btnLabel = { stop: t("composer.stop"), send: t("composer.send"), mic: t("composer.voice"), voice: t("composer.voiceSend") }[btn];

  return (
    <div className="relative">
      {queued && (
        <div className="opal-pop mb-2 flex w-fit max-w-full items-center gap-2 rounded-full border border-line-subtle bg-overlay py-1 pl-3 pr-1 text-[13px] text-fg-muted shadow-control">
          <IconClockHour4 size={14} stroke={1.5} className="shrink-0" />
          <span className="shrink-0">{t("composer.queued")}</span>
          <span className="truncate text-fg">{queued.text || queued.files.map((f) => f.filename).join(", ")}</span>
          <button
            type="button"
            onClick={onCancelQueued}
            aria-label={t("composer.cancelQueued")}
            className="pressable grid size-6 shrink-0 place-items-center rounded-full hover:bg-surface hover:text-fg"
          >
            <IconX size={13} stroke={1.75} />
          </button>
        </div>
      )}

      {popoverOpen && (
        <SuggestList
          id={listId}
          title={modelList ? t("composer.model") : trigger?.kind === "mention" ? t("composer.mention") : t("composer.commands")}
          items={items}
          active={active}
          onPick={pick}
          onHover={setActive}
        />
      )}

      {/* The shell animates its height to follow the form. Content sits at the bottom, so the
          box grows upward and the controls row stays put. Radius = half the one-line height,
          so one line is a pill and the 32px buttons are concentric with the corners. */}
      <div
        ref={shellRef}
        className={cn(
          "relative box-content flex flex-col justify-end overflow-hidden rounded-[27px] border border-line bg-overlay",
          "shadow-[0_1px_2px_rgb(0_0_0/0.04),0_6px_20px_-8px_rgb(0_0_0/0.08)]",
          "transition-[height,border-color,box-shadow] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[border-color,box-shadow]",
          "focus-within:border-line-strong focus-within:shadow-[0_0_0_3px_rgb(0_0_0/0.045),0_6px_20px_-8px_rgb(0_0_0/0.1)] dark:focus-within:shadow-[0_0_0_3px_rgb(255_255_255/0.06)]",
        )}
      >
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={cn("grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] p-2.5", expanded ? "items-center" : "items-end")}
        style={{
          gridTemplateAreas: expanded ? '"header header header" "main main main" "lead footer trail"' : '"lead main trail"',
        }}
      >
        {attach.items.length > 0 && (
          <div style={{ gridArea: "header" }} className="px-1 pb-2.5 pt-1">
            <AttachmentChips items={attach.items} onRemove={attach.remove} />
          </div>
        )}

        <motion.div layout="position" layoutDependency={expanded} transition={MORPH} style={{ gridArea: "lead" }} className="flex">
          {listening ? (
            <WithTooltip content={t("composer.voiceCancel")} delay={500}>
              <Button
                variant="ghost"
                size="xs"
                isIconOnly
                aria-label={t("composer.voiceCancel")}
                onPress={voice.cancel}
                className="size-8 rounded-full text-fg-muted hover:text-fg"
              >
                <IconX size={17} stroke={1.5} />
              </Button>
            </WithTooltip>
          ) : (
            <PlusMenu
              isOpen={menuOpen}
              onOpenChange={setMenuOpen}
              toggles={toggles}
              onToggle={toggle}
              onAddFiles={() => fileRef.current?.click()}
              models={models}
              currentModel={currentModel}
              onModelChange={onModelChange}
              showModels={models.length > 0}
              modelLocked={modelLocked}
            />
          )}
        </motion.div>

        <motion.div layout="position" layoutDependency={expanded} transition={MORPH} style={{ gridArea: "main" }} className="relative min-w-0">
          {highlighted && (
            <div
              ref={backRef}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-[16px] leading-6 text-transparent",
                pad,
                overflowing && "[scrollbar-gutter:stable]",
              )}
            >
              {highlighted}
              {"​"}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart);
              if (e.target.value) setTouched(true);
              if (modelList && e.target.value.startsWith("/")) setModelList(false);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onScroll={(e) => {
              if (backRef.current) backRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => setModelList(false)}
            aria-label={placeholder}
            aria-autocomplete="list"
            aria-controls={popoverOpen ? listId : undefined}
            aria-activedescendant={popoverOpen && items[active] ? `${listId}-${active}` : undefined}
            spellCheck
            autoComplete="off"
            enterKeyHint="send"
            maxLength={32000}
            className={cn(
              "relative block w-full resize-none bg-transparent text-[16px] leading-6 text-fg caret-fg outline-none",
              pad,
              overflowing && "[scrollbar-gutter:stable]",
              listening && "invisible",
            )}
          />
          {!text && !listening && (
            <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 flex items-start gap-2 text-[16px] leading-6 text-fg-subtle", pad)}>
              <span className="truncate">{idea ?? placeholder}</span>
              {idea && (
                <Kbd className="hidden h-5 min-w-0 shrink-0 translate-y-0.5 px-1 text-[11px] text-fg-subtle [@media(pointer:fine)]:inline-flex">
                  {t("composer.tab")}
                </Kbd>
              )}
            </div>
          )}
          {listening && (
            <div className={cn("absolute inset-0 flex items-center gap-3", pad)} role="status" aria-live="polite">
              <span className={cn("min-w-0 flex-1 truncate text-[16px] leading-6", voice.transcript ? "text-fg" : "text-fg-subtle")}>
                {voice.transcript || t("composer.voiceListening")}
              </span>
              <Waveform analyser={voice.analyser} bars={28} />
            </div>
          )}
        </motion.div>

        {expanded && (
          <div style={{ gridArea: "footer" }} className="flex min-w-0 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
            {TOGGLES.filter((x) => toggles.has(x.id)).map((x) => (
              <span key={x.id} className="opal-pop inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface pl-2.5 pr-1 text-[13px] text-fg">
                <x.icon size={14} stroke={1.5} className="text-fg-muted" />
                {x.label()}
                <button
                  type="button"
                  onClick={() => toggle(x.id)}
                  aria-label={t("composer.turnOff", { name: x.label() })}
                  className="pressable grid size-6 place-items-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg"
                >
                  <IconX size={12} stroke={1.75} />
                </button>
              </span>
            ))}
            {models.length > 0 && (
              <div className="opal-pop shrink-0">
                <ModelPicker models={models} currentModel={currentModel} onModelChange={onModelChange} locked={modelLocked} />
              </div>
            )}
          </div>
        )}

        <motion.div layout="position" layoutDependency={expanded} transition={MORPH} style={{ gridArea: "trail" }} className="flex">
          <WithTooltip content={btnLabel} delay={500}>
            <Button
              type={btn === "send" ? "submit" : "button"}
              variant="ghost"
              size="xs"
              isIconOnly
              aria-label={btnLabel}
              isDisabled={btn === "send" && !canSend}
              onPress={btn === "stop" ? onStop : btn === "mic" ? () => void voice.start() : btn === "voice" ? voice.finish : undefined}
              className={cn(
                "relative size-8 rounded-full transition-[background-color,color,transform] duration-150 data-[pressed]:scale-[0.94] disabled:opacity-100",
                btn === "stop" && "bg-fg text-bg hover:bg-fg/90",
                (btn === "send" || btn === "voice") && (canSend || btn === "voice" ? "btn-accent" : "bg-surface text-fg-subtle"),
                btn === "mic" && "text-fg-muted hover:bg-surface hover:text-fg",
              )}
            >
              {/* Crossfade the icons with a little blur so the swap reads as one shape changing. */}
              <SwapIcon on={btn === "send" || btn === "voice"}>
                <IconArrowUp size={17} stroke={2} />
              </SwapIcon>
              <SwapIcon on={btn === "stop"}>
                <IconPlayerStopFilled size={13} />
              </SwapIcon>
              <SwapIcon on={btn === "mic"}>
                <IconMicrophone size={18} stroke={1.5} />
              </SwapIcon>
            </Button>
          </WithTooltip>
        </motion.div>

        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            attach.add(Array.from(e.target.files ?? []));
            e.target.value = "";
            focus();
          }}
        />
      </form>
      </div>

      {dragging &&
        createPortal(
          <div className="opal-fade pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-bg/75 p-6 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2 rounded-[20px] border border-dashed border-line-strong bg-overlay px-10 py-8 text-center shadow-float">
              <IconPhotoUp size={26} stroke={1.5} className="text-fg-muted" />
              <p className="text-[15px] font-medium">{t("composer.drop")}</p>
              <p className="text-[13px] text-fg-muted">{t("composer.dropHint")}</p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function SwapIcon({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute inset-0 grid place-items-center transition-[opacity,filter,transform] duration-200 ease-out",
        on ? "scale-100 opacity-100 blur-0" : "scale-75 opacity-0 blur-[2px]",
      )}
    >
      {children}
    </span>
  );
}
