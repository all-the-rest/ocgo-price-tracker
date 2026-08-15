// Generic manifest-driven screenshot spec for the ui-review skill.
//
// Static Single-Page-Website: kein Auth, keine Seeds, keine UI-Navigation —
// jede Route wird per Direkt-URL geladen (gerechtfertigt: keine Navigations-
// Pfade, die durchgeklickt werden müssten) und als Full-Page-PNG gespeichert.
//
// Alle Tests sind getaggt, damit die Gruppe klar von funktionalen E2E-Tests
// getrennt bleibt. Diese Spec assertiert NICHTS — sie hält nur Pixels fest.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import process from "node:process";
import { routes, uiReviewConfig } from "./ui-review.config";
import type { UiReviewRoute, UiReviewState, UiReviewViewport } from "./ui-review.config";

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
        const file = path.resolve(process.cwd(), uiReviewConfig.outputDir, state, viewport, `${route.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
      });
    }
  }
}
