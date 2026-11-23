#!/usr/bin/env node
// Usage inside the sandbox: opal-browser '{"action":"goto","url":"https://example.com"}'
const port = Number(process.env.OPAL_BROWSER_PORT || 7777);
const body = process.argv[2] || "{}";

async function main() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body });
      process.stdout.write(await res.text());
      return;
    } catch {
      // Browser server still starting.
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  process.stdout.write(JSON.stringify({ ok: false, error: "Browser did not start" }));
}

main();
