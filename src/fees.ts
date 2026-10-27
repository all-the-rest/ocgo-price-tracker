import type { Plan } from "./types";

/**
 * Gebührenstruktur nach dem Schwesterprojekt cc-price-tracker: Prozentsatz plus
 * fixer Betrag, auf Cent gerundet. Für OpenCode Go sind beide Werte aktuell 0.
 */
const FEE_RATE = 0;
const FEE_FIXED = 0;

export function processingFee(priceMonthly: number): number {
  if (!priceMonthly || priceMonthly <= 0) return 0;
  return Math.round((priceMonthly * FEE_RATE + FEE_FIXED) * 100) / 100;
}

export function actualPaid(plan: Plan): number {
  const base = plan.priceMonthly ?? 0;
  return base + processingFee(base);
}
