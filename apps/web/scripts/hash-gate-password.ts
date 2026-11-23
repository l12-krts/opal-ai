// Usage: npm run gate:hash -- "my new password"
// Prints a value for OPAL_GATE_PASSWORD_HASH.
import { hashGatePassword } from "../src/server/password-hash";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error("Give a password of at least 12 characters: npm run gate:hash -- \"...\"");
  process.exit(1);
}
console.log(hashGatePassword(password));
