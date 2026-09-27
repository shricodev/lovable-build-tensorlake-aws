/** Tiny self-contained pages the gateway serves when there's nothing to proxy yet. */
const shell = (title: string, body: string, refreshSecs?: number) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${refreshSecs ? `<meta http-equiv="refresh" content="${refreshSecs}">` : ""}<title>${title}</title>
<style>
  :root { color-scheme: light dark; --bg:#fafafa; --fg:#171717; --muted:#737373; --border:#e5e5e5 }
  @media (prefers-color-scheme: dark) { :root { --bg:#0a0a0a; --fg:#fafafa; --muted:#a3a3a3; --border:#262626 } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font: 14px/1.5 ui-sans-serif, system-ui, sans-serif }
  .box { text-align:center; max-width:340px; padding:24px }
  h1 { font-size:15px; font-weight:600; margin:12px 0 4px }
  p { margin:0; color:var(--muted) }
  .spin { width:20px; height:20px; margin:auto; border:2px solid var(--border); border-top-color:var(--fg);
          border-radius:50%; animation:s 0.8s linear infinite }
  @keyframes s { to { transform: rotate(360deg) } }
</style></head><body><div class="box">${body}</div></body></html>`;

export const noPreviewPage = () =>
  shell(
    "No preview yet",
    `<h1>No preview yet</h1><p>Describe your app in the chat and it will show up here.</p>`,
  );

export const wakingPage = (detail = "Starting your app…") =>
  shell("Waking up", `<div class="spin"></div><h1>Waking up your app</h1><p>${detail}</p>`, 2);

export const notFoundPage = () =>
  shell("Not found", `<h1>Preview not found</h1><p>This project doesn't exist.</p>`);
