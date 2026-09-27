import { PgBoss } from "pg-boss";

export const QUEUES = { agentTurn: "agent-turn", reaper: "reaper" } as const;

export interface AgentTurnJob {
  runId: string;
}

const g = globalThis as unknown as { __kilnBoss?: Promise<PgBoss> };

/** Started pg-boss singleton (shares Postgres with the app; tables live in the `pgboss` schema). */
export function getBoss(url = process.env.DATABASE_URL): Promise<PgBoss> {
  g.__kilnBoss ??= (async () => {
    if (!url) throw new Error("DATABASE_URL is not set");
    const boss = new PgBoss(url);
    boss.on("error", (err) => console.error("[pg-boss]", err));
    await boss.start();
    for (const q of Object.values(QUEUES)) await boss.createQueue(q).catch(() => {});
    return boss;
  })();
  return g.__kilnBoss;
}

export async function enqueueAgentTurn(job: AgentTurnJob) {
  const boss = await getBoss();
  // Agent turns are not retried automatically: a half-finished turn needs a
  // human decision, and the run row records what happened.
  return boss.send(QUEUES.agentTurn, job, { retryLimit: 0, expireInSeconds: 30 * 60 });
}
