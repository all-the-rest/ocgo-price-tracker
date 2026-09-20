/**
 * Zentrale, sprachstabile Heading-Anker.
 *
 * Alle `id`-Attribute von Abschnitts-Überschriften (h1/h2/h3) und alle
 * URL-Hashes (`#prices`, `#ranking`, …) stammen aus dieser einen Quelle und
 * sind IMMER aus dem englischen Heading abgeleitet — identisch in EN und DE,
 * stabil über Sprachwechsel (`/` ↔ `/de/`) und den `?lang=`-Alias.
 *
 * Regeln:
 * - Nur hier neue Anker hinzufügen; keine hartkodierten `id="…"`-Strings in
 *   Komponenten (Ausnahme: dynamische IDs wie Changelog-Einträge/Dialog).
 * - Reine Konstanten — kein `Date`/`window`, damit SSR (`renderToString`,
 *   `scripts/prerender.mjs`) und Client identisch rendern (hydration-safe).
 * - Kurzformen (`ranking`, `faq`) statt Voll-Slugs, wo der kurze Anker der
 *   etablierte Deep-Link ist; `privacy` ist die Daten-Tabelle, daher heißt
 *   der rechtliche Abschnitt disambiguiert `privacy-policy`.
 * - `imprint`: Das EN-Heading behält den deutschen Rechtsbegriff
 *   („Impressum“), der EN-abgeleitete Slug ist also identisch (`impressum`).
 */
export const HEADING_IDS = {
  /** Preistabelle (EN „Prices“). Auch im JSON-LD (`prerender.mjs`) verlinkt. */
  prices: "prices",
  /** Top-10-Ranking (EN „Model ranking“). */
  ranking: "ranking",
  /** Kostenlose Zen-Modelle (EN „Free models“). */
  freeModels: "free-models",
  /** Datenschutz-Tabelle (EN „Privacy“). */
  privacy: "privacy",
  /** FAQ (EN „Frequently asked questions“). */
  faq: "faq",
  /** Changelog (EN „Changelog“). */
  changelog: "changelog",
  /** Go-Empfehlungskarte im Hero (EN „OpenCode Go“). */
  go: "go",
  /** Impressum (EN-Label „Impressum“ — identischer Slug). */
  imprint: "impressum",
  /** Rechtlicher Datenschutz-Abschnitt (EN-Label „Privacy“). */
  privacyPolicy: "privacy-policy",
  /** Deep-Link `#share` öffnet den Teilen-Dialog. */
  share: "share",
} as const;

export type HeadingId = (typeof HEADING_IDS)[keyof typeof HEADING_IDS];

/** Gibt die sprachstabile Anker-ID zurück (Identität — dokumentiert die Quelle). */
export function headingId(id: HeadingId): HeadingId {
  return id;
}
