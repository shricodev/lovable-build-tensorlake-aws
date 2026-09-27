/**
 * Every object key Kiln writes is built here, so the bucket layout lives in
 * one place (it's also documented in README "Storage layout").
 */

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function seg(value: string, name: string): string {
  if (!SAFE_SEGMENT.test(value))
    throw new Error(`Unsafe S3 key segment for ${name}: ${JSON.stringify(value)}`);
  return value;
}

export const storageKeys = {
  export: (projectId: string, exportId: string) =>
    `exports/${seg(projectId, "projectId")}/${seg(exportId, "exportId")}.zip`,
  screenshot: (projectId: string, versionId: string) =>
    `screenshots/${seg(projectId, "projectId")}/${seg(versionId, "versionId")}.png`,
  publishedPrefix: (slug: string, versionId: string) =>
    `published/${seg(slug, "slug")}/${seg(versionId, "versionId")}/`,
  evalPrefix: (runId: string) => `evals/${seg(runId, "runId")}/`,
  upload: (userId: string, uploadId: string) =>
    `uploads/${seg(userId, "userId")}/${seg(uploadId, "uploadId")}`,
};
