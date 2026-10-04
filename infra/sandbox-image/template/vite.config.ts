import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { lovableDiyErrorCapture } from "./lovable-diy/error-capture";

// Lovable DIY-managed config. The dev server must listen on 0.0.0.0:5173 and accept
// any Host header, because previews reach it through Lovable DIY's preview gateway.
export default defineConfig({
  plugins: [react(), tailwindcss(), lovableDiyErrorCapture()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "0.0.0.0", port: 5173, strictPort: true, allowedHosts: true },
});
