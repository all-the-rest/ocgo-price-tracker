// Funktionaler E2E-Test für die Plan-Umschaltung (`?plan=`) — bewusst NICHT in
// der assert-freien `ui-screenshots.spec.ts`: der generische Screenshot-Spec
// hält nur Pixels fest, dieser Test prüft echtes Verhalten.
//
// Vertrag:
//   - die plan-unabhängigen Tabellen (kostenlose Zen-Modelle, Datenschutz) sind
//     unter Go und Go Plus inhaltlich identisch;
//   - die plan-abhängige Preistabelle unterscheidet sich (der Umschalter wirkt);
//   - die Tabs spiegeln die URL, und `?plan=` bleibt neben anderen Params erhalten.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const EXPECTED_TITLE = "OpenCode Go Pricing & Models (2026) — Credit Multiplier & Request Costs";

async function gotoPlan(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page).toHaveTitle(EXPECTED_TITLE);
  await page.waitForTimeout(300);
}

/** Sichtbarer Text eines Abschnitts, Whitespace-normalisiert. */
const sectionText = (page: Page, id: string) =>
  page.locator(`#${id}`).evaluate((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());

test.describe("plan switch", () => {
  test("free + privacy tables are identical under go and go-plus", async ({ page }) => {
    await gotoPlan(page, "/?plan=go");
    const freeGo = await sectionText(page, "free-models");
    const privacyGo = await sectionText(page, "privacy");
    const pricesGo = await sectionText(page, "prices");

    await gotoPlan(page, "/?plan=go-plus");
    const freePlus = await sectionText(page, "free-models");
    const privacyPlus = await sectionText(page, "privacy");
    const pricesPlus = await sectionText(page, "prices");

    // Zen-Free-Modelle sind plan-unabhängig (in allen Abos nutzbar).
    expect(freePlus, "free-models table identical across plans").toBe(freeGo);
    expect(privacyPlus, "privacy table identical across plans").toBe(privacyGo);
    // Gegenprobe: die Preistabelle MUSS sich unterscheiden, sonst schaltet der
    // Plan nicht wirklich um (Nutzung/Badges/Faktor-Hinweis sind plan-abhängig).
    expect(pricesPlus, "price table differs per plan (plan switch works)").not.toBe(pricesGo);
  });

  test("plan tabs reflect the URL and keep other query params", async ({ page }) => {
    await gotoPlan(page, "/?plan=go-plus&basis=list");
    await expect(page.getByRole("tab", { name: "Go Plus" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Go", exact: true })).toHaveAttribute("aria-selected", "false");
    const url = new URL(page.url());
    expect(url.searchParams.get("plan"), "?plan= round-trips").toBe("go-plus");
    expect(url.searchParams.get("basis"), "other params survive the plan switch").toBe("list");
  });
});
