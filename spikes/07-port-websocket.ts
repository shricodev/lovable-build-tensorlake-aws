/**
 * Spike 07: WebSocket through an exposed port (Vite HMR depends on this),
 * authenticated with a Bearer header the way the Preview Gateway will do it.
 */
import { Sandbox } from "tensorlake";
import WebSocket from "ws";
import { enc, spike, uniq } from "./lib.js";

const s = spike("07-port-websocket");

// Dependency-free WS echo server (RFC 6455 handshake + small text frames).
const echo = `
const http = require("http"), crypto = require("crypto");
const srv = http.createServer((q, r) => r.end("ok"));
srv.on("upgrade", (req, sock) => {
  const key = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + key + "\\r\\n\\r\\n");
  sock.on("data", (b) => {
    const len = b[1] & 127, mask = b.subarray(2, 6), data = Buffer.from(b.subarray(6, 6 + len)).map((x, i) => x ^ mask[i % 4]);
    const msg = Buffer.from("echo:" + data.toString());
    sock.write(Buffer.concat([Buffer.from([0x81, msg.length]), msg]));
  });
});
srv.listen(8081);
`;

await s.run(async () => {
  const sb = s.track(
    (await s.step("create", () => Sandbox.create({ name: uniq("kiln-spike07"), timeoutSecs: 300 })))!,
  );
  await sb.writeFile("/home/tl-user/echo.js", enc.encode(echo));
  await sb.startProcess("node", { args: ["/home/tl-user/echo.js"], name: "echo" });
  const info = await sb.update({ exposedPorts: [8081] });
  const wsUrl = `wss://8081-${new URL(info.sandboxUrl!).host}/hmr`;
  await new Promise((r) => setTimeout(r, 1000));

  const reply = await s.step(
    "WS connect with Bearer + echo round trip",
    () =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(wsUrl, {
          headers: { authorization: `Bearer ${process.env.TENSORLAKE_API_KEY}` },
        });
        const t = setTimeout(() => reject(new Error("ws timeout")), 15_000);
        ws.on("open", () => ws.send("ping"));
        ws.on("message", (m) => {
          clearTimeout(t);
          ws.close();
          resolve(m.toString());
        });
        ws.on("error", reject);
        ws.on("unexpected-response", (_req, res) => reject(new Error(`unexpected HTTP ${res.statusCode}`)));
      }),
  );
  s.note("wsEcho", reply);

  const noAuth = await s.step(
    "WS connect without auth is refused",
    () =>
      new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.on("open", () => reject(new Error("opened without auth!")));
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("error", () => resolve(-1));
      }),
  );
  s.note("wsNoAuthStatus", noAuth);
});
