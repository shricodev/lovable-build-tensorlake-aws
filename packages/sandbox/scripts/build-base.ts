/** `pnpm sandbox:build-base`: build the warm base snapshot and record its id in .kiln/base-snapshot.json. */
import { createLogger } from "@kiln/shared";
import { buildBaseSnapshot, readBaseSnapshot, templateTarball } from "../src/base-snapshot";

const log = createLogger("build-base");
const existing = readBaseSnapshot();
const { hash } = templateTarball();
if (existing && existing.templateHash === hash && !process.argv.includes("--force")) {
  log.info(
    { snapshotId: existing.snapshotId },
    "base snapshot is up to date with the template (use --force to rebuild)",
  );
  process.exit(0);
}
const rec = await buildBaseSnapshot(log);
log.info(rec, "base snapshot ready");
