"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "krts.ui";
import { IconArrowDown } from "@tabler/icons-react";
import type { ChatStatus } from "ai";
import type { OpalUIMessage } from "@/lib/types";
import { t } from "@/lib/i18n";
import { AssistantMessage, UserMessage, PendingAssistant } from "./message";

const STICK_THRESHOLD = 96;

export function Thread({ messages, status }: { messages: OpalUIMessage[]; status: ChatStatus }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;

  // Jump to the bottom on first paint (no animation: this happens every time a chat opens).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // When the user sends, always follow.
  useLayoutEffect(() => {
    stick.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastUserId]);

  // Keep following the stream while the user hasn't scrolled away.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const content = el.firstElementChild as HTMLElement | null;
    if (!content) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current!;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stick.current = near;
    if (near !== atBottom) setAtBottom(near);
  };

  const last = messages[messages.length - 1];
  const waiting = status === "submitted" && last?.role === "user";

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain" role="log" aria-live="polite">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-5 pb-10 pt-4">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserMessage key={m.id} message={m} />
            ) : (
              <AssistantMessage
                key={m.id}
                message={m}
                isLast={i === messages.length - 1}
                streaming={i === messages.length - 1 && status === "streaming"}
                errored={i === messages.length - 1 && status === "error"}
              />
            ),
          )}
          {waiting && <PendingAssistant />}
          {status === "error" && last?.role === "user" && <PendingAssistant error />}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          const el = scroller.current!;
          stick.current = true;
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        }}
        aria-label={t("chat.scrollDown")}
        tabIndex={atBottom ? -1 : 0}
        className={cn(
          "pressable absolute bottom-3 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-line bg-overlay text-fg-muted shadow-float",
          "transition-[opacity,transform] duration-200 ease-out",
          atBottom ? "pointer-events-none translate-y-1 scale-95 opacity-0" : "opacity-100",
        )}
      >
        <IconArrowDown size={16} stroke={1.5} />
      </button>
    </div>
  );
}
