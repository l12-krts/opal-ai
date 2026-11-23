// Study sources are plugins: add a platform by implementing StudySource and registering it in
// registry.ts. Every method runs server-side with the user's id so it can read vault secrets.
export type StudyItem = {
  id: string; // opaque, source-specific reference the model passes back to read()
  title: string;
  subtitle?: string;
  kind: "book" | "chapter" | "document" | "course" | "announcement";
  format?: "html" | "pdf" | "text" | "other";
  url?: string;
};

export type StudyReadResult = {
  title: string;
  text: string;
  offset: number;
  total: number;
  sections?: StudyItem[];
  url?: string;
};

export interface StudySource {
  id: string;
  name: string;
  description: string;
  search(userId: string, query: string, opts?: { grade?: string; limit?: number }): Promise<StudyItem[]>;
  browse?(userId: string, ref?: string): Promise<StudyItem[]>;
  read(userId: string, ref: string, opts?: { offset?: number }): Promise<StudyReadResult>;
}

export function normalizeGreek(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ");
}
