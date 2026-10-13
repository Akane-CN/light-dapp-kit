import { defineConfig } from "@playwright/test";
import path from "node:path";

// Playwright resolves webServer.cwd relative to this file; point it at the repo root.
const repoRoot = path.resolve(__dirname, "..");
export default defineConfig({
  testDir: ".",
  outputDir: "./test-results",
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  timeout: 10 * 60 * 1000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
    // Point at a pre-installed Chromium instead of Playwright's own download (optional).
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    cwd: repoRoot,
    env: { ...process.env, VITE_ALLOW_TEST_SIGNER: "1" },
    command: "bun run --cwd apps/light-wallet build && bun run --cwd apps/light-wallet preview --port 4173",
    url: "http://localhost:4173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
