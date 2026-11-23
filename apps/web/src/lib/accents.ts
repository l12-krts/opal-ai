// Accent colours the user can pick in Settings. The colours themselves live in globals.css
// under [data-accent="…"], so one rule set drives the app and the picker's swatches.
export const ACCENTS = [
  { id: "mono", label: "Mono" },
  { id: "blue", label: "Blue" },
  { id: "teal", label: "Teal" },
  { id: "green", label: "Green" },
  { id: "violet", label: "Violet" },
  { id: "pink", label: "Pink" },
  { id: "orange", label: "Orange" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];
export const ACCENT_IDS = ACCENTS.map((a) => a.id) as [AccentId, ...AccentId[]];
export const DEFAULT_ACCENT: AccentId = "mono";
export const ACCENT_KEY = "opal-accent";

export const isAccent = (v: unknown): v is AccentId => typeof v === "string" && (ACCENT_IDS as string[]).includes(v);
