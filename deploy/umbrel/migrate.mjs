// Applies apps/web/drizzle migrations before the server starts (the same SQL drizzle-kit
// migrate runs in development). Safe to run on every start: applied migrations are skipped.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000 });

// Postgres may still be starting after a reboot.
for (let attempt = 1; ; attempt++) {
  try {
    await pool.query("select 1");
    break;
  } catch (err) {
    if (attempt >= 30) throw err;
    console.log(`[migrate] waiting for Postgres (${attempt})`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

await migrate(drizzle(pool), { migrationsFolder: new URL("./drizzle", import.meta.url).pathname });
console.log("[migrate] database is up to date");
await pool.end();
