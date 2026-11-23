import { eclassSource } from "./eclass";
import { ebooksSource } from "./ebooks";
import type { StudySource } from "./types";

// Register new platforms here (Kallipos, Moodle, uploaded PDFs…).
export const STUDY_SOURCES: Record<string, StudySource> = {
  [ebooksSource.id]: ebooksSource,
  [eclassSource.id]: eclassSource,
};

export function sourceForRef(ref: string): StudySource {
  const id = ref.split(":")[0];
  const s = STUDY_SOURCES[id];
  if (!s) throw new Error(`Unknown study source "${id}"`);
  return s;
}
