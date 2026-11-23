"use client";
// Interactive quiz. Explanations for every wrong option were written by the model in advance,
// so feedback is instant and specific to the misconception.
import { useState } from "react";
import { Button, Skeleton, cn } from "krts.ui";
import { IconCheck, IconX, IconRotate } from "@tabler/icons-react";

type Q = { question: string; options: string[]; correctIndex: number; explanation: string; wrongExplanations: string[] };

export function QuizArtifact({ part }: { part: any }) {
  const input = part.input as { title?: string; topic?: string; questions?: Q[] } | undefined;
  const questions = (input?.questions ?? []).filter((q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2);
  if (part.state === "input-streaming" || !questions.length) {
    return part.state === "output-error" ? null : <Skeleton className="h-48 w-full rounded-[12px]" />;
  }
  return <Quiz title={input?.title ?? "Quiz"} questions={questions} />;
}

export function Quiz({ title, questions }: { title: string; questions: Q[] }) {
  const [index, setIndex] = useState(0);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [shake, setShake] = useState<number | null>(null);
  const q = questions[index];
  const picked = picks[index];
  const answered = picked !== undefined;
  const score = Object.entries(picks).filter(([i, p]) => questions[Number(i)]?.correctIndex === p).length;
  const finished = Object.keys(picks).length === questions.length;

  function choose(i: number) {
    if (answered) return;
    setPicks((p) => ({ ...p, [index]: i }));
    if (i !== q.correctIndex) {
      setShake(i);
      setTimeout(() => setShake(null), 260);
    }
  }

  return (
    <div className="rounded-card border border-line-subtle bg-overlay">
      <div className="flex items-center justify-between border-b border-line-subtle px-4 py-2.5">
        <p className="text-[13.5px] font-medium">{title}</p>
        <p className="text-[12.5px] tabular-nums text-fg-muted">
          {index + 1} / {questions.length}
          {Object.keys(picks).length > 0 && `  ·  ${score} correct`}
        </p>
      </div>

      <div className="px-4 py-4">
        <p className="text-[15px] leading-6">{q.question}</p>
        <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label={q.question}>
          {q.options.map((opt, i) => {
            const isCorrect = i === q.correctIndex;
            const isPicked = picked === i;
            return (
              <div key={i}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  disabled={answered}
                  onClick={() => choose(i)}
                  className={cn(
                    "pressable flex w-full items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left text-[14px] leading-5",
                    !answered && "border-line hover:bg-surface",
                    answered && isCorrect && "border-success/50 bg-success/10",
                    answered && isPicked && !isCorrect && "border-danger/50 bg-danger-soft",
                    answered && !isPicked && !isCorrect && "border-line-subtle text-fg-muted",
                    shake === i && "animate-[opal-shake_240ms_ease-out]",
                  )}
                >
                  <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full border border-line text-[11px] text-fg-muted">
                    {answered && isCorrect ? <IconCheck size={12} stroke={2} className="text-success" /> : answered && isPicked ? <IconX size={12} stroke={2} className="text-danger" /> : String.fromCharCode(65 + i)}
                  </span>
                  <span>{opt}</span>
                </button>
                {answered && isPicked && !isCorrect && q.wrongExplanations?.[i] && (
                  <p className="ml-8 mt-1.5 text-[13px] leading-5 text-fg-muted">{q.wrongExplanations[i]}</p>
                )}
              </div>
            );
          })}
        </div>
        {answered && q.explanation && (
          <div className="mt-3 rounded-[10px] bg-surface/70 px-3 py-2.5 text-[13.5px] leading-6">
            <span className="font-medium">{picked === q.correctIndex ? "Correct. " : "Answer: "}</span>
            {q.explanation}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line-subtle px-4 py-2.5">
        <Button size="xs" variant="ghost" isDisabled={index === 0} onPress={() => setIndex((i) => i - 1)}>
          Back
        </Button>
        {finished && index === questions.length - 1 ? (
          <div className="flex items-center gap-3">
            <span className="text-[13px] tabular-nums text-fg-muted">
              Score {score}/{questions.length}
            </span>
            <Button
              size="xs"
              variant="secondary"
              startContent={<IconRotate size={14} stroke={1.5} />}
              onPress={() => {
                setPicks({});
                setIndex(0);
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <Button size="xs" variant={answered ? "primary" : "ghost"} isDisabled={index === questions.length - 1} onPress={() => setIndex((i) => i + 1)}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
