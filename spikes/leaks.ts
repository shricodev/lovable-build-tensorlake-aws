/** Lists anything the spikes may have left behind (running/suspended sandboxes, snapshots, repos). */
import { RepositoryClient, Sandbox } from "tensorlake";

const live = (await Sandbox.list()).filter((s) => s.status !== "terminated");
const snaps = await Sandbox.listSnapshots();
const repos = await new RepositoryClient().list();
console.log(
  JSON.stringify(
    {
      sandboxes: live.map((s) => ({ id: s.sandboxId, name: s.name, status: s.status })),
      snapshots: snaps.map((s) => ({ id: s.snapshotId, sandbox: s.sandboxId, type: s.snapshotType })),
      repos: repos.map((r) => r.name),
    },
    null,
    2,
  ),
);
if (process.argv.includes("--clean")) {
  for (const s of live)
    if (s.name?.startsWith("kiln-spike"))
      await (await Sandbox.connect({ sandboxId: s.sandboxId })).terminate();
  for (const r of repos) if (r.name.startsWith("kiln-spike")) await new RepositoryClient().delete(r.name);
  console.log("cleaned kiln-spike* sandboxes and repos");
}
