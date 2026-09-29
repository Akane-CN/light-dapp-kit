import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ckb-light-client-js uses SharedArrayBuffer, which requires a cross-origin-isolated page.
const coi = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { headers: coi },
  preview: { headers: coi },
  optimizeDeps: { exclude: ["ckb-light-client-js"] },
  worker: { format: "es" },
});
