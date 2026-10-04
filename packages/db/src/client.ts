import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

/** One pool per process. `sql` is exposed for LISTEN/NOTIFY. */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), sql };
}

const g = globalThis as unknown as { __lovableDiyDb?: ReturnType<typeof createDb> };

/** Lazy singleton that survives Next.js dev hot reloads. */
export function getDb() {
  g.__lovableDiyDb ??= createDb();
  return g.__lovableDiyDb;
}
