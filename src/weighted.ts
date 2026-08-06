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
 * Preiszuordnung (Heuristik): Input-Tokens → 80% Input-Preis + 20% Cached-Write-
 * Preis, Cached-Tokens → Cached-Read-Preis, Output-Tokens → Output-Preis. Ein
 * fehlender Cached-Write-Preis (in der Doku mit "-" dokumentiert) zählt wie der
 * Input-Preis (der Input-Anteil wird dann zum reinen Input-Preis).
 */
export function requestCost(m: Model, basis: "list" | "full"): number | null {
  if (!m.pattern) return null;
  const input = fieldPrice(m, "input", basis);
  const cached = fieldPrice(m, "cachedRead", basis);
  const writeRaw = fieldPrice(m, "cachedWrite", basis);
  const output = fieldPrice(m, "output", basis);
  if (input === null || cached === null || output === null) return null;
  const write = writeRaw ?? input;
  const inputEffective = 0.8 * input + 0.2 * write;
  return (
    (inputEffective * m.pattern.input + cached * m.pattern.cachedRead + output * m.pattern.output) /
    1e6
  );
}

export function formatTokens(n: number, lang: "de" | "en"): string {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US").format(n);
}
