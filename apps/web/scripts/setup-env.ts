// Creates .env.local from .env.example with fresh random secrets.
// The generated site-lock password is written to .data/gate-password.txt (gitignored) — never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hashGatePassword } from "../src/server/password-hash";

const envPath = ".env.local";
if (existsSync(envPath)) {
  console.log(".env.local already exists — leaving it alone.");
  process.exit(0);
}

const words = randomBytes(18).toString("base64url"); // ~24 chars, 144 bits
const gatePassword = `opal-${words}`;

const fill: Record<string, string> = {
  OPAL_GATE_PASSWORD_HASH: hashGatePassword(gatePassword),
  OPAL_GATE_SECRET: randomBytes(32).toString("base64url"),
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
  OPAL_SECRETS_KEY: randomBytes(32).toString("base64"),
};

const out = readFileSync(".env.example", "utf8")
  .split(/\r?\n/)
  .map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && fill[m[1]] !== undefined && m[2] === "") return `${m[1]}=${fill[m[1]]}`;
    return line;
  })
  .join("\n");

writeFileSync(envPath, out, { mode: 0o600 });
mkdirSync(".data", { recursive: true });
writeFileSync(".data/gate-password.txt", `${gatePassword}\n`, { mode: 0o600 });
console.log("Wrote .env.local. Site-lock password saved to .data/gate-password.txt");
