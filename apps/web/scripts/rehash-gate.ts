// Re-hashes the password in .data/gate-password.txt into .env.local (used after format changes).
import { readFileSync, writeFileSync } from "node:fs";
import { hashGatePassword } from "../src/server/password-hash";

const pw = readFileSync(".data/gate-password.txt", "utf8").trim();
const env = readFileSync(".env.local", "utf8");
writeFileSync(".env.local", env.replace(/^OPAL_GATE_PASSWORD_HASH=.*$/m, `OPAL_GATE_PASSWORD_HASH=${hashGatePassword(pw)}`));
console.log("rehashed");
