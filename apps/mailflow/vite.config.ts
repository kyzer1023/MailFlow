import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Keep the client artifact path stable for local checks and handoff tooling.
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [react(), cloudflare()],
});
