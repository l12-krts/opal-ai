"use client";

import { memo } from "react";
import { Streamdown } from "streamdown";

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <Streamdown
      className="prose-opal"
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      parseIncompleteMarkdown
      controls={{ table: true, code: true, mermaid: false }}
      linkSafety={{ enabled: true }}
    >
      {text}
    </Streamdown>
  );
});
