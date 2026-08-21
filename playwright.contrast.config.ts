// Playwright config for the color-contrast matrix test.
//
// Separate from the functional E2E suite AND from the ui-review screenshot set:
// this one ASSERTS WCAG contrast for every daisyUI semantic badge/alert color in
// both light and dark themes. Runs against the dev server (reuses it if already
// up). `pnpm test:contrast` runs it.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/contrast",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5175",
    trace: "off",
  },
  webServer: {
    command: "pnpm dev --port 5175 --strictPort",
    url: "http://localhost:5175",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
