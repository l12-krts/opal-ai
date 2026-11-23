// ebooks.edu.gr (Διαδραστικά Σχολικά Βιβλία, Diofantos). Uses the site's own JSON endpoint that
// lists every textbook per grade, then reads HTML chapters or PDF text on demand.
import * as cheerio from "cheerio";
import { safeFetch } from "../net";
import { htmlToText } from "../ai/tools/web";
import { normalizeGreek, type StudyItem, type StudyReadResult, type StudySource } from "./types";

const BASE = "https://ebooks.edu.gr/ebooks";
const CACHE_MS = 12 * 60 * 60 * 1000;
const CHUNK = 12000;

export const GRADES: Record<string, string> = {
  K01: "Α΄ Δημοτικού",
  K02: "Β΄ Δημοτικού",
  K03: "Γ΄ Δημοτικού",
  K04: "Δ΄ Δημοτικού",
  K05: "Ε΄ Δημοτικού",
  K06: "ΣΤ΄ Δημοτικού",
  K07: "Α΄ Γυμνασίου",
  K08: "Β΄ Γυμνασίου",
  K09: "Γ΄ Γυμνασίου",
  K10: "Α΄ Λυκείου",
  K11: "Β΄ Λυκείου",
  K12: "Γ΄ Λυκείου",
};

type Book = { title: string; description: string; format: "html" | "pdf"; path: string; grade: string; variant: string };

const g = globalThis as unknown as { __ebooks?: Map<string, { at: number; books: Book[] }> };
const cache = (g.__ebooks ??= new Map());

function gradeUrl(grade: string) {
  const p = new URLSearchParams();
  p.append("query_field[]", "course.lom.classification-grade");
  p.append("query_field[]", "manifestation.lom.lifecycle-status");
  p.append("query_op[]", "equals");
  p.append("query_op[]", "equals");
  p.append("query_op[]", "equals");
  p.append("query_val[]", grade);
  p.append("query_val[]", "1");
  p.set("limit", "-1");
  p.set("offset", "0");
  p.set("expand", "all,metadata");
  p.set("filters", "none");
  p.set("selected_columns", "m1.*");
  p.set("selected_elements", "'general-title','classification-digitalExpression','general-description'");
  p.set("selected_collections", "'course','work','expression','manifestation'");
  return `${BASE}/rest/get-items-info-2?${p.toString()}`;
}

async function loadGrade(grade: string): Promise<Book[]> {
  const hit = cache.get(grade);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.books;
  const { res, body } = await safeFetch(gradeUrl(grade), { maxBytes: 8 * 1024 * 1024, timeoutMs: 20000 });
  if (!res.ok) throw new Error(`ebooks.edu.gr returned ${res.status}`);
  const items = JSON.parse(body.toString("utf8")) as Array<{
    manifestation_view_url?: string;
    metadata: Array<{ key: string; value: string }>;
  }>;
  const books: Book[] = [];
  for (const it of items) {
    if (!it.manifestation_view_url) continue;
    const md = Object.fromEntries(it.metadata.map((m) => [m.key, m.value]));
    const variant = md["expression.lom.classification-digitalExpression"] ?? "";
    // Skip large-print editions; keep regular HTML and web PDFs.
    if (/\d+pt/.test(variant) || variant.includes("i-book") || variant.includes("ISO")) continue;
    const desc = md["manifestation.lom.general-description"] ?? "";
    const title = /«([^»]+)»/.exec(desc)?.[1] ?? md["work.lom.general-title"] ?? it.manifestation_view_url.split("/").filter(Boolean).pop()!;
    books.push({
      title: title.trim(),
      description: (md["work.lom.general-description"] ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
      format: it.manifestation_view_url.startsWith("/v/html") ? "html" : "pdf",
      path: it.manifestation_view_url,
      grade,
      variant,
    });
  }
  cache.set(grade, { at: Date.now(), books });
  return books;
}

function toItem(b: Book): StudyItem {
  return {
    id: `ebooks:${b.path}`,
    title: b.title,
    subtitle: `${GRADES[b.grade] ?? b.grade} · ${b.format.toUpperCase()}`,
    kind: "book",
    format: b.format,
    url: `${BASE}${b.path}`,
  };
}

function assertBookPath(ref: string): string {
  const path = ref.replace(/^ebooks:/, "");
  if (!/^\/v\/(html|pdf)\/[\w./-]+$/.test(path) || path.includes("..")) throw new Error("Not an ebooks.edu.gr book reference");
  return path;
}

export const ebooksSource: StudySource = {
  id: "ebooks",
  name: "ebooks.edu.gr",
  description: "Official Greek school textbooks (Δημοτικό, Γυμνάσιο, Λύκειο) from the Digital School.",

  async search(_userId, query, opts = {}) {
    const grades = opts.grade && GRADES[opts.grade] ? [opts.grade] : Object.keys(GRADES);
    const lists = await Promise.allSettled(grades.map(loadGrade));
    const q = normalizeGreek(query).split(/\s+/).filter(Boolean);
    const scored: { b: Book; score: number }[] = [];
    for (const r of lists) {
      if (r.status !== "fulfilled") continue;
      for (const b of r.value) {
        const hay = normalizeGreek(`${b.title} ${b.description}`);
        const title = normalizeGreek(b.title);
        let score = 0;
        for (const w of q) {
          if (title.includes(w)) score += 3;
          else if (hay.includes(w)) score += 1;
        }
        if (score > 0) scored.push({ b, score: score + (b.format === "html" ? 0.5 : 0) });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const out: StudyItem[] = [];
    for (const { b } of scored) {
      const key = `${b.title}|${b.format}|${b.grade}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(toItem(b));
      if (out.length >= (opts.limit ?? 12)) break;
    }
    return out;
  },

  async browse(_userId, ref) {
    if (!ref) {
      return Object.entries(GRADES).map(([code, label]) => ({ id: `grade:${code}`, title: label, kind: "course" as const }));
    }
    if (ref.startsWith("grade:")) {
      const books = await loadGrade(ref.slice(6));
      return books.map(toItem);
    }
    return [];
  },

  async read(_userId, ref, opts = {}) {
    const offset = Math.max(0, opts.offset ?? 0);
    // Chapter refs look like ebooks:/v/html/.../index_01_02.html
    const path = assertBookPath(ref);
    const url = `${BASE}${path}`;

    if (path.startsWith("/v/pdf/")) {
      const { res, body } = await safeFetch(url, { maxBytes: 60 * 1024 * 1024, timeoutMs: 45000 });
      if (!res.ok) throw new Error(`ebooks.edu.gr returned ${res.status}`);
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(body));
      const { text } = await extractText(pdf, { mergePages: true });
      const full = String(text).replace(/\s+\n/g, "\n");
      return { title: path.split("/").filter(Boolean).pop() ?? "Book", text: full.slice(offset, offset + CHUNK), offset, total: full.length, url };
    }

    const { res, body } = await safeFetch(url, { timeoutMs: 20000 });
    if (!res.ok) throw new Error(`ebooks.edu.gr returned ${res.status}`);
    const html = body.toString("utf8");
    const $ = cheerio.load(html);
    const bookTitle = $(".ebook_left span").first().text().trim();
    const dir = path.endsWith("/") ? path : path.slice(0, path.lastIndexOf("/") + 1);
    const sections: StudyItem[] = [];
    $('select[name="section"] option').each((_, el) => {
      const v = $(el).attr("value");
      const label = $(el).text().replace(/ /g, " ").trim();
      if (v && /^index[\w-]*\.html$/.test(v) && label) {
        sections.push({ id: `ebooks:${dir}${v}`, title: label, kind: "chapter", format: "html" });
      }
    });
    $("#eclass_ebook_header, select, script, style").remove();
    const { text } = htmlToText($.html());
    return {
      title: bookTitle || "Chapter",
      text: text.slice(offset, offset + CHUNK),
      offset,
      total: text.length,
      sections: offset === 0 ? dedupe(sections) : undefined,
      url,
    };
  },
};

function dedupe(items: StudyItem[]) {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.title) ? false : (seen.add(i.title), true)));
}
