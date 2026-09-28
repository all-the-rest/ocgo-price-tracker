import type { Basis, Model, Plan, PriceField } from "./types";

export type { PriceField };

/**
 * Nutzung eines Modells im gegebenen Plan (Plan-Map, `null` = unbegrenzt).
 * Die Multiplikator-Rechnung liegt bewusst hier in der UI (nicht mehr
 * vorberechnet im Snapshot) — sie ist plan-abhängig.
 */
export function usageOf(m: Model, plan: Plan): number | null {
  return m.usage[plan.id] ?? null;
}

/**
 * Multiplikator für die Preisbasis „volles Monatsguthaben“:
 * `plan.creditsMonthly / Nutzung`; `null` bei unbegrenzter Nutzung.
 */
export function multiplierOf(m: Model, plan: Plan): number | null {
  const usage = usageOf(m, plan);
  return usage === null ? null : plan.creditsMonthly / usage;
}

/**
 * Preis je Modellfeld für die gewählte Preisbasis:
 * - "list" → Listenpreis (aus der Doku)
 * - "full" → Effektivpreis bei vollem Monatsguthaben
 *            (Listenpreis × creditsMonthly/Nutzung des Plans)
 * - "paid" → Effektivpreis auf Basis dessen, was man tatsächlich zahlt
 *            (Listenpreis × priceMonthly/Nutzung, z. B. $10 → 1,5× bei
 *            $15-Nutzung). Beide Effektivbasen brauchen den Plan; unbegrenzte
 *            Nutzung (`null`) → null.
 *
 * Unbegrenzte Nutzung: bei `paid` gibt es keinen Faktor (Nutzung im Nenner
 * fehlt) → `null`/`–`. Bei `full` bleibt dagegen der **Listenpreis** stehen —
 * so war es auch vorher, als der Scraper für Gratis-Zeilen `multiplier = null`
 * und `effective* = input` (= 0) schrieb. Das ist gewollt: gratis ist ein
 * bekannter Preis, die Spalte zeigt `$0.00` und nicht `–` (analog
 * `requestCost` = 0 → `$0.00`).
 */
export function fieldPrice(m: Model, f: PriceField, basis: Basis, plan: Plan): number | null {
  const raw = m[f];
  if (basis === "list") return raw;
  if (raw === null) return null;
  if (basis === "paid") {
    const usage = usageOf(m, plan);
    return usage === null ? null : raw * (plan.priceMonthly / usage);
  }
  const mult = multiplierOf(m, plan);
  return mult === null ? raw : raw * mult;
}

/**
 * Kosten pro Anfrage für ein Modell: dokumentiertes Anfragemuster des Modells
 * (Input/Cached/Output Tokens pro Anfrage) × Modellpreis pro 1M Tokens.
 * Kostenlose Modelle (usage = null, kein Muster) → 0.
 *
 * Preiszuordnung (Heuristik): Input-Tokens → 5% Input-Preis + 95% Cached-Write-
 * Preis, Cached-Tokens → Cached-Read-Preis, Output-Tokens → Output-Preis. Ein
 * fehlender Cached-Write-Preis (in der Doku mit "-" dokumentiert) zählt wie der
 * Input-Preis (der Input-Anteil wird dann zum reinen Input-Preis).
 *
 * Die 5/95-Gewichtung basiert auf beobachteter Nutzung (opencode-Telemetrie):
 * für Modelle mit dokumentiertem Cached-Write-Preis entfällt der Großteil der
 * frischen Token auf Cached-Write (Luna ~28/72, Qwen3.8 Max ~0/100), nicht auf
 * den reinen Input-Preis.
 */
export function requestCost(m: Model, basis: Basis, plan: Plan): number | null {
  if (!m.pattern) {
    // Kostenlose Modelle (Preise 0, kein dokumentiertes Anfragemuster):
    // Kosten pro Anfrage = 0 statt "-".
    return usageOf(m, plan) === null ? 0 : null;
  }
  const input = fieldPrice(m, "input", basis, plan);
  const cached = fieldPrice(m, "cachedRead", basis, plan);
  const writeRaw = fieldPrice(m, "cachedWrite", basis, plan);
  const output = fieldPrice(m, "output", basis, plan);
  if (input === null || cached === null || output === null) return null;
  const write = writeRaw ?? input;
  const inputEffective = 0.05 * input + 0.95 * write;
  return (
    (inputEffective * m.pattern.input + cached * m.pattern.cachedRead + output * m.pattern.output) /
    1e6
  );
}

/**
 * Anzahl der Anfragen pro Monat: die im Plan enthaltene Nutzung für das Modell
 * (plan-spezifisch) ÷ Kosten pro Anfrage zum **Listenpreis**. Die Kosten sind
 * absichtlich immer auf Listenpreisbasis gerechnet — die Preisbasis-Umschaltung
 * der Tabelle darf diese Zahl nicht verändern. Unbegrenzte Nutzung im aktiven
 * Plan (usage = null, kostenlose Modelle) → Infinity (sortiert bei absteigender
 * Sortierung ganz nach oben).
 */
export function requestsPerMonth(m: Model, plan: Plan): number | null {
  const usage = usageOf(m, plan);
  if (usage === null) return Infinity;
  const cost = requestCost(m, "list", plan);
  if (cost === null || cost <= 0) return null;
  return usage / cost;
}

export function formatReqPerMonth(n: number, lang: "de" | "en"): string {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US", { maximumFractionDigits: 0 }).format(n);
}

export function formatTokens(n: number, lang: "de" | "en"): string {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US").format(n);
}
