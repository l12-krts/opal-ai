// Secrets vault. Values are encrypted with AES-256-GCM using a per-user key derived (HKDF) from
// OPAL_SECRETS_KEY, so a leaked row from one user can't be decrypted with another user's context.
//
// The model never sees a secret: it only knows secret *names* and writes placeholders like
// {{secret:ECLASS_PASSWORD}}. Tools resolve placeholders server-side right before use, and
// redact() scrubs any secret value out of tool output before it goes back to the model.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { secret } from "./db/schema";
import { env } from "./env";

const VERSION = "v1";

function userKey(userId: string): Buffer {
  const master = Buffer.from(env().OPAL_SECRETS_KEY, "base64");
  return Buffer.from(hkdfSync("sha256", master, Buffer.from(userId), Buffer.from("opal-vault-v1"), 32));
}

export function encryptSecret(userId: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", userKey(userId), iv);
  cipher.setAAD(Buffer.from(userId));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(userId: string, payload: string): string {
  const [v, ivB, tagB, ctB] = payload.split(".");
  if (v !== VERSION) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", userKey(userId), Buffer.from(ivB, "base64url"));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

export async function listSecrets(userId: string) {
  return db
    .select({
      id: secret.id,
      name: secret.name,
      label: secret.label,
      description: secret.description,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      lastUsedAt: secret.lastUsedAt,
    })
    .from(secret)
    .where(eq(secret.userId, userId))
    .orderBy(secret.name);
}

export async function putSecret(
  userId: string,
  input: { name: string; label: string; description?: string; value: string },
) {
  if (!SECRET_NAME.test(input.name)) throw new Error("Invalid secret name");
  const ciphertext = encryptSecret(userId, input.value);
  await db
    .insert(secret)
    .values({
      id: nanoid(),
      userId,
      name: input.name,
      label: input.label,
      description: input.description ?? "",
      ciphertext,
    })
    .onConflictDoUpdate({
      target: [secret.userId, secret.name],
      set: { ciphertext, label: input.label, description: input.description ?? "", updatedAt: new Date() },
    });
}

export async function deleteSecret(userId: string, name: string) {
  await db.delete(secret).where(and(eq(secret.userId, userId), eq(secret.name, name)));
}

/** Server-side only. Returns the decrypted value or null. */
export async function readSecret(userId: string, name: string): Promise<string | null> {
  if (!SECRET_NAME.test(name)) return null;
  const [row] = await db
    .select({ ciphertext: secret.ciphertext, id: secret.id })
    .from(secret)
    .where(and(eq(secret.userId, userId), eq(secret.name, name)))
    .limit(1);
  if (!row) return null;
  await db.update(secret).set({ lastUsedAt: new Date() }).where(eq(secret.id, row.id));
  return decryptSecret(userId, row.ciphertext);
}

const PLACEHOLDER = /\{\{\s*secret:([A-Z][A-Z0-9_]{1,63})\s*\}\}/g;

/**
 * Replace {{secret:NAME}} placeholders with real values. Returns the resolved text plus the
 * values used, so callers can redact them from whatever comes back.
 */
export async function resolvePlaceholders(userId: string, text: string) {
  const names = new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]));
  const values: string[] = [];
  const missing: string[] = [];
  const map = new Map<string, string>();
  for (const name of names) {
    const v = await readSecret(userId, name);
    if (v == null) missing.push(name);
    else {
      map.set(name, v);
      values.push(v);
    }
  }
  const resolved = text.replace(PLACEHOLDER, (m, name: string) => map.get(name) ?? m);
  return { resolved, values, missing };
}

/** Scrub secret values (and simple encodings of them) out of text headed to a model. */
export function redact(text: string, values: string[]): string {
  let out = text;
  for (const v of values) {
    if (!v || v.length < 4) continue;
    for (const form of [v, encodeURIComponent(v), Buffer.from(v).toString("base64")]) {
      out = out.split(form).join("[secret]");
    }
  }
  return out;
}
