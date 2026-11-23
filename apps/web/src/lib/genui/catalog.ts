// Generative UI catalog (json-render). The model may only use these components; the client
// renders them with krts.ui. Shared by server (prompt) and client (registry).
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const tone = z.enum(["neutral", "success", "warning", "danger", "accent"]).nullable();

export const catalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({ direction: z.enum(["vertical", "horizontal"]).nullable(), gap: z.enum(["sm", "md", "lg"]).nullable() }),
      slots: ["default"],
      description: "Lays children out in a column (default) or row.",
    },
    Grid: {
      props: z.object({ columns: z.number().int().min(1).max(4).nullable() }),
      slots: ["default"],
      description: "Responsive grid of children, 1-4 columns.",
    },
    Card: {
      props: z.object({ title: z.string().nullable(), subtitle: z.string().nullable() }),
      slots: ["default"],
      description: "A bordered group with an optional title.",
    },
    Heading: {
      props: z.object({ text: z.string(), level: z.number().int().min(1).max(3).nullable() }),
      description: "A heading.",
    },
    Text: {
      props: z.object({ text: z.string(), muted: z.boolean().nullable(), size: z.enum(["sm", "md"]).nullable() }),
      description: "A paragraph of plain text.",
    },
    Metric: {
      props: z.object({ label: z.string(), value: z.string(), change: z.string().nullable(), tone }),
      description: "A single number with a label and an optional comparison like '+4% vs last week'.",
    },
    Badge: {
      props: z.object({ text: z.string(), tone }),
      description: "A small status label.",
    },
    KeyValue: {
      props: z.object({ items: z.array(z.object({ key: z.string(), value: z.string() })) }),
      description: "A list of label/value pairs.",
    },
    List: {
      props: z.object({ items: z.array(z.string()), ordered: z.boolean().nullable() }),
      description: "A bulleted or numbered list.",
    },
    Table: {
      props: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) }),
      description: "A data table. Keep it under 20 rows.",
    },
    BarChart: {
      props: z.object({
        title: z.string().nullable(),
        data: z.array(z.object({ label: z.string(), value: z.number() })),
        unit: z.string().nullable(),
      }),
      description: "Horizontal bar chart for comparing a few values.",
    },
    Progress: {
      props: z.object({ label: z.string(), value: z.number().min(0).max(100) }),
      description: "A labelled progress bar, value 0-100.",
    },
    Steps: {
      props: z.object({ items: z.array(z.object({ title: z.string(), detail: z.string().nullable(), done: z.boolean().nullable() })) }),
      description: "An ordered checklist of steps.",
    },
    Callout: {
      props: z.object({ title: z.string().nullable(), text: z.string(), tone }),
      description: "A highlighted note or warning.",
    },
    Image: {
      props: z.object({ src: z.string(), alt: z.string(), caption: z.string().nullable() }),
      description: "An image from an https URL.",
    },
    Link: {
      props: z.object({ text: z.string(), href: z.string() }),
      description: "An external https link.",
    },
    Button: {
      props: z.object({ label: z.string(), prompt: z.string(), primary: z.boolean().nullable() }),
      description: "A button that sends `prompt` back to the chat as the user's next message when pressed.",
    },
    Separator: {
      props: z.object({}),
      description: "A thin divider.",
    },
  },
  actions: {
    send_prompt: {
      params: z.object({ prompt: z.string() }),
      description: "Send a follow-up message to the chat.",
    },
  },
});

export type GenUISpec = {
  root: string;
  elements: Record<string, { type: string; props?: Record<string, unknown>; children?: string[] }>;
  state?: Record<string, unknown>;
};
