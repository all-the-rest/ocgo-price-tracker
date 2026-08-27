// Interaction screenshot spec — Mobile Chrome, home route.
//
// Ergänzt die rein manifest-getriebenen `ui-screenshots.spec.ts` (die nur Pixels
// festhält und NICHTS assertiert) um echte Überlauf-Guards für die beiden
// UI-Fixes aus diesem Task:
//   1. Hamburger ganz links → Menü darf nicht über den Viewport-Rand hinausragen
//      (Regression: `dropdown-end` öffnete links von navbar-end nach außen).
//   2. Tooltip auf Tap → Bubble (im Portal, position:fixed) muss vollständig im
//      Viewport liegen (fängt Clip in `overflow-x-auto`).
//
// Die Pixels werden trotzdem festgehalten (Harness ist pixel-only by design),
// aber die Überlauf-Checks oben sind echte `expect`s — der Test wird ROT, wenn
// das Menü/die Bubble am Rand abgeschnitten wird. Getaggt mit `@screenshot`, damit
// die Gruppe klar von funktionalen E2E-Tests getrennt bleibt.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import process from "node:process";
import { readFileSync } from "node:fs";
import { fmtContextWindow } from "../../src/util";

const EXPECTED_TITLE = "Price Tracking for OpenCode Go";
const OUT_DIR = path.resolve(process.cwd(), "test-results", "ui-screenshots", "interactions");

function viewportForProject(projectName: string): "mobile" | "desktop" {
  return projectName === "Mobile Chrome" ? "mobile" : "desktop";
}

async function waitForAppSettled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page).toHaveTitle(EXPECTED_TITLE);
  await page.waitForTimeout(300);
}

/** Liefert die Viewport-Geometrie; wirft nicht, falls keine (headless).

 * immer gesetzt, da beide Projects explizite viewports deklarieren. */
function vp(page: Page) {
  const v = page.viewportSize();
  if (!v) throw new Error("viewportSize unavailable");
  return v;
}

test.describe("mobile interactions", { tag: ["@screenshot"] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForAppSettled(page);
  });

  test("far-left burger opens on-screen menu (no horizontal overflow)", async ({ page }, testInfo) => {
    test.skip(
      viewportForProject(testInfo.project.name) !== "mobile",
      `project ${testInfo.project.name} renders the ${viewportForProject(testInfo.project.name)} viewport`,
    );

    // Burger-Trigger: erstes [role="button"] im mobilen Dropdown (dropdown-start).
    const trigger = page.locator('header .dropdown.dropdown-start [role="button"]').first();
    await expect(trigger).toBeVisible();

    const tb = await trigger.boundingBox();
    expect(tb, "trigger boundingBox").not.toBeNull();
    // Far-left: der Burger muss im linken Randbereich sitzen (≤ 64 px).
    expect(tb!.x, "burger trigger x within far-left zone").toBeLessThanOrEqual(64);

    // Menü öffnen (Tap/Focus → daisyUI :focus-within zeigt .dropdown-content).
    await trigger.click();
    const menu = page.locator("header ul.menu.dropdown-content").first();
    await expect(menu, "open menu is visible").toBeVisible();

    const mb = await menu.boundingBox();
    expect(mb, "menu boundingBox").not.toBeNull();
    const { width: vw, height: vh } = vp(page);

    // Überlauf-Guards — ROT bei Regression (Menü außerhalb des Viewports).
    expect(mb!.x, "menu left >= 0").toBeGreaterThanOrEqual(0);
    expect(mb!.y, "menu top >= 0").toBeGreaterThanOrEqual(0);
    expect(mb!.x + mb!.width, "menu right <= viewport width").toBeLessThanOrEqual(vw);
    expect(mb!.y + mb!.height, "menu bottom <= viewport height").toBeLessThanOrEqual(vh);

    // Pixels festhalten (Harness ist pixel-only by design) — element-scoped.
    await menu.screenshot({ path: path.join(OUT_DIR, "mobile-burger-menu.png") });
    await page.locator("header").screenshot({ path: path.join(OUT_DIR, "mobile-header.png") });
  });

  test("tooltip shows within viewport on tap (no clipping in overflow-x-auto)", async ({ page }, testInfo) => {
    test.skip(
      viewportForProject(testInfo.project.name) !== "mobile",
      `project ${testInfo.project.name} renders the ${viewportForProject(testInfo.project.name)} viewport`,
    );

    // Tooltip-Host: erstes [data-tooltip-host] im Tabellen-Body (nicht in einem
    // Button, damit der Klick nicht versehentlich sortiert). Die Bubble hat
    // `role="tooltip"` nur, während sie angezeigt wird.
    const host = page.locator("tbody [data-tooltip-host]").first();
    await expect(host, "tooltip host visible").toBeVisible();

    // Tap toggelt den Pinned-State → Bubble wird gerendert.
    await host.click();
    const bubble = page.getByRole("tooltip");
    await expect(bubble, "tooltip bubble visible").toBeVisible();

    const bb = await bubble.boundingBox();
    expect(bb, "bubble boundingBox").not.toBeNull();
    const { width: vw, height: vh } = vp(page);

    // Überlauf-Guard — ROT bei Regression (Bubble am Rand abgeschnitten).
    expect(bb!.x, "bubble left >= 0").toBeGreaterThanOrEqual(0);
    expect(bb!.y, "bubble top >= 0").toBeGreaterThanOrEqual(0);
    expect(bb!.x + bb!.width, "bubble right <= viewport width").toBeLessThanOrEqual(vw);
    expect(bb!.y + bb!.height, "bubble bottom <= viewport height").toBeLessThanOrEqual(vh);

    // Pixels festhalten (element-scoped).
    await bubble.screenshot({ path: path.join(OUT_DIR, "mobile-tooltip-bubble.png") });
  });

  test("model cell shows 'provider · context window'", async ({ page }, testInfo) => {
    // Läuft in beiden Projekten (Desktop + Mobile) — die Darstellung ist identisch.
    const proj = testInfo.project.name.replace(/\s+/g, "-").toLowerCase();
    await page.goto("/");
    await waitForAppSettled(page);

    // Erwartete "others"-Zeile aus den echten Scrape-Daten ableiten (provider · NNN tokens).
    const data = JSON.parse(readFileSync(path.resolve(process.cwd(), "data/latest.json"), "utf8"));
    const m = data.models.find((x: { provider: string | null; contextWindow: number | null }) => x.provider && x.contextWindow != null);
    expect(m, "a model with provider + contextWindow in latest.json").toBeTruthy();
    const expected = `${m.provider} · ${fmtContextWindow(m.contextWindow)} ${m.contextWindow != null ? "tokens" : ""}`.trim();

    // Zeile finden, deren Namens-Zelle die erwartete Zeile enthält.
    const rows = page.locator("tbody tr");
    const n = await rows.count();
    let matched = false;
    for (let i = 0; i < n; i++) {
      const txt = (await rows.nth(i).locator("th").first().textContent()) ?? "";
      if (txt.includes(expected)) {
        matched = true;
        await rows.nth(i).locator("th").first().screenshot({ path: path.join(OUT_DIR, `provider-cell-${proj}.png`) });
        break;
      }
    }
    expect(matched, `model cell contains "${expected}"`).toBe(true);
  });

  test("peak indicator icon and tier text are vertically centered", async ({ page }, testInfo) => {
    // Läuft in beiden Projekten (Desktop + Mobile).
    const proj = testInfo.project.name.replace(/\s+/g, "-").toLowerCase();
    await page.goto("/");
    await waitForAppSettled(page);

    const icon = page.locator('tbody span[class*="material-symbols--schedule"]').first();
    await expect(icon, "peak indicator icon present").toBeVisible();
    const host = icon.locator("xpath=parent::span");
    await host.screenshot({ path: path.join(OUT_DIR, `peak-indicator-${proj}.png`) });

    const ib = await icon.boundingBox();
    const text = icon.locator("xpath=following-sibling::span[1]");
    const tb = await text.boundingBox();
    expect(ib, "icon boundingBox").not.toBeNull();
    expect(tb, "tier text boundingBox").not.toBeNull();
    // Vertikale Zentrierung: Icon-Mitte ≈ Text-Mitte (±2px Toleranz).
    const centerDiff = Math.abs(ib!.y + ib!.height / 2 - (tb!.y + tb!.height / 2));
    expect(centerDiff, "icon and tier text share vertical center").toBeLessThanOrEqual(2);
  });
});
