/** `pnpm db:migrate`: apply SQL migrations from ./migrations. */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const { db, sql } = createDb();
await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
await sql.end();
console.log("migrations applied");
