import "server-only";
import { and, desc, eq, getDb, lt, versions, type Version } from "@kiln/db";
import { HttpError } from "./api";

export async function getVersion(projectId: string, versionId: string): Promise<Version> {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) throw new HttpError(404, "Version not found");
  const [v] = await getDb()
    .db.select()
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.projectId, projectId)));
  if (!v) throw new HttpError(404, "Version not found");
  return v;
}

/** The version before `v`, or null for the first one (then we diff against the template commit). */
export async function previousVersion(v: Version): Promise<Version | null> {
  const [prev] = await getDb()
    .db.select()
    .from(versions)
    .where(and(eq(versions.projectId, v.projectId), lt(versions.number, v.number)))
    .orderBy(desc(versions.number))
    .limit(1);
  return prev ?? null;
}
