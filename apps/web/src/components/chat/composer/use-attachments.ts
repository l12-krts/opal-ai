"use client";
// Composer attachments: files upload as soon as they are added, so sending is instant.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileUIPart } from "ai";
import { toast } from "krts.ui";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";

export type AttachmentKind = "image" | "pdf" | "text";

export type Attachment = {
  key: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  previewUrl?: string;
  pasted?: { lines: number };
  status: "uploading" | "ready" | "error";
  error?: string;
  remote?: { id: string; url: string; mediaType: string; name: string };
};

const MAX_FILES = 10;
const MAX_BYTES = 20 * 1024 * 1024;

export const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/*,.md,.markdown,.csv,.tsv,.json,.txt,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.rb,.php,.swift,.kt,.sql,.sh,.tex";

function kindOf(file: File): AttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return "text";
}

let seq = 0;

export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Free image previews when the composer goes away.
  useEffect(
    () => () => {
      for (const a of itemsRef.current) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    },
    [],
  );

  const patch = (key: string, p: Partial<Attachment>) => setItems((list) => list.map((a) => (a.key === key ? { ...a, ...p } : a)));

  const upload = useCallback(async (key: string, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      const { attachment } = await apiFetch<{ attachment: { id: string; url: string; mediaType: string; name: string; kind: AttachmentKind } }>(
        "/api/attachments",
        { method: "POST", body: form },
      );
      // The removed-while-uploading case: forget the upload server-side too.
      if (!itemsRef.current.some((a) => a.key === key)) {
        void apiFetch(attachment.url, { method: "DELETE" }).catch(() => {});
        return;
      }
      patch(key, { status: "ready", kind: attachment.kind, remote: attachment });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("composer.uploadFailed");
      patch(key, { status: "error", error: message });
      toast.error(t("composer.uploadFailed"), { description: message });
    }
  }, []);

  const add = useCallback(
    (files: File[], opts: { pasted?: { lines: number } } = {}) => {
      const room = MAX_FILES - itemsRef.current.length;
      if (files.length > room) toast(t("composer.tooMany"));
      const accepted: Attachment[] = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        if (file.size > MAX_BYTES) {
          toast.error(t("composer.tooLarge", { name: file.name }));
          continue;
        }
        const kind = kindOf(file);
        const a: Attachment = {
          key: `a${++seq}`,
          name: opts.pasted ? t("composer.pasted") : file.name,
          size: file.size,
          kind,
          pasted: opts.pasted,
          previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
          status: "uploading",
        };
        accepted.push(a);
        void upload(a.key, file);
      }
      if (accepted.length) setItems((list) => [...list, ...accepted]);
    },
    [upload],
  );

  const remove = useCallback((key: string) => {
    const a = itemsRef.current.find((x) => x.key === key);
    if (!a) return;
    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    if (a.remote) void apiFetch(a.remote.url, { method: "DELETE" }).catch(() => {});
    setItems((list) => list.filter((x) => x.key !== key));
  }, []);

  /** Hand the uploaded files to the message and reset, keeping previews alive for the sent bubble. */
  const take = useCallback((): FileUIPart[] => {
    const parts = itemsRef.current
      .filter((a) => a.status === "ready" && a.remote)
      .map((a) => ({ type: "file" as const, url: a.remote!.url, mediaType: a.remote!.mediaType, filename: a.remote!.name }));
    for (const a of itemsRef.current) if (a.previewUrl) setTimeout(() => URL.revokeObjectURL(a.previewUrl!), 5000);
    setItems([]);
    return parts;
  }, []);

  const uploading = items.some((a) => a.status === "uploading");
  const ready = items.filter((a) => a.status === "ready").length;

  return { items, add, remove, take, uploading, ready };
}
