/**
 * Creates and locks down the Lovable DIY bucket. Run with `pnpm s3:setup`.
 * Works against MinIO (local) and real S3; see README "Real S3 setup".
 */
import { Storage, setupBucket } from "@lovable-diy/storage";

const storage = new Storage();
const origins = (process.env.APP_URL ?? "http://localhost:3000").split(",");
const steps = await setupBucket(storage, { corsOrigins: origins });

console.log(`Bucket: ${storage.bucket} (${storage.config.S3_ENDPOINT ?? "AWS S3"})`);
for (const s of steps)
  console.log(`  ${s.status === "ok" ? "✓" : "–"} ${s.step}${s.note ? ` (${s.note})` : ""}`);
