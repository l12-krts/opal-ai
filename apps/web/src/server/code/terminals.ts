import "server-only";
import { ApiError } from "../http";

type Term = { userId: string; machineId: string };
const g = globalThis as unknown as { __opalTerms?: Map<string, Term> };
export const terminals: Map<string, Term> = (g.__opalTerms ??= new Map());

export function ownedTerminal(userId: string, termId: string): Term {
  const t = terminals.get(termId);
  if (!t || t.userId !== userId) throw new ApiError(404, "not_found", "Terminal not found");
  return t;
}
