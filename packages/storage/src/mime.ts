const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  map: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
};

export function contentTypeFor(path: string): string {
  return TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Vite's hashed assets never change; everything else must revalidate. */
export function cacheControlFor(path: string): string {
  return /(^|\/)assets\/.+-[A-Za-z0-9_-]{8,}\.\w+$/.test(path)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}
