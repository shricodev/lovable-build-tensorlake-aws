import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { kilnErrorCapture } from "./kiln/error-capture";

// Kiln-managed config. The dev server must listen on 0.0.0.0:5173 and accept
// any Host header, because previews reach it through Kiln's preview gateway.
export default defineConfig({
  plugins: [react(), tailwindcss(), kilnErrorCapture()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "0.0.0.0", port: 5173, strictPort: true, allowedHosts: true },
});
