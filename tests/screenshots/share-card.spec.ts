// Share-card screenshot + overflow-guard spec (permanent, per AGENTS.md).
//
// Covers all four size variants (OG/Twitter/IG 4:5/Story 9:16) in both dialog
// languages and both card themes, plus the mobile dialog. TopN is automatic
// per preset (OG/Twitter Top 5, IG Top 10, Story Top 15) — no TopN control.
// Card rows show rank + name + total requests only (no prices, no basis
// selector). In the spirit of `interactions.spec.ts` every capture carries
// real `expect`s so the suite goes RED on regression:
//   - exactly the four size presets exist (no square/wide) with the labels
//     from `SHARE_SIZES` (single source of truth, imported from src);
//   - no TopN dropdown, no price-basis UI, no `$` anywhere on the card;
//   - portrait sizes show their automatic TopN (IG Top 10, Story Top 15)
//     with per-row constraint lines
//     constraint lines (Peak-/Off-Peak badge + peak-hours window, max one
//     line per row) and a compact constraints block (peak/off-peak rules +
//     domain + date);
//   - landscape sizes (og/twitter) always show the automatic Top 5 without
//     constraints;
//   - every card's rows + footer fit inside its SVG height;
//   - name and value texts never overlap (readability, measured in CSS px
//     on the scaled preview);
//   - the footer shows the site domain LEFT and the last-update date+time
//     RIGHT, bottom-anchored on every preset;
//   - legacy `?shareSize=square|wide` / `?metric=cost|input|output` / `?topN=`
//     / `?basis=` links are tolerated (ignored or coerced to the card);
//   - on mobile the dialog stays within the viewport width.
//
// Run via `pnpm test:screenshots` (dev server auto-starts on :5177;
// :5175 belongs to the sibling project's dev server, see config).
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import process from "node:process";
import { SHARE_SIZES, SHARE_TOP_N, autoTopN } from "../../src/share";

const EXPECTED_TITLE = "Price Tracking for OpenCode Go";
const OUT_DIR = path.resolve(process.cwd(), "test-results", "ui-screenshots", "share-card");
const SITE = "ocgo-pricing.all-the.rest";

type ShareLangName = "DE" | "EN";
type CardTheme = "dark" | "light";

const SIZE_KEYS = Object.keys(SHARE_SIZES).sort();

function isDesktop(projectName: string): boolean {
  return projectName !== "Mobile Chrome";
}

function isPortraitSize(key: string): boolean {
  return key === "ig" || key === "story";
}

/** Automatic TopN per preset (single source of truth in src). */
function topNForSize(key: string): string {
  return String(autoTopN(key as keyof typeof SHARE_SIZES));
}

async function openShareDialog(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page).toHaveTitle(EXPECTED_TITLE);
  const dlg = page.locator("#share_modal");
  // Deep links with #share auto-open the dialog on mount — don't re-click
  // the trigger then (the open modal backdrop would intercept the click).
  await page.waitForTimeout(400);
  if (await dlg.isVisible().catch(() => false)) return;
  // Heading-row trigger (label is "Share"/"Teilen" depending on page lang).
  await page.locator('#prices button[aria-haspopup="dialog"]').click();
  await dlg.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(300);
}

async function closeShareDialog(page: Page): Promise<void> {
  const dlg = page.locator("#share_modal");
  if (await dlg.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "hidden", timeout: 5000 });
  }
}

/**
 * Preview-fit guard: the preview image is contain-fit into 55vh, the dialog
 * box stays inside the viewport, and the actions live inside the dialog box
 * (reachable without page scroll — at most via dialog-internal scroll).
 */
async function expectDialogFitsViewport(page: Page): Promise<void> {
  const vw = page.viewportSize();
  if (!vw) throw new Error("viewportSize unavailable");
  const box = page.locator("#share_modal .modal-box");
  const bb = await box.boundingBox();
  expect(bb, "dialog boundingBox").not.toBeNull();
  expect(bb!.x, "dialog left >= 0").toBeGreaterThanOrEqual(-1);
  expect(bb!.y, "dialog top >= 0").toBeGreaterThanOrEqual(-1);
  expect(bb!.x + bb!.width, "dialog right <= viewport width").toBeLessThanOrEqual(vw.width + 1);
  expect(bb!.y + bb!.height, "dialog bottom <= viewport height").toBeLessThanOrEqual(vw.height + 1);
  const preview = page.locator("#share-preview");
  const pb = await preview.boundingBox();
  expect(pb, "preview boundingBox").not.toBeNull();
  expect(pb!.height, "preview <= 55vh").toBeLessThanOrEqual(vw.height * 0.55 + 2);
  const svgBox = await preview.locator("svg").boundingBox();
  expect(svgBox, "preview svg boundingBox").not.toBeNull();
  expect(svgBox!.height, "svg scales down to the preview bound").toBeLessThanOrEqual(pb!.height + 1);
  expect(svgBox!.height, "svg <= 55vh").toBeLessThanOrEqual(vw.height * 0.55 + 2);
  const actions = page.locator("#share_modal .modal-action");
  const ab = await actions.boundingBox();
  expect(ab, "actions boundingBox").not.toBeNull();
  expect(ab!.y, "actions inside dialog (top)").toBeGreaterThanOrEqual(bb!.y - 1);
  // Actions reachable without page scroll: either fully laid out inside the
  // box, or reachable via dialog-internal scroll (tall stacks on mobile).
  if (ab!.y + ab!.height > bb!.y + bb!.height + 1) {
    const scrollable = await box.evaluate(
      (el) =>
        (getComputedStyle(el).overflowY === "auto" || getComputedStyle(el).overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 1,
    );
    expect(scrollable, "dialog scrolls internally when actions are below the fold").toBe(true);
    // Reaching the actions must not move the page (the trigger click may
    // have scrolled it earlier — only the delta while revealing counts).
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await actions.scrollIntoViewIfNeeded();
    const ab2 = await actions.boundingBox();
    expect(ab2!.y + ab2!.height, "actions visible after dialog-internal scroll").toBeLessThanOrEqual(
      vw.height + 1,
    );
    expect(await page.evaluate(() => window.scrollY), "no page scroll needed").toBe(scrollBefore);
  }
}

async function configureCard(
  page: Page,
  opts: { shareLang: ShareLangName; theme: CardTheme; size: string },
): Promise<void> {
  const dlg = page.locator("#share_modal");
  // Language control is the first fieldset (DE/EN buttons; theme buttons are
  // Dunkel/Hell/Dark/Light, so the exact name is unambiguous in the dialog).
  await dlg.getByRole("button", { name: opts.shareLang, exact: true }).click();
  const themeName =
    opts.shareLang === "DE" ? (opts.theme === "dark" ? "Dunkel" : "Hell") : opts.theme === "dark" ? "Dark" : "Light";
  await dlg.getByRole("button", { name: themeName, exact: true }).click();
  await page.locator("#share-size").selectOption(opts.size);
  await page.waitForTimeout(250);
}

interface CardGeometry {
  w: number;
  h: number;
  rows: number;
  maxRowBottom: number;
  maxTextY: number;
  maxOverlap: number;
  footerHasSite: boolean;
  footerLeft: { x: number; text: string };
  footerRight: { x: number; anchor: string; text: string };
  constraintLines: number;
  maxConstraintsPerRow: number;
  maxConstraintWidth: number;
  hasConstraintsBlock: boolean;
  blockHasRules: boolean;
  blockWidth: number;
  /** No prices on the card: rows = rank + name + total requests only. */
  hasDollar: boolean;
}

async function cardGeometry(page: Page): Promise<CardGeometry> {
  return page.locator("#share_modal .modal-box svg").evaluate((svg, site) => {
    const rows = [...svg.querySelectorAll(':scope > g[data-row]')];
    const rowBottoms = rows.map((g) => {
      const r = g.querySelector("rect");
      if (!r) throw new Error("row without rect");
      return Number(r.getAttribute("y")) + Number(r.getAttribute("height"));
    });
    const textYs = [...svg.querySelectorAll("text")].map((t) => Number(t.getAttribute("y")));
    const overlaps = rows.map((g) => {
      const ts = g.querySelectorAll("text");
      const nameRect = ts[1].getBoundingClientRect();
      const valueRect = ts[2].getBoundingClientRect();
      return nameRect.right - valueRect.left;
    });
    const constraintWidths = [...svg.querySelectorAll('[data-constraint="1"]')].map((t) =>
      (t as SVGGraphicsElement).getBBox().width,
    );
    const block = svg.querySelector(":scope > g[data-constraints]");
    const blockText = block?.textContent ?? "";
    const blockWidth = block ? (block as SVGGraphicsElement).getBBox().width : 0;
    const fl = svg.querySelector('[data-footer-left="1"]');
    const fr = svg.querySelector('[data-footer-right="1"]');
    return {
      w: Number(svg.getAttribute("width")),
      h: Number(svg.getAttribute("height")),
      rows: rows.length,
      maxRowBottom: Math.max(...rowBottoms),
      maxTextY: Math.max(...textYs),
      maxOverlap: Math.max(...overlaps),
      footerHasSite: [...svg.querySelectorAll("text")].some((t) => (t.textContent ?? "").includes(site)),
      footerLeft: { x: Number(fl?.getAttribute("x")), text: fl?.textContent ?? "" },
      footerRight: {
        x: Number(fr?.getAttribute("x")),
        anchor: fr?.getAttribute("text-anchor") ?? "start",
        text: fr?.textContent ?? "",
      },
      constraintLines: svg.querySelectorAll('[data-constraint="1"]').length,
      maxConstraintsPerRow: Math.max(0, ...rows.map((g) => g.querySelectorAll('[data-constraint="1"]').length)),
      maxConstraintWidth: Math.max(0, ...constraintWidths),
      hasConstraintsBlock: block !== null,
      blockHasRules: /Peak|peak|Off-Peak|off-peak/.test(blockText) && blockText.includes(site),
      blockWidth,
      hasDollar: /\$/.test(svg.textContent ?? ""),
    };
  }, SITE);
}

function expectCardFits(geo: CardGeometry, sizeKey: string, topN: string): void {
  const size = SHARE_SIZES[sizeKey as keyof typeof SHARE_SIZES];
  expect(geo.w, "svg width matches preset").toBe(size.w);
  expect(geo.h, "svg height matches preset").toBe(size.h);
  expect(geo.rows, "row count matches topN").toBe(Number(topN));
  expect(geo.maxRowBottom, "last row inside card height").toBeLessThanOrEqual(size.h);
  expect(geo.maxTextY, "footer text inside card height").toBeLessThanOrEqual(size.h);
  expect(geo.maxOverlap, "name/value texts do not overlap").toBeLessThanOrEqual(2);
  expect(geo.hasDollar, "no prices on the card (rank + name + requests only)").toBe(false);
  // Unified footer: LEFT = site domain, RIGHT = localized last-update
  // date+time (fetchedAt has intraday runs, so the time is required).
  expect(geo.footerLeft.x, "footer domain left-aligned").toBe(56);
  expect(geo.footerLeft.text, "footer left shows domain").toContain(SITE);
  expect(geo.footerRight.x, "footer date right-aligned").toBe(size.w - 56);
  expect(geo.footerRight.anchor, "footer date anchored end").toBe("end");
  expect(geo.footerRight.text, "footer right shows localized time").toMatch(/\d{1,2}:\d{2}/);
  expect(geo.footerRight.text, "footer right marks UTC").toMatch(/UTC/);
  // Footer bottom-anchored on every preset/TopN: last text sits at the card
  // bottom, never floating in the middle after a small TopN.
  expect(geo.maxTextY, "footer bottom-anchored").toBeGreaterThan(size.h - 100);
  expect(geo.maxConstraintsPerRow, "max one constraint line per row").toBeLessThanOrEqual(1);
  expect(geo.maxConstraintWidth, "constraint line fits card width").toBeLessThanOrEqual(size.w - 2 * 56);
  if (isPortraitSize(sizeKey)) {
    expect(geo.rows, "portrait shows per-size TopN").toBe(SHARE_TOP_N[sizeKey as keyof typeof SHARE_TOP_N]);
    expect(geo.hasConstraintsBlock, "portrait has compact constraints block").toBe(true);
    expect(geo.blockHasRules, "constraints block carries peak rules + domain").toBe(true);
    expect(geo.blockWidth, "constraints block fits card width").toBeLessThanOrEqual(size.w - 2 * 56);
  } else {
    expect(geo.rows, "landscape always Top 5").toBe(autoTopN("og"));
    expect(geo.constraintLines, "landscape has no constraint lines").toBe(0);
    expect(geo.hasConstraintsBlock, "landscape has no constraints block").toBe(false);
  }
}

async function capture(page: Page, name: string): Promise<void> {
  const box = page.locator("#share_modal .modal-box");
  await box.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  await box.locator("svg").screenshot({ path: path.join(OUT_DIR, `${name}-card.png`) });
}

test.describe("share card sizes", { tag: ["@screenshot"] }, () => {
  test("size presets are exactly og/twitter/ig/story (no square/wide)", async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), "desktop-only preset check");
    await openShareDialog(page, "/");

    const options = await page
      .locator("#share-size option")
      .evaluateAll((els) => els.map((e) => [(e as HTMLOptionElement).value, (e.textContent ?? "").trim()]));
    expect(options.map(([v]) => v).sort(), "no legacy square/wide preset").toEqual(["ig", "og", "story", "twitter"]);
    for (const [value, label] of options) {
      expect(label, `label for ${value}`).toBe(SHARE_SIZES[value as keyof typeof SHARE_SIZES].label);
    }
    expect(SIZE_KEYS, "SHARE_SIZES keys").toEqual(["ig", "og", "story", "twitter"]);
    // No TopN dropdown (automatic per preset), no price-basis UI.
    await expect(page.locator("#share-topn"), "no TopN control").toHaveCount(0);
    await expect(
      page.locator("#share_modal").getByText(/Preisbasis|Price basis/),
      "no price-basis UI",
    ).toHaveCount(0);
    await capture(page, "share-presets");
  });

  test("dialog X close button is visible and closes the dialog", async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), "desktop-only close check");
    await openShareDialog(page, "/");
    const x = page.locator("#share_modal .modal-box > form > button.btn-circle");
    await expect(x, "X close button visible top-right").toBeVisible();
    await expect(x, "X has localized close label").toHaveAttribute("aria-label", /Schließen|Close/);
    await capture(page, "share-dialog-x");
    await x.click();
    await page.locator("#share_modal").waitFor({ state: "hidden", timeout: 5000 });
  });

  for (const sizeKey of SIZE_KEYS) {
    const topN = topNForSize(sizeKey);
    test(`share card ${sizeKey} renders without overflow (de/en, dark/light, top${topN})`, async ({
      page,
    }, testInfo) => {
      test.skip(!isDesktop(testInfo.project.name), "desktop-only card check");
      for (const shareLang of ["EN", "DE"] as ShareLangName[]) {
        await openShareDialog(page, shareLang === "DE" ? "/?lang=de" : "/");
        for (const theme of ["light", "dark"] as CardTheme[]) {
          await configureCard(page, { shareLang, theme, size: sizeKey });
          const geo = await cardGeometry(page);
          expectCardFits(geo, sizeKey, topN);
          await expectDialogFitsViewport(page);
          await capture(page, `share-${sizeKey}-${shareLang.toLowerCase()}-${theme}-top${topN}`);
        }
      }
    });
  }

  test("portrait top10 shows peak/off-peak constraint lines with UTC + weekday scope", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), "desktop-only constraint check");
    for (const shareLang of ["EN", "DE"] as ShareLangName[]) {
      await openShareDialog(page, shareLang === "DE" ? "/?lang=de" : "/");
      await configureCard(page, { shareLang, theme: "dark", size: "ig" });
      const geo = await cardGeometry(page);
      // The densest portrait card reaches constrained DeepSeek tiers.
      expect(geo.constraintLines, "at least one peak/off-peak row line").toBeGreaterThan(0);
      const lines = await page
        .locator('#share_modal .modal-box svg [data-constraint="1"]')
        .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
      for (const line of lines) {
        // Never a bare "OFF-PEAK": UTC window + weekday scope (or daily) required.
        expect(line, "constraint line carries UTC window + weekday scope").toMatch(
          /UTC · .*(Mo–Fr|Mon–Fri|täglich|daily)/,
        );
      }
      const blockText =
        (await page.locator('#share_modal .modal-box svg [data-constraints]').textContent()) ?? "";
      expect(blockText, "rules block carries UTC window + weekday scope").toMatch(
        /UTC · .*(Mo–Fr|Mon–Fri|täglich|daily)/,
      );
      await capture(page, `share-constraints-${shareLang.toLowerCase()}`);
    }
  });

  test("share logic mirrors the main table (free ∞ rank, requests-desc order)", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), "desktop-only logic check");
    await page.goto("/?basis=full&lang=en");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("main")).toBeVisible();
    const parity = await page.evaluate(async () => {
      const share = (await import("/src/share.ts")) as typeof import("../../src/share");
      // Synthetic free model (usage = null, like gratis Zen/table rows).
      const free = {
        name: "Free Test",
        tier: null,
        input: 0,
        output: 0,
        cachedRead: 0,
        cachedWrite: null,
        usage: null,
        multiplier: null,
        effectiveInput: 0,
        effectiveOutput: 0,
        effectiveCachedRead: 0,
        effectiveCachedWrite: null,
        pattern: null,
        capabilities: null,
        contextWindow: null,
        provider: null,
        privacy: null,
      };
      const paid = {
        ...free,
        name: "Paid Test",
        tier: null,
        input: 1,
        output: 3,
        cachedRead: 0.2,
        usage: 15,
        multiplier: 4,
        effectiveInput: 4,
        effectiveOutput: 12,
        effectiveCachedRead: 0.8,
        pattern: { input: 390, cachedRead: 32500, output: 120 },
      };
      const freeValue = share.shareRequests(free);
      const rows = share.topModels([paid, free], 5, []);
      // Same-table caps filter: video-only keeps video models (OR-semantics).
      const withCaps = {
        ...paid,
        name: "Video Test",
        capabilities: { input: ["text", "video"], output: ["text"], reasoning: false, toolCall: false },
      };
      const filtered = share.topModels([paid, withCaps], 5, ["video"]);
      return {
        freeValue: freeValue === Infinity ? "Infinity" : String(freeValue),
        first: rows[0]?.name ?? null,
        filteredNames: filtered.map((r) => r.name),
        noWindowsDe: share.shareRulesLine("de", null),
        noWindowsEn: share.shareRulesLine("en", null),
        scopeDe: share.shareWeekdayScope("de"),
        scopeEn: share.shareWeekdayScope("en"),
      };
    });
    // Free/unlimited ranks top (Infinity), displayed as ∞ — no card-side special path.
    expect(parity.freeValue, "free model requests = Infinity").toBe("Infinity");
    expect(parity.first, "free model outranks paid models").toBe("Free Test");
    // Capability default mirrors the table (OR-semantics).
    expect(parity.filteredNames, "cap filter keeps matching models").toEqual(["Video Test"]);
    // Undocumented windows are marked as source-state, never guessed.
    expect(parity.noWindowsDe, "de fallback marks source state").toMatch(/Quellenstand/);
    expect(parity.noWindowsEn, "en fallback marks source state").toMatch(/source state/);
    expect(parity.scopeDe, "de scope from source weekend rule").toMatch(/Mo–Fr/);
    expect(parity.scopeEn, "en scope from source weekend rule").toMatch(/Mon–Fri/);
  });

  test("card order matches the list-basis table requests-desc order (basis ignored)", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), "desktop-only parity check");
    // The card has no price basis — a legacy ?basis= page param must not
    // change the card: it always mirrors the list-basis table order.
    for (const pageBasis of ["paid", "full"] as const) {
      await openShareDialog(page, `/?basis=${pageBasis}&lang=en`);
      await configureCard(page, { shareLang: "EN", theme: "dark", size: "og" });
      const cardNames = await page
        .locator('#share_modal .modal-box svg g[data-row] > text:nth-of-type(2)')
        .evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s*\(.*\)\s*$/, "")));
      await closeShareDialog(page);
      await page.goto("/?basis=list&lang=en");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("main")).toBeVisible();
      // Name cell is th > span.block:first-child (bare name; provider/tier
      // live in their own sibling spans, so a bare span.block selector would
      // interleave them).
      const tableNames = await page
        .locator("#prices tbody tr th > span.block:first-child")
        .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
      expect(cardNames, `card = list table requests-desc prefix (page basis=${pageBasis})`).toEqual(
        tableNames.slice(0, cardNames.length),
      );
    }
  });

  test("card adopts the page capability filter (default + deep-link round-trip)", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), "desktop-only cap check");
    await openShareDialog(page, "/?basis=full&lang=en&cap=video#share");
    // Dialog auto-opened from #share with the page's cap default; the page
    // ?basis= is ignored by the card (automatic Top 5 on og).
    const cardNames = await page
      .locator('#share_modal .modal-box svg g[data-row] > text:nth-of-type(2)')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s*\(.*\)\s*$/, "")));
    expect(cardNames.length, "cap-filtered card still Top 5").toBe(5);
    await closeShareDialog(page);
    const tableNames = await page
      .locator("#prices tbody tr th > span.block:first-child")
      .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    expect(tableNames.length, "table filtered by the same cap").toBeGreaterThan(5);
    expect(cardNames, "card = filtered table prefix (cap default round-trip)").toEqual(
      tableNames.slice(0, cardNames.length),
    );
  });

  test("legacy square/wide/metric/topN/basis params are tolerated", async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), "desktop-only compat check");
    await openShareDialog(
      page,
      "/?basis=full&metric=input&topN=5&shareTheme=dark&shareSize=square&lang=en#share",
    );
    expect(await page.locator("#share-size").inputValue(), "square coerces to og").toBe("og");
    expect(await page.locator("#share-title").textContent(), "old metric link shows requests title").toBe(
      "Share top models",
    );
    expectCardFits(await cardGeometry(page), "og", "5");

    await openShareDialog(page, "/?metric=cost&shareSize=wide&lang=de#share");
    expect(await page.locator("#share-size").inputValue(), "wide coerces to og").toBe("og");
    expect(await page.locator("#share-title").textContent(), "old metric link shows requests title (de)").toBe(
      "Top-Modelle teilen",
    );

    // Legacy ?topN= is tolerated but ignored: per-size TopN is automatic
    // (IG Top 10, Story Top 15).
    await openShareDialog(page, "/?topN=10&shareSize=ig#share");
    expectCardFits(await cardGeometry(page), "ig", "10");

    await openShareDialog(page, "/?basis=paid&topN=3&shareSize=story#share");
    expectCardFits(await cardGeometry(page), "story", "15");
    await capture(page, "share-legacy-coerced");
  });
});

test.describe("share dialog mobile", { tag: ["@screenshot"] }, () => {
  test("dialog fits the viewport in all sizes and both languages", async ({ page }, testInfo) => {
    test.skip(isDesktop(testInfo.project.name), "mobile-only dialog check");
    for (const shareLang of ["EN", "DE"] as ShareLangName[]) {
      await openShareDialog(page, shareLang === "DE" ? "/?lang=de" : "/");
      for (const sizeKey of SIZE_KEYS) {
        const topN = topNForSize(sizeKey);
        await configureCard(page, { shareLang, theme: "light", size: sizeKey });
        await expectDialogFitsViewport(page);
        expectCardFits(await cardGeometry(page), sizeKey, topN);
        await capture(page, `share-mobile-${sizeKey}-${shareLang.toLowerCase()}-top${topN}`);
      }
    }
  });
});
