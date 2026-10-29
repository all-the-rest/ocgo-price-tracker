import type { Translation } from "./i18n";
import type { Plan, PlanId, PriceData } from "./types";

export const DEFAULT_PLAN_ID: PlanId = "go";

/** Accept a URL plan only when it exists in the currently scraped catalog. */
export function resolvePlanParam(id: string | null, plans: readonly Plan[]): PlanId | null {
  return id !== null && plans.some((plan) => plan.id === id) ? id : null;
}

const PLAN_LABEL_KEY: Record<string, keyof Translation> = {
  go: "planGo",
  "go-plus": "planGoPlus",
};

export function planLabel(id: string, t: Translation, name?: string): string {
  const key = PLAN_LABEL_KEY[id];
  return key ? t[key] : (name ?? id);
}

/**
 * Legacy-Fallback-Plan, wenn ein altes JSON noch keine `plans` trägt (die
 * Hydration darf mit einem älteren Snapshot nicht crashen).
 */
export function buildPlan(sourceUrl: string): Plan {
  return { id: "go", name: "Go", priceMonthly: 10, creditsMonthly: 60, sourceUrl };
}

/**
 * Löst den aktiven Plan auf: `plans`-Eintrag mit passender ID, sonst der
 * erste Plan, sonst der Legacy-Fallback (altes JSON ohne `plans`).
 */
export function resolvePlan(data: PriceData, id: PlanId = DEFAULT_PLAN_ID): Plan {
  const found = (data.plans ?? []).find((p) => p.id === id) ?? data.plans?.[0];
  if (found) return found;
  return buildPlan(data.sourceUrl);
}

/**
 * Alle Pläne (inkl. Legacy-Fallback) für plan-übergreifende Beschriftungen —
 * das Changelog nennt Plannamen außerhalb des aktiven Plans.
 */
export function allPlans(data: PriceData): Plan[] {
  return data.plans && data.plans.length > 0 ? data.plans : [buildPlan(data.sourceUrl)];
}
