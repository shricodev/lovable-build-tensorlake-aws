import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { loadEnv, storageEnv, type Env } from "@lovable-diy/shared/env";

export type StorageConfig = Env<typeof storageEnv>;

/**
 * Thin wrapper around one private bucket. The only switch between MinIO and
 * real S3 is `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE`; nothing else changes.
 */
export class Storage {
  readonly s3: S3Client;
  readonly bucket: string;

  constructor(readonly config: StorageConfig = loadEnv(storageEnv)) {
    this.bucket = config.S3_BUCKET;
    this.s3 = new S3Client({
      region: config.S3_REGION,
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.AWS_ACCESS_KEY_ID, secretAccessKey: config.AWS_SECRET_ACCESS_KEY },
    });
  }

  async put(key: string, body: Uint8Array | string, contentType: string, cacheControl?: string) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(cacheControl ? { CacheControl: cacheControl } : {}),
      }),
    );
  }

  async get(key: string): Promise<GetObjectCommandOutput> {
    return this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getBytes(key: string): Promise<Uint8Array> {
    const res = await this.get(key);
    if (!res.Body) throw new Error(`Empty body for ${key}`);
    return res.Body.transformToByteArray();
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async deletePrefix(prefix: string): Promise<number> {
    const keys = await this.list(prefix);
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
      await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch } }));
    }
    return keys.length;
  }

  /** Short-lived download link; the bucket itself is never public. */
  presignGet(key: string, expiresInSecs = 900, downloadName?: string): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName}"` } : {}),
      }),
      { expiresIn: expiresInSecs },
    );
  }

  presignPut(key: string, contentType: string, expiresInSecs = 300): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      {
        expiresIn: expiresInSecs,
      },
    );
  }
}
