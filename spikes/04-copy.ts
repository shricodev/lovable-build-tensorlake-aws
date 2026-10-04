/**
 * Spike 04: live-copy (fork) a running sandbox with `sandbox.copy()`.
 * On the free tier (1 concurrent sandbox) this is expected to be refused;
 * the point is to learn exactly how, so the governor can plan around it.
 */
import { Sandbox } from "tensorlake";
import { dec, enc, spike, uniq } from "./lib";

const s = spike("04-copy");

await s.run(async () => {
  const src = s.track(
    (await s.step("create source", () => Sandbox.create({ name: uniq("lovable-diy-spike04"), timeoutSecs: 300 })))!,
  );
  await src.writeFile("/home/tl-user/marker.txt", enc.encode("from-source"));

  const res = await s.step("copy({ times: 1 })", () => src.copy({ times: 1 }), { allowFail: true });
  s.note("copyResponse", res);

  for (const c of res?.sandboxes ?? []) {
    if (c.status === "failed") continue;
    const copy = s.track(await Sandbox.connect({ sandboxId: c.sandboxId }));
    const marker = await s.step(
      "read marker in copy",
      async () => dec.decode(await copy.readFile("/home/tl-user/marker.txt")),
      {
        allowFail: true,
      },
    );
    s.note("copyHasSourceFiles", marker === "from-source");
  }
});
