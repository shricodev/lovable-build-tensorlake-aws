/** Worker process: consumes pg-boss jobs and runs agent turns. */
import { CANCEL_CHANNEL, getBoss, getDb, QUEUES, type AgentTurnJob } from "@kiln/db";
import { createLogger } from "@kiln/shared";
import { handleAgentTurn } from "./jobs/agent-turn";
import { reap } from "./jobs/reaper";

const log = createLogger("worker");
const { db, sql } = getDb();
const boss = await getBoss();
const cancelSignals = new Map<string, AbortController>();

// The web app asks for cancellation with NOTIFY; whichever worker holds the run aborts it.
await sql.listen(CANCEL_CHANNEL, (runId) => {
  const ac = cancelSignals.get(runId);
  if (ac) {
    log.info({ runId }, "cancelling run");
    ac.abort();
  }
});

await boss.work<AgentTurnJob>(QUEUES.agentTurn, { localConcurrency: 3 }, async ([job]) => {
  if (job) await handleAgentTurn(job.data, { db, log, cancelSignals });
});

await boss.schedule(QUEUES.reaper, "* * * * *");
await boss.work(QUEUES.reaper, async () => {
  await reap(log).catch((err) => log.error({ err }, "reaper failed"));
});

log.info("worker ready");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    log.info("shutting down");
    for (const ac of cancelSignals.values()) ac.abort();
    await boss.stop({ graceful: true, timeout: 20_000 }).catch(() => {});
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
