// Playwright config for the UI-review screenshot set.
//
// Deliberately SEPARATE from any functional E2E suite: this set only captures
// screenshots and never asserts behavior. Screenshots land under
// `test-results/ui-screenshots/<state>/<viewport>/<name>.png`.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/screenshots",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 2,
  timeout: 120000,
  reporter: [["html", { open: "never", outputFolder: "playwright-report/ui-screenshots" }]],
  use: {
    baseURL: "http://localhost:5175",
    trace: "off",
    video: "off",
  },
  webServer: {
    command: "pnpm dev --port 5175 --strictPort",
    url: "http://localhost:5175",
    reuseExistingServer: true,
    timeout: 120000,
  },
  outputDir: "test-results/ui-screenshots",
  projects: [
    { name: "Desktop Chrome", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 950 } } },
    { name: "Mobile Chrome", use: { ...devices["Galaxy A55"] } },
  ],
});
