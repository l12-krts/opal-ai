"use client";
// Flashcards: flip is a real 3D turn (front and back are two sides of one card), which is the
// one place in Opal where motion explains the interaction itself.
import { useState } from "react";
import { Button, Skeleton, cn } from "krts.ui";
import { IconArrowLeft, IconArrowRight, IconRotate } from "@tabler/icons-react";

type Card = { front: string; back: string; hint?: string };

export function FlashcardsArtifact({ part }: { part: any }) {
  const cards = ((part.input?.cards ?? []) as Card[]).filter((c) => c?.front && c?.back);
  if (part.state === "input-streaming" || !cards.length) return part.state === "output-error" ? null : <Skeleton className="h-56 w-full rounded-[12px]" />;
  return <Flashcards title={part.input?.title ?? "Flashcards"} cards={cards} />;
}

export function Flashcards({ title, cards }: { title: string; cards: Card[] }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const card = cards[i];

  const go = (d: number) => {
    setFlipped(false);
    setI((x) => (x + d + cards.length) % cards.length);
  };

  return (
    <div
      className="rounded-card border border-line-subtle bg-overlay outline-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === " ") {
          e.preventDefault();
          setFlipped((f) => !f);
        }
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
    >
      <div className="flex items-center justify-between border-b border-line-subtle px-4 py-2.5">
        <p className="text-[13.5px] font-medium">{title}</p>
        <p className="text-[12.5px] tabular-nums text-fg-muted">
          {i + 1} / {cards.length}
          {known.size > 0 && `  ·  ${known.size} known`}
        </p>
      </div>
      <div className="px-4 py-4 [perspective:1200px]">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-label={flipped ? "Show front" : "Show answer"}
          className="relative block h-48 w-full [transform-style:preserve-3d] transition-transform duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          style={{ transform: flipped ? "rotateY(180deg)" : "none" }}
        >
          <Face>
            <p className="text-[17px] font-medium leading-7">{card.front}</p>
            {card.hint && <p className="mt-2 text-[12.5px] text-fg-subtle">Hint: {card.hint}</p>}
          </Face>
          <Face back>
            <p className="text-[15px] leading-6">{card.back}</p>
          </Face>
        </button>
      </div>
      <div className="flex items-center justify-between border-t border-line-subtle px-4 py-2.5">
        <div className="flex gap-1">
          <Button size="xs" variant="ghost" isIconOnly aria-label="Previous" onPress={() => go(-1)}>
            <IconArrowLeft size={15} stroke={1.5} />
          </Button>
          <Button size="xs" variant="ghost" isIconOnly aria-label="Next" onPress={() => go(1)}>
            <IconArrowRight size={15} stroke={1.5} />
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            onPress={() => {
              setKnown((k) => {
                const n = new Set(k);
                n.delete(i);
                return n;
              });
              go(1);
            }}
          >
            Again
          </Button>
          <Button
            size="xs"
            variant="secondary"
            onPress={() => {
              setKnown((k) => new Set(k).add(i));
              go(1);
            }}
          >
            Got it
          </Button>
          {known.size === cards.length && (
            <Button size="xs" variant="ghost" isIconOnly aria-label="Restart" onPress={() => setKnown(new Set())}>
              <IconRotate size={15} stroke={1.5} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Face({ children, back }: { children: React.ReactNode; back?: boolean }) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col items-center justify-center rounded-[10px] border border-line-subtle bg-bg px-6 text-center [backface-visibility:hidden]",
      )}
      style={back ? { transform: "rotateY(180deg)" } : undefined}
    >
      {children}
    </div>
  );
}
