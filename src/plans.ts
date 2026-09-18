import type { Translation } from "./i18n";
import type { Plan, PlanId, PriceData } from "./types";

export const DEFAULT_PLAN_ID: PlanId = "go";

export const TAB_PLAN_IDS: readonly PlanId[] = ["go"];

export function isTabPlan(id: string | null): id is PlanId {
  return id !== null && (TAB_PLAN_IDS as readonly string[]).includes(id);
}

const PLAN_LABEL_KEY: Record<string, keyof Translation> = {
  go: "planGo",
};

export function planLabel(id: string, t: Translation): string {
  const key = PLAN_LABEL_KEY[id];
  return key ? t[key] : id;
}

/** Baut einen Plan aus den gescrapten Monatswerten (Scraper + Fallback). */
export function buildPlan(creditsMonthly: number, priceMonthly: number, sourceUrl: string): Plan {
  return { id: "go", name: "Go", priceMonthly, creditsMonthly, sourceUrl };
}

/**
 * Löst den aktiven Plan auf: `plans`-Eintrag mit passender ID, sonst der
 * erste Plan, sonst Fallback aus den Kompat-Feldern (alte Snapshots).
 */
export function resolvePlan(data: PriceData, id: PlanId = DEFAULT_PLAN_ID): Plan {
  const found = (data.plans ?? []).find((p) => p.id === id) ?? data.plans?.[0];
  if (found) return found;
  return buildPlan(data.monthlyCredit, data.monthlyCost, data.sourceUrl);
}
