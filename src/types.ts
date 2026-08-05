export type PriceField = "input" | "output" | "cachedRead" | "cachedWrite";

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

export type Change =
  | { type: "baseline"; modelCount: number; freeModelCount: number }
  | { type: "model_added" | "model_removed"; model: string }
  | { type: "usage_changed"; model: string; from: number; to: number }
  | {
      type: "price_changed";
      model: string;
      field: PriceField;
      from: number | null;
      to: number | null;
    }
  | { type: "free_added"; model: string; availableFrom: string }
  | { type: "free_removed"; model: string; availableFrom: string; until: string };

export interface ChangelogEntry {
  date: string;
  changes: Change[];
}

export interface ChangelogData {
  entries: ChangelogEntry[];
}
