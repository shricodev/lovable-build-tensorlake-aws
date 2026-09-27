import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { appendEvent } from "./events";
import { versions, type Version } from "./schema";

/** Insert the next version number for a project (serialized per project). */
export async function recordVersion(
  db: Db,
  v: Omit<typeof versions.$inferInsert, "number" | "id" | "createdAt">,
): Promise<Version> {
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${v.projectId}))`);
    const [last] = await tx
      .select({ n: versions.number })
      .from(versions)
      .where(eq(versions.projectId, v.projectId))
      .orderBy(desc(versions.number))
      .limit(1);
    const [created] = await tx
      .insert(versions)
      .values({ ...v, number: (last?.n ?? 0) + 1 })
      .returning();
    return created!;
  });
  await appendEvent(db, {
    projectId: v.projectId,
    runId: v.runId ?? null,
    type: "version",
    payload: { id: row.id, number: row.number, title: row.title, source: row.source },
  });
  return row;
}

export function versionTitle(prompt: string): string {
  const t = prompt.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}
