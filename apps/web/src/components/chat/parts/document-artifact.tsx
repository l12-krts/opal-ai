"use client";
// create_doc / create_slides / create_sheet / create_chart / create_whiteboard, update_document and
// show_document: a document card. While a create streams in, the card builds from what's arrived
// so far; once saved it shows the saved version (each card keeps the version it made).
import { Skeleton } from "krts.ui";
import { IconFileText } from "@tabler/icons-react";
import { isDocKind, kindOfTool, normalizeContent, type DocSnapshot } from "@/lib/documents";
import { DocumentCard, DocumentError } from "../../documents/document";

type Part = { state: string; input?: any; output?: any; errorText?: string };

export function DocumentArtifact({ part, name }: { part: Part; name: string }) {
  const out = part.state === "output-available" ? part.output : undefined;
  const createKind = kindOfTool(name);
  const what = createKind ? `Couldn't make the ${createKind === "doc" ? "document" : createKind}` : name === "show_document" ? "Couldn't open the document" : "Couldn't change the document";

  if (part.state === "output-error" || out?.ok === false) return <DocumentError label={what} error={part.errorText ?? out?.error} />;
  if (part.state === "output-denied") return null;

  let snap: DocSnapshot | null = null;
  if (out?.ok && isDocKind(out.kind) && out.document) {
    snap = { id: out.artifactId, kind: out.kind, title: out.title ?? "", version: out.version ?? 1, data: normalizeContent(out.kind, out.document) };
  } else if (createKind && part.input) {
    snap = { kind: createKind, title: String(part.input.title ?? ""), version: 1, data: normalizeContent(createKind, part.input) };
  }

  if (!snap) {
    if (createKind) return <Skeleton className="h-[240px] w-full max-w-[640px] rounded-card" />;
    return (
      <div className="flex items-center gap-2 text-[13.5px] text-fg-muted">
        <IconFileText size={15} stroke={1.5} />
        <span className="shimmer-text">{name === "show_document" ? "Opening the document" : "Changing the document"}</span>
      </div>
    );
  }
  return <DocumentCard snap={snap} building={!out} />;
}
