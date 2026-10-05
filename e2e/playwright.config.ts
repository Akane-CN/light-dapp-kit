import { defineConfig } from "@playwright/test";
import path from "node:path";

// Playwright resolves webServer.cwd relative to this file; point it at the repo root.
const repoRoot = path.resolve(__dirname, "..");
export default defineConfig({
  testDir: ".",
  timeout: 10 * 60 * 1000,
  retries: 0,
  use: { baseURL: "http://localhost:4173", headless: true },
  webServer: {
    cwd: repoRoot,
    command: "bun run --cwd apps/light-wallet build && bun run --cwd apps/light-wallet preview --port 4173",
    url: "http://localhost:4173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
