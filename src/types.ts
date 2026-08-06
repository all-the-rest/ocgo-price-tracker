export type PriceField = "input" | "output" | "cachedRead" | "cachedWrite";

export interface PricingType {
  input: number | null;
  output: number | null;
  cachedRead: number | null;
  cachedWrite: number | null;
  usage: number;
}

export interface RequestPattern {
  input: number;
  cachedRead: number;
  output: number;
}

export interface FreeModel {
  id: string;
  availableFrom: string;
}

export interface Model {
  name: string;
  tier: string | null;
  input: number | null;
  output: number | null;
  cachedRead: number | null;
  cachedWrite: number | null;
  usage: number;
  multiplier: number;
  effectiveInput: number | null;
  effectiveOutput: number | null;
  effectiveCachedRead: number | null;
  effectiveCachedWrite: number | null;
  pattern: RequestPattern | null;
}

export interface PriceData {
  fetchedAt: string;
  sourceUrl: string;
  freeModelsSourceUrl: string;
  sourceLang: string;
  monthlyCredit: number;
  models: Model[];
  freeModels: FreeModel[];
}

export type SupportedLocale = "en" | "de";

export type Change =
  | { type: "text"; lang: Record<SupportedLocale, string> }
  | { type: "model_added"; model: string; pricing: PricingType }
  | { type: "model_removed"; model: string; days: number }
  | { type: "pricing_changed"; model: string; from: PricingType; to: PricingType }
  | { type: "free_added"; model: string }
  | { type: "free_removed"; model: string; availableFrom: string; until: string };

export interface ChangelogEntry {
  date: string;
  changes: Change[];
}

export interface ChangelogData {
  entries: ChangelogEntry[];
}
