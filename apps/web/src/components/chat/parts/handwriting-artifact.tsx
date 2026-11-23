"use client";

import useSWR from "swr";
import Link from "next/link";
import { Skeleton } from "krts.ui";
import { IconSignature } from "@tabler/icons-react";
import { fetcher } from "@/lib/api";
import { HandwritingView } from "../../handwriting-view";

type Artifact = { artifact: { title: string; data: { markdown: string; profileId: string | null; paper: "lined" | "grid" | "blank"; ink: "blue" | "black" | "darkblue" } } };

export function HandwritingArtifact({ part }: { part: any }) {
  const id = part.state === "output-available" ? part.output?.artifactId : null;
  const { data } = useSWR<Artifact>(id ? `/api/artifacts/${id}` : null, fetcher, { revalidateOnFocus: false });

  if (part.state === "output-error") return null;
  if (!id || !data) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[13.5px] text-fg-muted">
          <IconSignature size={15} stroke={1.5} />
          <span className="shimmer-text">Writing by hand</span>
        </div>
        <Skeleton className="aspect-[210/297] w-full max-w-[380px] rounded-[6px]" />
      </div>
    );
  }
  const a = data.artifact;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[13.5px] text-fg-muted">
        <IconSignature size={15} stroke={1.5} />
        <span>{a.title}</span>
        {!a.data.profileId && (
          <Link href="/settings/handwriting" className="text-[12.5px] text-accent-line underline underline-offset-2">
            Use your own handwriting
          </Link>
        )}
      </div>
      <HandwritingView markdown={a.data.markdown} profileId={a.data.profileId} paper={a.data.paper} ink={a.data.ink} title={a.title} compact />
    </div>
  );
}
