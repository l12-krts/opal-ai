// Postgres via node-postgres + Drizzle. All queries go through Drizzle's query builder, which
// always sends parameters separately from SQL text (no string-built SQL anywhere).
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const g = globalThis as unknown as { __opalPool?: Pool };

const pool =
  g.__opalPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Fail fast instead of hanging requests if the DB is down.
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  });

if (process.env.NODE_ENV !== "production") g.__opalPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export { schema };
