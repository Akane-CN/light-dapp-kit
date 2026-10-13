import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * ckb-light-client-js uses SharedArrayBuffer, which requires a cross-origin-isolated page.
 *
 * - Chromium 137+: `Document-Isolation-Policy` isolates the document without COOP, so
 *   popup-based wallets (JoyID) keep `window.opener` and can report back.
 * - Other browsers: fall back to COOP + COEP. That isolates too, but severs the opener of
 *   cross-origin popups, so popup-based wallets cannot connect there (extension wallets work).
 */
function isolationHeaders(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const chrome = /Chrome\/(\d+)/.exec(String(req.headers["user-agent"] ?? ""));
    if (chrome && Number(chrome[1]) >= 137) {
      res.setHeader("Document-Isolation-Policy", "isolate-and-require-corp");
    } else {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    }
    next();
  };
  return {
    name: "isolation-headers",
    configureServer: (server) => { server.middlewares.use(handler); },
    configurePreviewServer: (server) => { server.middlewares.use(handler); },
  };
}

export default defineConfig({
  plugins: [react(), isolationHeaders()],
  base: "./",
  optimizeDeps: { exclude: ["ckb-light-client-js"] },
  worker: { format: "es" },
});
