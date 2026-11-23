// Some models served through NVIDIA NIM sometimes write a tool call into their reply as text
// instead of making a real call, in one of two shapes:
//
//   <tool_call><function=terminal><parameter=command>ls</parameter></function></tool_call>
//   <tool_call>{"name": "terminal", "arguments": {"command": "ls"}}</tool_call>
//
// Left alone, the run ends with that markup as its "answer". This middleware holds back text
// from the moment a <tool_call> block starts, turns complete blocks for known tools into real
// tool calls, and passes anything it can't read through as ordinary text.
import { generateId, type LanguageModelMiddleware } from "ai";

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type StreamResult = Awaited<ReturnType<WrapStream>>;
type Part = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;
type CallOptions = Parameters<WrapStream>[0]["params"];

const OPEN = "<tool_call>";
const CLOSE = "</tool_call>";

/** For each tool, the JSON-schema types of its parameters (used to read XML-style values). */
export type ToolShapes = Map<string, Record<string, unknown>>;

export function toolShapes(tools: CallOptions["tools"]): ToolShapes {
  const shapes: ToolShapes = new Map();
  for (const t of tools ?? []) {
    if (t.type !== "function") continue;
    const props = (t.inputSchema as { properties?: Record<string, { type?: unknown }> })?.properties ?? {};
    shapes.set(t.name, Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v?.type])));
  }
  return shapes;
}

/** An XML-style value is text; numbers, booleans, objects and arrays are read as JSON. */
function readValue(raw: string, type: unknown): unknown {
  const value = raw.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("string") || type === undefined) return value;
  try {
    return JSON.parse(value.trim());
  } catch {
    return value;
  }
}

/** Reads one block (with or without its <tool_call> tags). Null when it isn't a call to a known tool. */
export function parseToolCallBlock(block: string, shapes: ToolShapes): { name: string; args: Record<string, unknown> } | null {
  const inner = block.replace(OPEN, "").replace(CLOSE, "").trim();

  // JSON style.
  if (inner.startsWith("{")) {
    try {
      const j = JSON.parse(inner) as { name?: unknown; arguments?: unknown; parameters?: unknown };
      const name = typeof j.name === "string" ? j.name : "";
      let args = j.arguments ?? j.parameters ?? {};
      if (typeof args === "string") args = JSON.parse(args);
      if (!shapes.has(name) || typeof args !== "object" || args === null || Array.isArray(args)) return null;
      return { name, args: args as Record<string, unknown> };
    } catch {
      return null;
    }
  }

  // XML style.
  const fn = /<function=([^>\s]+)\s*>([\s\S]*?)(?:<\/function>|$)/.exec(inner);
  if (!fn) return null;
  const name = fn[1].trim();
  const shape = shapes.get(name);
  if (!shape) return null;
  const args: Record<string, unknown> = {};
  const param = /<parameter=([^>\s]+)\s*>([\s\S]*?)<\/parameter>/g;
  for (let m = param.exec(fn[2]); m; m = param.exec(fn[2])) {
    const key = m[1].trim();
    args[key] = readValue(m[2], shape[key]);
  }
  return { name, args };
}

/** Length of the longest end of `text` that could be the start of "<tool_call>". */
function partialOpenAt(text: string): number {
  for (let n = Math.min(OPEN.length - 1, text.length); n > 0; n--) {
    if (OPEN.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

export const textToolCallMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v4",
  wrapStream: async ({ doStream, params }) => {
    const result = await doStream();
    const shapes = toolShapes(params.tools);
    if (!shapes.size) return result;

    let buf = "";
    let inCall = false;
    let made = 0;

    const stream = result.stream.pipeThrough(
      new TransformStream<Part, Part>({
        transform(part, out) {
          if (part.type === "text-delta") {
            buf += part.delta;
            let text = "";
            for (;;) {
              if (!inCall) {
                const at = buf.indexOf(OPEN);
                if (at < 0) {
                  const keep = partialOpenAt(buf);
                  text += buf.slice(0, buf.length - keep);
                  buf = buf.slice(buf.length - keep);
                  break;
                }
                text += buf.slice(0, at);
                buf = buf.slice(at);
                inCall = true;
              }
              const end = buf.indexOf(CLOSE);
              if (end < 0) break;
              const block = buf.slice(0, end + CLOSE.length);
              buf = buf.slice(end + CLOSE.length);
              inCall = false;
              const call = parseToolCallBlock(block, shapes);
              if (call) {
                made++;
                out.enqueue({ type: "tool-call", toolCallId: `txt_${generateId()}`, toolName: call.name, input: JSON.stringify(call.args) });
              } else text += block;
            }
            if (text) out.enqueue({ ...part, delta: text });
            return;
          }

          if (part.type === "text-end" && buf) {
            // The reply ended inside a block that never closed: use it if it reads as a call.
            const call = inCall ? parseToolCallBlock(buf, shapes) : null;
            if (call) {
              made++;
              out.enqueue({ type: "tool-call", toolCallId: `txt_${generateId()}`, toolName: call.name, input: JSON.stringify(call.args) });
            } else out.enqueue({ type: "text-delta", id: part.id, delta: buf });
            buf = "";
            inCall = false;
          }

          if (part.type === "finish" && made && part.finishReason.unified === "stop") {
            out.enqueue({ ...part, finishReason: { ...part.finishReason, unified: "tool-calls" } });
            return;
          }
          out.enqueue(part);
        },
      }),
    );
    return { ...result, stream };
  },
};
