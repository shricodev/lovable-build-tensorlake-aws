import "server-only";
import { and, eq, getDb, sandboxes } from "@kiln/db";
import { ProjectSandbox } from "@kiln/sandbox";
import { createLogger } from "@kiln/shared";
import { HttpError } from "./api";

const log = createLogger("web", { transport: undefined });

/** Connect to the project's running main sandbox, or 409 when there isn't one yet / it's asleep. */
export async function projectSandbox(projectId: string): Promise<ProjectSandbox> {
  const [row] = await getDb()
    .db.select()
    .from(sandboxes)
    .where(and(eq(sandboxes.projectId, projectId), eq(sandboxes.role, "main")));
  if (!row || row.status === "terminated")
    throw new HttpError(409, "This project has no sandbox yet. Send a prompt first.");
  return ProjectSandbox.connect(row.tensorlakeId, log);
}
