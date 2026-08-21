// Generic manifest-driven screenshot spec for the ui-review skill.
//
// Static Single-Page-Website: kein Auth, keine Seeds, keine UI-Navigation —
// jede Route wird per Direkt-URL geladen (gerechtfertigt: keine Navigations-
// Pfade, die durchgeklickt werden müssten).
//
// SECTION-CAPTURES: Full-Page-PNGs werden für den Vision-Model auf ~2000 px
// herunterskaliert — bei langen Seiten sind Bereiche unterhalb des Folds dann
// unlesbar (Regression: abgeschnittenes Badge in der Datenschutz-Tabelle unten).
// Deshalb wird die gesamte Seite zusätzlich in Viewport-Höhen-Sektionen erfasst
// (Scroll-Schritte à 80 % der Viewport-Höhe → 20 % Überlappung, kein Lücke).
//
// Alle Tests sind getaggt, damit die Gruppe klar von funktionalen E2E-Tests
// getrennt bleibt. Diese Spec assertiert NICHTS — sie hält nur Pixels fest.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import process from "node:process";
import { routes, uiReviewConfig } from "./ui-review.config";
import type { UiReviewState, UiReviewViewport } from "./ui-review.config";

const out = (state: UiReviewState, viewport: UiReviewViewport, file: string) =>
  path.resolve(process.cwd(), uiReviewConfig.outputDir, state, viewport, file);

function viewportForProject(projectName: string): UiReviewViewport {
  return projectName === "Mobile Chrome" ? "mobile" : "desktop";
}

async function waitForAppSettled(page: Page, expectedTitle: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main")).toBeVisible();
  // Guard: stellt sicher, dass wirklich diese App gerendert wird und nicht ein
  // fremder Dev-Server, der zufällig den Port belegt (verhindert stille Fehl-Captures).
  await expect(page).toHaveTitle(expectedTitle);
  await page.waitForTimeout(300);
}

/** Erfasst die ganze Seite in lesbaren Viewport-Höhen-Sektionen (80 % Schritt). */
async function captureSections(
  page: Page,
  state: UiReviewState,
  viewport: UiReviewViewport,
  name: string,
): Promise<void> {
  const step = await page.evaluate(() => Math.round(window.innerHeight * 0.8));
  const max = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
  let y = 0;
  let i = 0;
  for (;;) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(150);
    await page.screenshot({ path: out(state, viewport, `${name}-sec${i}.png`), fullPage: false });
    if (y >= max) break;
    i += 1;
    y = Math.min(max, y + step);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const route of routes) {
  for (const state of route.states) {
    for (const viewport of route.viewports ?? ["desktop", "mobile"]) {
      test(`screenshot ${route.name} (${state}, ${viewport})`, { tag: ["@screenshot"] }, async ({ page }, testInfo) => {
        test.skip(
          viewportForProject(testInfo.project.name) !== viewport,
          `project ${testInfo.project.name} renders the ${viewportForProject(testInfo.project.name)} viewport`,
        );
        await page.goto(route.path);
        await waitForAppSettled(page, route.expectedTitle);
        // page.screenshot resolves relative paths against process.cwd(), not
        // the config outputDir — build the absolute path explicitly.
        await page.screenshot({ path: out(state, viewport, `${route.name}.png`), fullPage: true });
        await captureSections(page, state, viewport, route.name);
        // Focused, element-scoped captures for "notice areas" (Hinweis-Bereiche)
        // — e.g. the privacy table or the changelog — so the vision review can
        // judge them at readable resolution without full-page downscaling.
        for (const sel of route.elements ?? []) {
          const slug = sel.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
          const locator = page.locator(sel);
          if ((await locator.count()) > 0) {
            await locator.first().screenshot({
              path: out(state, viewport, `${route.name}-${slug}.png`),
            });
          }
        }
      });
    }
  }
}
