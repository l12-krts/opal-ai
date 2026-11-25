// Composer attachments: validation on upload, ownership checks on send, and conversion into
// model input (images as image parts for vision models, PDFs and text files as extracted text).
import { and, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { FileUIPart } from "ai";
import type { OpalUIMessage } from "@/lib/types";
import { db } from "./db";
import { attachment } from "./db/schema";
import { ApiError } from "./http";

export const ATTACHMENT_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxImageBytes: 12 * 1024 * 1024,
  maxTextBytes: 3 * 1024 * 1024,
  perMessage: 10,
};

const URL_RE = /^\/api\/attachments\/([A-Za-z0-9_-]{8,40})$/;
const MAX_IMAGE_SIDE = 2048;
const MAX_STORED_TEXT = 400_000;
const MAX_TEXT_PER_FILE = 60_000;
const MAX_TEXT_PER_MESSAGE = 150_000;

export type AttachmentView = { id: string; name: string; mediaType: string; kind: "image" | "pdf" | "text" | "file"; size: number; url: string };

function cleanName(name: string): string {
  // Keep it printable and short; it is shown in the UI and quoted to the model.
  const base = name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f<>"]/g, "").trim();
  return (base || "file").slice(0, 120);
}

function sniff(buf: Buffer): "png" | "jpeg" | "gif" | "webp" | "pdf" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) return "gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  return null;
}

function decodeText(buf: Buffer): string | null {
  if (buf.subarray(0, 8192).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/** Validate an uploaded file by its content (never the declared type), normalise it and store it. */
export async function saveUpload(userId: string, file: Blob, rawName: string): Promise<AttachmentView> {
  if (file.size === 0) throw new ApiError(400, "empty_file", "The file is empty");
  if (file.size > ATTACHMENT_LIMITS.maxBytes) throw new ApiError(413, "too_large", "Files can be up to 20 MB");
  const name = cleanName(rawName);
  let buf: Buffer = Buffer.from(await file.arrayBuffer());
  const type = sniff(buf);

  let kind: AttachmentView["kind"];
  let mediaType: string;
  let text: string | null = null;

  if (type === "png" || type === "jpeg" || type === "gif" || type === "webp") {
    if (buf.length > ATTACHMENT_LIMITS.maxImageBytes) throw new ApiError(413, "too_large", "Images can be up to 12 MB");
    const img = sharp(buf, { limitInputPixels: 80_000_000, animated: false }).rotate();
    const meta = await img.metadata().catch(() => null);
    if (!meta?.width || !meta.height) throw new ApiError(415, "bad_image", "That image could not be read");
    // Re-encode: strips EXIF (including location), caps the size, and leaves only formats every
    // vision model accepts.
    const resized = img.resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true });
    if (meta.hasAlpha) {
      buf = await resized.png({ compressionLevel: 8 }).toBuffer();
      mediaType = "image/png";
    } else {
      buf = await resized.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
      mediaType = "image/jpeg";
    }
    kind = "image";
  } else if (type === "pdf") {
    kind = "pdf";
    mediaType = "application/pdf";
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const out = await extractText(pdf, { mergePages: true });
      text = String(out.text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_STORED_TEXT);
    } catch {
      throw new ApiError(415, "bad_pdf", "That PDF could not be read");
    }
  } else {
    if (buf.length > ATTACHMENT_LIMITS.maxTextBytes) throw new ApiError(413, "too_large", "Text files can be up to 3 MB");
    const decoded = decodeText(buf);
    if (decoded === null) throw new ApiError(415, "unsupported", "Opal can read images, PDFs and text files for now");
    kind = "text";
    mediaType = "text/plain";
    text = decoded.slice(0, MAX_STORED_TEXT);
  }

  const id = nanoid();
  await db.insert(attachment).values({ id, userId, name, mediaType, kind, size: buf.length, data: buf, text });
  return { id, name, mediaType, kind, size: buf.length, url: `/api/attachments/${id}` };
}

// What an agent's file is, by its extension, when its content doesn't say (office files, media,
// archives). Only used to label it and pick a viewer; it is always served as a download.
const BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  html: "text/html",
  svg: "image/svg+xml",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/**
 * Store a file an agent made or downloaded on its computer, to show in the chat. Any kind of file:
 * images, PDFs and text are recognised by their content; anything else is kept as it is.
 */
export async function saveAgentFile(userId: string, conversationId: string | null, rawName: string, data: Buffer, scrub?: (s: string) => string): Promise<AttachmentView> {
  if (data.length === 0) throw new ApiError(400, "empty_file", "The file is empty");
  if (data.length > ATTACHMENT_LIMITS.maxBytes) throw new ApiError(413, "too_large", "Files can be up to 20 MB");
  const name = cleanName(rawName);
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  let buf = data;
  const type = sniff(buf);
  let kind: AttachmentView["kind"];
  let mediaType: string;
  let text: string | null = null;
  if (type === "png" || type === "jpeg" || type === "gif" || type === "webp") {
    kind = "image";
    mediaType = `image/${type}`;
  } else if (type === "pdf") {
    kind = "pdf";
    mediaType = "application/pdf";
  } else {
    const decoded = buf.length <= ATTACHMENT_LIMITS.maxTextBytes ? decodeText(buf) : null;
    if (decoded !== null && !["docx", "xlsx", "pptx", "zip"].includes(ext)) {
      kind = "text";
      mediaType = BY_EXTENSION[ext]?.startsWith("text/") || ext === "json" || ext === "svg" ? BY_EXTENSION[ext] : "text/plain";
      text = scrub ? scrub(decoded) : decoded;
      buf = Buffer.from(text, "utf8");
      text = text.slice(0, MAX_STORED_TEXT);
    } else {
      kind = "file";
      mediaType = BY_EXTENSION[ext] ?? "application/octet-stream";
    }
  }
  const id = nanoid();
  await db.insert(attachment).values({ id, userId, conversationId, name, mediaType, kind, size: buf.length, data: buf, text });
  return { id, name, mediaType, kind, size: buf.length, url: `/api/attachments/${id}` };
}

export function attachmentId(url: string): string | null {
  return URL_RE.exec(url)?.[1] ?? null;
}

/**
 * Turn the client's file parts into canonical ones built from our own records, after checking
 * the user owns every file. Also links the files to the conversation.
 */
export async function claimFileParts(userId: string, conversationId: string, parts: { url: string }[]): Promise<FileUIPart[]> {
  if (!parts.length) return [];
  const ids = parts.map((p) => attachmentId(p.url));
  if (ids.some((id) => !id)) throw new ApiError(400, "bad_attachment", "Unknown attachment");
  const rows = await db
    .select({ id: attachment.id, name: attachment.name, mediaType: attachment.mediaType, conversationId: attachment.conversationId })
    .from(attachment)
    .where(and(eq(attachment.userId, userId), inArray(attachment.id, ids as string[])));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: FileUIPart[] = [];
  for (const id of ids as string[]) {
    const r = byId.get(id);
    if (!r || (r.conversationId && r.conversationId !== conversationId)) throw new ApiError(400, "bad_attachment", "Unknown attachment");
    out.push({ type: "file", mediaType: r.mediaType, filename: r.name, url: `/api/attachments/${r.id}` });
  }
  await db
    .update(attachment)
    .set({ conversationId })
    .where(and(eq(attachment.userId, userId), inArray(attachment.id, ids as string[]), isNull(attachment.conversationId)));
  return out;
}

/** Names of the files on a message, for titles and routing. */
export function fileNames(m: OpalUIMessage | undefined): string[] {
  if (!m) return [];
  return m.parts.filter((p): p is FileUIPart => p.type === "file").map((p) => p.filename ?? "file");
}

/**
 * Replace attachment links in user messages with what the model can read. Images become inline
 * image parts when the model can see them; otherwise a short note says an image was attached.
 */
export async function expandAttachments(userId: string, messages: OpalUIMessage[], vision: boolean): Promise<OpalUIMessage[]> {
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const p of m.parts) if (p.type === "file") {
      const id = attachmentId(p.url);
      if (id) ids.add(id);
    }
  }
  if (!ids.size) return messages;
  const rows = await db
    .select()
    .from(attachment)
    .where(and(eq(attachment.userId, userId), inArray(attachment.id, [...ids])));
  const byId = new Map(rows.map((r) => [r.id, r]));

  return messages.map((m) => {
    if (m.role !== "user" || !m.parts.some((p) => p.type === "file")) return m;
    let budget = MAX_TEXT_PER_MESSAGE;
    const parts: OpalUIMessage["parts"] = [];
    for (const p of m.parts) {
      if (p.type !== "file") {
        parts.push(p);
        continue;
      }
      const row = byId.get(attachmentId(p.url) ?? "");
      if (!row) {
        parts.push({ type: "text", text: `[Attachment "${p.filename ?? "file"}" is no longer available]` });
        continue;
      }
      if (row.kind === "image") {
        if (vision) parts.push({ type: "file", mediaType: row.mediaType, filename: row.name, url: `data:${row.mediaType};base64,${row.data.toString("base64")}` });
        else parts.push({ type: "text", text: `[The user attached an image, "${row.name}". The current model can't see images; say so if the image matters.]` });
        continue;
      }
      if (row.kind === "file") {
        parts.push({ type: "text", text: `[Attached file "${row.name}" (${row.mediaType}, ${row.size.toLocaleString("en")} bytes); its content can't be read as text here]` });
        continue;
      }
      const full = row.text ?? "";
      const take = Math.max(0, Math.min(full.length, MAX_TEXT_PER_FILE, budget));
      budget -= take;
      const cut = take < full.length ? `\n[Truncated: showing ${take.toLocaleString("en")} of ${full.length.toLocaleString("en")} characters]` : "";
      parts.push({
        type: "text",
        text: `<attachment name="${row.name.replace(/"/g, "'")}" type="${row.kind}">\n${full.slice(0, take)}${cut}\n</attachment>`,
      });
    }
    return { ...m, parts };
  });
}

export async function deleteUnsentAttachment(userId: string, id: string) {
  await db.delete(attachment).where(and(eq(attachment.id, id), eq(attachment.userId, userId), isNull(attachment.conversationId)));
}

export async function readAttachment(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(attachment)
    .where(and(eq(attachment.id, id), eq(attachment.userId, userId)))
    .limit(1);
  return row ?? null;
}
