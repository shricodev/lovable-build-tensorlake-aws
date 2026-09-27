import WebSocket from "ws";
const pid = process.argv[2];
const html = await (await fetch(`http://${pid}.preview.localhost:4000/@vite/client`)).text();
const token = /const wsToken = "([^"]+)"/.exec(html)?.[1] ?? "";
const ws = new WebSocket(`ws://${pid}.preview.localhost:4000/?token=${token}`, "vite-hmr", {
  headers: { origin: `http://${pid}.preview.localhost:4000` },
});
let n = 0;
ws.on("message", (m) => {
  const d = JSON.parse(String(m));
  if (d.type !== "connected" && d.type !== "ping") {
    n++;
    console.log("HMR", d.type, (d.updates ?? []).map((u) => u.path).join(","));
  }
});
setTimeout(
  () => {
    console.log(`HMR total ${n}`);
    process.exit(0);
  },
  Number(process.argv[3] ?? 240000),
);
