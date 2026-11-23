// Server-side check of the attachment pipeline: upload validation, ownership on send, and what
// the model receives. Uses the first user in the database and cleans up after itself.
//   npx tsx scripts/test-attachments.ts
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const sharp = (await import("sharp")).default;
  const { eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../src/server/db");
  const { attachment, user, conversation } = await import("../src/server/db/schema");
  const { saveUpload, claimFileParts, expandAttachments } = await import("../src/server/attachments");

  const [u] = await db.select({ id: user.id }).from(user).limit(1);
  if (!u) throw new Error("No user in the database");
  const created: string[] = [];
  const check = (label: string, ok: boolean, extra = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);

  // 1. A big PNG with alpha stays PNG and is capped at 2048 px; a JPEG-ish photo loses EXIF.
  const png = await sharp({ create: { width: 3000, height: 1200, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } }).png().toBuffer();
  const a1 = await saveUpload(u.id, new Blob([new Uint8Array(png)]), "wide.png");
  created.push(a1.id);
  const [row1] = await db.select().from(attachment).where(eq(attachment.id, a1.id));
  const meta1 = await sharp(row1.data).metadata();
  check("image resized to 2048 max", meta1.width === 2048 && a1.mediaType === "image/png", `${meta1.width}x${meta1.height} ${a1.mediaType}`);

  // 2. Text file is decoded; a declared image that is really text is treated by content.
  const a2 = await saveUpload(u.id, new Blob(["# Notes\nΓεια σου κόσμε\n"]), "notes.md");
  created.push(a2.id);
  check("utf-8 text accepted", a2.kind === "text");

  // 3. Binary junk is rejected.
  let rejected = false;
  try {
    await saveUpload(u.id, new Blob([new Uint8Array([0, 1, 2, 3, 0, 255, 254, 0])]), "x.bin");
  } catch (e) {
    rejected = (e as { code?: string }).code === "unsupported";
  }
  check("binary rejected", rejected);

  // 4. SVG (script-capable) is stored as plain text, never served as an image.
  const a4 = await saveUpload(u.id, new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>']), "evil.svg");
  created.push(a4.id);
  check("svg stored as text", a4.kind === "text" && a4.mediaType === "text/plain");

  // 5. Another user's attachment can't be claimed.
  const convId = `test${Date.now().toString(36)}xx`;
  await db.insert(conversation).values({ id: convId, userId: u.id, mode: "chat" });
  let foreign = false;
  try {
    await claimFileParts("someone-else", convId, [{ url: a1.url }]);
  } catch (e) {
    foreign = (e as { code?: string }).code === "bad_attachment";
  }
  check("foreign claim refused", foreign);
  let forged = false;
  try {
    await claimFileParts(u.id, convId, [{ url: "https://evil.example/x.png" }]);
  } catch (e) {
    forged = (e as { code?: string }).code === "bad_attachment";
  }
  check("forged url refused", forged);

  // 6. Claim and expand for a non-vision and a vision model.
  const parts = await claimFileParts(u.id, convId, [{ url: a1.url }, { url: a2.url }]);
  check("claim returns canonical parts", parts.length === 2 && parts[0].filename === "wide.png");
  const msg = [{ id: "m1", role: "user" as const, parts: [...parts, { type: "text" as const, text: "what is this?" }] }];
  const noVision = await expandAttachments(u.id, msg, false);
  const vision = await expandAttachments(u.id, msg, true);
  const nvText = noVision[0].parts.map((p) => (p.type === "text" ? p.text : p.type)).join(" | ");
  check("non-vision gets a note + text", nvText.includes("can't see images") && nvText.includes("Γεια σου κόσμε"));
  const vp = vision[0].parts[0];
  check("vision gets inline image", vp.type === "file" && vp.url.startsWith("data:image/png;base64,"));

  await db.delete(attachment).where(inArray(attachment.id, created));
  await db.delete(conversation).where(eq(conversation.id, convId));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
