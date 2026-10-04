/**
 * Spike 02: file API semantics that the agent's file tools depend on:
 * nested writes, reads, listing, deletes, missing files, big files, and
 * whether the file API follows symlinks (matters for path-escape checks).
 */
import { Sandbox } from "tensorlake";
import { dec, describeError, enc, spike, uniq } from "./lib";

const s = spike("02-files");
const root = "/home/tl-user/app";

await s.run(async () => {
  const sb = s.track(
    (await s.step("create", () => Sandbox.create({ name: uniq("lovable-diy-spike02"), timeoutSecs: 300 })))!,
  );

  const nested = await s.step(
    "writeFile into a directory that doesn't exist yet",
    () =>
      sb.writeFile(`${root}/src/components/Hello.tsx`, enc.encode("export const Hello = () => <p>hi</p>;\n")),
    { allowFail: true },
  );
  s.note("writeCreatesParents", nested !== undefined || "see step error");

  await s.step("mkdir -p then write", async () => {
    await sb.run("mkdir", { args: ["-p", `${root}/src/components`] });
    await sb.writeFile(
      `${root}/src/components/Hello.tsx`,
      enc.encode("export const Hello = () => <p>hi</p>;\n"),
    );
  });

  const read = await s.step("readFile", async () =>
    dec.decode(await sb.readFile(`${root}/src/components/Hello.tsx`)),
  );
  s.note("roundTrip", read?.includes("Hello"));

  const list = await s.step("listDirectory", () => sb.listDirectory(`${root}/src`));
  s.note("listEntries", list?.entries);

  const missing = await s.step("readFile missing path", () => sb.readFile(`${root}/nope.txt`), {
    allowFail: true,
  });
  s.note("missingRead", missing === undefined ? "throws (see steps)" : "returned");

  const big = new Uint8Array(5 * 1024 * 1024).fill(97);
  await s.step("write 5 MB file", () => sb.writeFile(`${root}/big.txt`, big));
  const bigBack = await s.step("read 5 MB file", () => sb.readFile(`${root}/big.txt`));
  s.note("bigRoundTripBytes", bigBack?.length);

  await s.step("deleteFile", () => sb.deleteFile(`${root}/big.txt`));

  // Symlink escape: does the file API follow a link that points outside the project?
  await sb.run("ln", { args: ["-s", "/etc/passwd", `${root}/leak.txt`] });
  const viaLink = await s.step(
    "readFile through symlink to /etc/passwd",
    () => sb.readFile(`${root}/leak.txt`),
    {
      allowFail: true,
    },
  );
  s.note("fileApiFollowsSymlinks", viaLink ? dec.decode(viaLink).startsWith("root:") : false);

  const dotdot = await s.step(
    "readFile with .. segments",
    () => sb.readFile(`${root}/../../../etc/hostname`),
    {
      allowFail: true,
    },
  );
  s.note("fileApiAllowsDotDot", dotdot !== undefined);

  const outside = await s.step(
    "writeFile to /etc (as tl-user)",
    () => sb.writeFile("/etc/lovable-diy-test", enc.encode("x")),
    {
      allowFail: true,
    },
  );
  s.note("canWriteEtc", outside !== undefined);

  const who = await sb.run("bash", {
    args: ["-lc", "id; sudo -n true 2>&1 && echo SUDO_OK || echo NO_SUDO"],
  });
  s.note("identity", who.stdout.trim());

  const tRun = await s.step("run() timeout result shape", async () => {
    try {
      return await sb.run("sleep", { args: ["10"], timeout: 2 });
    } catch (e) {
      return { threw: describeError(e) };
    }
  });
  s.note("runTimeoutResult", tRun);
});
