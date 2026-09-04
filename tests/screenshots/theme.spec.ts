// Theme behavior: first load follows the OS (no localStorage write),
// the toggle always persists and switches dark/light.
// Run via `pnpm test:screenshots` (dev server auto-starts).
import { expect, test } from "@playwright/test";
import path from "node:path";
import process from "node:process";
import { uiReviewConfig } from "./ui-review.config";

const out = (viewport: string, file: string) =>
  path.resolve(process.cwd(), uiReviewConfig.outputDir, "filled", viewport, file);

const THEME_TOGGLE = "input.theme-controller";
const EXPECTED_TITLE = "Price Tracking for OpenCode Go";

async function loadWithEmptyStorage(
  page: import("@playwright/test").Page,
  colorScheme: "dark" | "light",
) {
  await page.emulateMedia({ colorScheme });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page).toHaveTitle(EXPECTED_TITLE);
  // Ensure a true first load: no stored theme, then reload so the app
  // boots with empty localStorage under the emulated OS theme.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main")).toBeVisible();
}

test.describe("theme toggle", { tag: ["@screenshot"] }, () => {
  test("first load follows system dark without writing localStorage", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "Desktop Chrome", "desktop-only theme check");
    await loadWithEmptyStorage(page, "dark");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    await expect(page.locator(THEME_TOGGLE)).toBeChecked();
    await page.screenshot({ path: out("desktop", "theme-system-dark.png"), fullPage: false });
  });

  test("first load follows system light without writing localStorage", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "Desktop Chrome", "desktop-only theme check");
    await loadWithEmptyStorage(page, "light");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();
    await expect(page.locator(THEME_TOGGLE)).not.toBeChecked();
    await page.screenshot({ path: out("desktop", "theme-system-light.png"), fullPage: false });
  });

  test("toggle persists to localStorage and switches dark/light", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "Desktop Chrome", "desktop-only theme check");
    await loadWithEmptyStorage(page, "light");

    const toggle = page.locator(THEME_TOGGLE);
    const toggleLabel = page.locator("label.swap").first();
    await expect(toggle).not.toBeChecked();

    // Light -> dark: persists "dark" and applies data-theme.
    // NOTE: click the wrapping label — the swap SVGs overlay the checkbox
    // input and intercept pointer events on a direct input click.
    await toggleLabel.click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    await expect(toggle).toBeChecked();
    await page.screenshot({ path: out("desktop", "theme-toggled-dark.png"), fullPage: false });

    // Dark -> light: persists "light" and removes data-theme.
    await toggleLabel.click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();
    await expect(toggle).not.toBeChecked();
    await page.screenshot({ path: out("desktop", "theme-toggled-light.png"), fullPage: false });

    // Reload persists the explicit light choice (even though the OS is light,
    // the value must now be stored).
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("main")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
    await expect(page.locator(THEME_TOGGLE)).not.toBeChecked();

    // And back to dark persists across reload too.
    await page.locator("label.swap").first().click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("main")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    await expect(page.locator(THEME_TOGGLE)).toBeChecked();
  });
});
