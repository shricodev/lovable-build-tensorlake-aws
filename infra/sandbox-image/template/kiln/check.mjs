/**
 * Kiln smoke check: render the app once in a DOM shim (happy-dom) and report
 * thrown errors, console.error calls, and whether anything rendered.
 * Much cheaper than a headless browser; catches the usual runtime breakage
 * (bad imports, undefined access during render, hook misuse).
 *
 * Prints one JSON line: { ok, rendered, errors[] }. Always exits 0.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createServer } from "vite";

const errors = [];
const server = await createServer({
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

GlobalRegistrator.register({ url: "http://localhost:5173/", width: 1280, height: 800 });
document.body.innerHTML = '<div id="root"></div>';
// Keep stdout for the single JSON result line.
console.log = console.info = console.warn = (...args) => process.stderr.write(args.join(" ") + "\n");
const origError = console.error;
console.error = (...args) =>
  errors.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" "));
window.addEventListener("error", (e) => errors.push(String(e.error?.stack ?? e.message)));
process.on("unhandledRejection", (e) => errors.push(`Unhandled rejection: ${e?.stack ?? e}`));
process.on("uncaughtException", (e) => errors.push(`Uncaught: ${e?.stack ?? e}`));

try {
  await server.ssrLoadModule("/src/main.tsx");
  await new Promise((r) => setTimeout(r, 1500)); // let React commit and effects run
} catch (e) {
  errors.push(String(e?.stack ?? e));
}

const rendered = (document.getElementById("root")?.innerHTML.trim().length ?? 0) > 0;
console.error = origError;
await server.close().catch(() => {});
await GlobalRegistrator.unregister().catch(() => {});
process.stdout.write(
  JSON.stringify({ ok: rendered && errors.length === 0, rendered, errors: errors.slice(0, 20) }) + "\n",
);
process.exit(0);
