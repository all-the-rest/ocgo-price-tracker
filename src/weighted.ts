import type { Basis, Model, PriceField } from "./types";

export type { PriceField };

const EFFECTIVE_FIELD: Record<PriceField, keyof Model> = {
  input: "effectiveInput",
  output: "effectiveOutput",
  cachedRead: "effectiveCachedRead",
  cachedWrite: "effectiveCachedWrite",
};

/**
 * Preis je Modellfeld für die gewählte Preisbasis:
 * - "list" → Listenpreis (aus der Doku)
 * - "full" → Effektivpreis bei vollem $60-Monatsguthaben (Listenpreis × 60/Nutzung)
 * - "paid" → Effektivpreis auf Basis dessen, was man tatsächlich zahlt
 *            (Listenpreis × Monatspreis/Nutzung, z. B. $10 → 1,5× bei $15-Nutzung)
 */
export function fieldPrice(m: Model, f: PriceField, basis: Basis, monthlyCost: number): number | null {
  const raw = m[f];
  if (basis === "list") return raw;
  if (basis === "paid") return raw === null ? null : raw * (monthlyCost / m.usage);
  return (m[EFFECTIVE_FIELD[f]] ?? raw) as number | null;
}

/**
 * Kosten pro Anfrage für ein Modell: dokumentiertes Anfragemuster des Modells
 * (Input/Cached/Output Tokens pro Anfrage) × Modellpreis pro 1M Tokens.
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
export function requestCost(m: Model, basis: Basis, monthlyCost: number): number | null {
  if (!m.pattern) return null;
  const input = fieldPrice(m, "input", basis, monthlyCost);
  const cached = fieldPrice(m, "cachedRead", basis, monthlyCost);
  const writeRaw = fieldPrice(m, "cachedWrite", basis, monthlyCost);
  const output = fieldPrice(m, "output", basis, monthlyCost);
  if (input === null || cached === null || output === null) return null;
  const write = writeRaw ?? input;
  const inputEffective = 0.05 * input + 0.95 * write;
  return (
    (inputEffective * m.pattern.input + cached * m.pattern.cachedRead + output * m.pattern.output) /
    1e6
  );
}

/**
 * Anzahl der Anfragen pro Monat: inkl. Nutzung (usage, der im Plan enthaltene
 * $‑Betrag für das Modell) ÷ Kosten pro Anfrage zum Listenpreis. Unabhängig von
 * der gewählten Preisbasis immer auf Basis des Listenpreises gerechnet.
 */
export function requestsPerMonth(m: Model, basis: Basis, monthlyCredit: number, monthlyCost: number): number | null {
  const cost = requestCost(m, "list", monthlyCost);
  if (cost === null || cost <= 0) return null;
  return m.usage / cost;
}

export function formatReqPerMonth(n: number, lang: "de" | "en"): string {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US", { maximumFractionDigits: 0 }).format(n);
}

export function formatTokens(n: number, lang: "de" | "en"): string {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US").format(n);
}
