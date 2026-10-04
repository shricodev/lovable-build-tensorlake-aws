import type { Plugin } from "vite";

/**
 * Dev-only: injects a tiny script that forwards runtime errors to the parent
 * window (the Lovable DIY workspace), which stores them for the agent's
 * `get_browser_errors` tool. Not included in production builds.
 */
const script = `
(() => {
  if (window.parent === window) return;
  let sent = 0;
  const post = (kind, message, stack) => {
    if (sent++ > 50) return; // don't flood the parent on render loops
    try {
      window.parent.postMessage(
        { source: "lovable-diy-preview", kind, message: String(message).slice(0, 2000), stack: stack ? String(stack).slice(0, 4000) : undefined, url: location.pathname + location.search },
        "*",
      );
    } catch {}
  };
  window.addEventListener("error", (e) => post("error", e.message, e.error && e.error.stack));
  window.addEventListener("unhandledrejection", (e) => post("unhandledrejection", (e.reason && e.reason.message) || e.reason, e.reason && e.reason.stack));
  const orig = console.error;
  console.error = (...args) => {
    post("console.error", args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" "), args.find((a) => a instanceof Error)?.stack);
    orig.apply(console, args);
  };
  // Tell the workspace which route the preview is on (for the address bar).
  const route = () => window.parent.postMessage({ source: "lovable-diy-preview", kind: "route", url: location.pathname + location.search }, "*");
  for (const m of ["pushState", "replaceState"]) { const o = history[m]; history[m] = function (...a) { const r = o.apply(this, a); route(); return r; }; }
  window.addEventListener("popstate", route);
  route();
  // Thumbnail: when the workspace asks, render the page to a small JPEG in the browser.
  window.addEventListener("message", async (e) => {
    if (e.source !== window.parent || !e.data || e.data.source !== "lovable-diy-parent" || e.data.kind !== "capture") return;
    try {
      const { toJpeg } = await import("https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm");
      const w = document.documentElement.clientWidth, h = Math.round(w * 0.625);
      const bg = getComputedStyle(document.body).backgroundColor;
      const dataUrl = await toJpeg(document.body, { quality: 0.8, width: w, height: h, canvasWidth: 800, canvasHeight: 500, backgroundColor: bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#ffffff" });
      window.parent.postMessage({ source: "lovable-diy-preview", kind: "capture", id: e.data.id, dataUrl }, e.origin);
    } catch (err) {
      window.parent.postMessage({ source: "lovable-diy-preview", kind: "capture", id: e.data.id, error: String(err) }, e.origin);
    }
  });
})();
`;

export function lovableDiyErrorCapture(): Plugin {
  return {
    name: "lovable-diy-error-capture",
    apply: "serve",
    transformIndexHtml() {
      return [{ tag: "script", children: script, injectTo: "head-prepend" }];
    },
  };
}
