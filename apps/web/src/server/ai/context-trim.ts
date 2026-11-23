import type { ModelMessage } from "ai";

/** Results this long or shorter are always kept whole. */
const KEEP_CHARS = 1500;
/** Ends every shortened result, so it isn't shortened twice. */
const MARK = "Run the tool again if you need the rest.]";

/**
 * Every step re-sends the whole conversation, so a run that has read ten long pages pays for all
 * of them on every step and the model slows to a crawl. Tool results from the latest steps stay
 * whole; older long ones (pages, terminal output, files) keep their start and a note to fetch them
 * again if the rest is needed.
 */
export function trimOldToolResults(messages: ModelMessage[], keepLastSteps = 2): ModelMessage[] {
  let toolMessagesSeen = 0;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m.role !== "tool") continue;
    toolMessagesSeen++;
    if (toolMessagesSeen <= keepLastSteps) continue;
    let changed = false;
    const content = m.content.map((part) => {
      if (part.type !== "tool-result") return part;
      const o = part.output;
      if (o.type !== "text" && o.type !== "json") return part;
      const full = o.type === "text" ? o.value : JSON.stringify(o.value);
      if (full.length <= KEEP_CHARS || full.endsWith(MARK)) return part;
      changed = true;
      return {
        ...part,
        output: {
          type: "text" as const,
          value: `${full.slice(0, KEEP_CHARS)}… [older result shortened to save room (${full.length} characters in full). ${MARK}`,
        },
      };
    });
    if (changed) out[i] = { ...m, content };
  }
  return out;
}
