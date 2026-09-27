import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutPublicAccessBlockCommand,
  type BucketLocationConstraint,
} from "@aws-sdk/client-s3";
import type { Storage } from "./client.js";

export interface SetupStep {
  step: string;
  status: "ok" | "skipped";
  note?: string;
}

/**
 * Idempotent bucket bootstrap. Safe to run repeatedly against MinIO or S3.
 * The public-access-block and bucket CORS APIs are AWS-only; MinIO answers
 * them with MalformedXML/NotImplemented (its buckets are private by default),
 * so they're skipped whenever a custom endpoint is configured.
 */
export async function setupBucket(storage: Storage, opts: { corsOrigins: string[] }): Promise<SetupStep[]> {
  const { s3, bucket } = storage;
  const region = storage.config.S3_REGION;
  const steps: SetupStep[] = [];

  const isAws = !storage.config.S3_ENDPOINT;

  const tolerate = async (step: string, fn: () => Promise<unknown>, awsOnly = false) => {
    if (awsOnly && !isAws) {
      steps.push({ step, status: "skipped", note: "AWS-only API; custom S3 endpoint in use" });
      return;
    }
    try {
      await fn();
      steps.push({ step, status: "ok" });
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      if (name === "NotImplemented" || name === "NotImplementedError") {
        steps.push({ step, status: "skipped", note: "not supported by this S3 implementation" });
      } else throw new Error(`Bucket setup step "${step}" failed: ${name}`, { cause: err });
    }
  };

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    steps.push({ step: "create bucket", status: "skipped", note: "already exists" });
  } catch {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        // us-east-1 must omit the location constraint.
        ...(region !== "us-east-1"
          ? { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } }
          : {}),
      }),
    );
    steps.push({ step: "create bucket", status: "ok" });
  }

  await tolerate(
    "block public access",
    () =>
      s3.send(
        new PutPublicAccessBlockCommand({
          Bucket: bucket,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        }),
      ),
    true,
  );

  await tolerate("lifecycle rules", () =>
    s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: "expire-exports",
              Status: "Enabled",
              Filter: { Prefix: "exports/" },
              Expiration: { Days: 7 },
            },
            // MinIO rejects this action; it cleans up stale multipart uploads on its own.
            ...(isAws
              ? [
                  {
                    ID: "abort-stale-multipart",
                    Status: "Enabled" as const,
                    Filter: { Prefix: "" },
                    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
                  },
                ]
              : []),
          ],
        },
      }),
    ),
  );

  await tolerate(
    "CORS for presigned uploads",
    () =>
      s3.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: opts.corsOrigins,
                AllowedMethods: ["PUT", "GET"],
                AllowedHeaders: ["content-type"],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      ),
    true,
  );

  return steps;
}
