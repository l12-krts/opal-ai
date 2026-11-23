"use client";

import { Component, type ReactNode } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { Skeleton } from "krts.ui";
import { registry } from "@/lib/genui/registry";

class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? <p className="text-[13px] text-fg-muted">This view couldn&apos;t be displayed.</p> : this.props.children;
  }
}

export function GenUI({ part }: { part: any }) {
  const spec = part.input?.spec;
  const streamingInput = part.state === "input-streaming";
  if (!spec?.root || !spec?.elements?.[spec.root]) {
    return streamingInput ? <Skeleton className="h-28 w-full rounded-[12px]" /> : null;
  }
  if (part.state === "output-available" && part.output?.ok === false) {
    return <p className="text-[13px] text-fg-muted">The interactive view had an error: {String(part.output.error)}</p>;
  }
  return (
    <Boundary>
      <div className="flex flex-col gap-2">
        {part.input?.title && <p className="text-[13px] text-fg-muted">{part.input.title}</p>}
        <JSONUIProvider registry={registry}>
          <Renderer spec={spec} registry={registry} loading={streamingInput} />
        </JSONUIProvider>
      </div>
    </Boundary>
  );
}
