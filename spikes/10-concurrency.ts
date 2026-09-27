/**
 * Spike 10: what does the free-tier concurrency limit actually enforce?
 * Spike 04 showed copy() working with a source running, so "1 concurrent"
 * may not be a hard cap. Probe: create sandboxes one after another until
 * refused, then check whether suspending one frees a slot.
 */
import { Sandbox } from "tensorlake";
import { describeError, spike, uniq } from "./lib";

const s = spike("10-concurrency");
const MAX_PROBE = 4;

await s.run(async () => {
  const live: Sandbox[] = [];
  let refusedAt: number | null = null;

  for (let i = 1; i <= MAX_PROBE; i++) {
    try {
      const sb = await Sandbox.create({ name: uniq(`kiln-spike10-${i}`), timeoutSecs: 300 });
      s.track(sb);
      live.push(sb);
      s.note(`create #${i}`, "ok");
    } catch (err) {
      refusedAt = i;
      s.note(`create #${i}`, describeError(err));
      break;
    }
  }
  s.note("maxConcurrentRunning", refusedAt ? refusedAt - 1 : `>= ${MAX_PROBE}`);

  if (refusedAt && live.length > 0) {
    await s.step("suspend one running sandbox", () => live[0]!.suspend());
    const again = await s.step(
      "create after suspending one",
      () => Sandbox.create({ name: uniq("kiln-spike10-after"), timeoutSecs: 300 }),
      {
        allowFail: true,
      },
    );
    if (again) s.track(again);
    s.note("suspendedFreesSlot", again !== undefined);
  }

  const all = await Sandbox.list();
  s.note(
    "listCount",
    all
      .filter((x) => x.status === "running" || x.status === "suspended")
      .map((x) => ({ name: x.name, status: x.status })),
  );
});
