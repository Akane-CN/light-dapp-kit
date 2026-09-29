import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  timeout: 10 * 60 * 1000,
  retries: 0,
  use: { baseURL: "http://localhost:4173", headless: true },
  webServer: {
    command: "bun run --cwd apps/light-wallet build && bun run --cwd apps/light-wallet preview --port 4173",
    url: "http://localhost:4173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
