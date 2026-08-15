// UI-review route manifest — single source of truth for which pages get
// screenshotted and in which states. Edit this file to add/remove routes; the
// generic spec picks the changes up automatically.

export type UiReviewState = "filled" | "empty";
export type UiReviewViewport = "desktop" | "mobile";

export interface UiReviewRoute {
  name: string;
  path: string;
  states: UiReviewState[];
  viewports?: UiReviewViewport[];
  note?: string;
  /** Static <title> of the app — guards against capturing a foreign server on the port. */
  expectedTitle: string;
}

export interface UiReviewConfig {
  /** Must mirror `outputDir` in playwright.screenshots.config.ts. */
  outputDir: string;
  routes: UiReviewRoute[];
}

export const uiReviewConfig: UiReviewConfig = {
  outputDir: "test-results/ui-screenshots",
  routes: [
    {
      name: "home",
      path: "/",
      states: ["filled"],
      note: "Statische Pricing-Seite (Daten beim Build importiert) — kein sinnvoller Empty-State.",
      expectedTitle: "Price Tracking for OpenCode Go",
    },
    {
      name: "home-de",
      path: "/?lang=de",
      states: ["filled"],
      note: "Deutsche Variante zur i18n-Kontrolle; Default-Lang ist en (Browser-Locale).",
      expectedTitle: "Price Tracking for OpenCode Go",
    },
  ],
};

export const routes = uiReviewConfig.routes;
