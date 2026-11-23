"use client";

import { useState } from "react";
import { Button, cn } from "krts.ui";
import { useChatActions } from "../chat-context";

export function AskUser({ part }: { part: any }) {
  const { answerTool } = useChatActions();
  const [other, setOther] = useState("");
  const input = part.input ?? {};
  if (part.state === "input-streaming") return null;
  const answered = part.state === "output-available" ? String(part.output?.answer ?? "") : null;

  return (
    <div className="rounded-card border border-line-subtle bg-overlay px-3.5 py-3">
      <p className="text-[14px] font-medium">{input.question}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {(input.options ?? []).map((o: string) => (
          <button
            key={o}
            type="button"
            disabled={answered !== null}
            onClick={() => answerTool("ask_user", part.toolCallId, { answer: o })}
            className={cn(
              "pressable rounded-full border px-3 py-1 text-[13px]",
              answered === o ? "border-line-strong bg-surface-hover text-fg" : "border-line text-fg/85 hover:bg-surface disabled:opacity-50",
            )}
          >
            {o}
          </button>
        ))}
      </div>
      {input.allowOther && answered === null && (
        <form
          className="mt-2.5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (other.trim()) answerTool("ask_user", part.toolCallId, { answer: other.trim() });
          }}
        >
          <input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Something else"
            maxLength={500}
            className="h-8 flex-1 rounded-[8px] border border-line bg-bg px-2.5 text-[13px] outline-none focus:border-accent-line"
          />
          <Button size="xs" type="submit" variant="secondary">
            Send
          </Button>
        </form>
      )}
    </div>
  );
}
