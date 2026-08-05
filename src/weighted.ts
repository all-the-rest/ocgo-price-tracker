import type { Model, PriceField } from "./types";

export type { PriceField };

const EFFECTIVE_FIELD: Record<PriceField, keyof Model> = {
  input: "effectiveInput",
  output: "effectiveOutput",
  cachedRead: "effectiveCachedRead",
  cachedWrite: "effectiveCachedWrite",
};

export function fieldPrice(m: Model, f: PriceField, basis: "list" | "full"): number | null {
  const raw = m[f];
  if (basis === "list") return raw;
  return (m[EFFECTIVE_FIELD[f]] ?? raw) as number | null;
}

/**
 * Kosten pro Anfrage für ein Modell: dokumentiertes Anfragemuster des Modells
 * (Input/Cached/Output Tokens pro Anfrage) × Modellpreis pro 1M Tokens.
 *
 * Preiszuordnung: Input-Tokens → Input-Preis + Cached-Write-Preis (nur wenn
 * vorhanden), Cached-Tokens → Cached-Read-Preis, Output-Tokens → Output-Preis.
 */
export function requestCost(m: Model, basis: "list" | "full"): number | null {
  if (!m.pattern) return null;
  const input = fieldPrice(m, "input", basis);
  const cached = fieldPrice(m, "cachedRead", basis);
  const write = fieldPrice(m, "cachedWrite", basis);
  const output = fieldPrice(m, "output", basis);
  if (input === null || cached === null || output === null) return null;
  const inputEffective = input + (write ?? 0);
  return (
    (inputEffective * m.pattern.input + cached * m.pattern.cachedRead + output * m.pattern.output) /
    1e6
  );
}

export function formatTokens(n: number, lang: "de" | "en"): string {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US").format(n);
}
