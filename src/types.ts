export type PriceField = "input" | "output" | "cachedRead" | "cachedWrite";

export type Basis = "list" | "full" | "paid";

export type Modality = "text" | "audio" | "image" | "video" | "pdf";

export interface Capabilities {
  input: Modality[];
  output: Modality[];
  reasoning: boolean;
  toolCall: boolean;
}

export interface Privacy {
  training: boolean;
  retentionDays: number | null;
  validUntil: string | null;
  fallback?: boolean;
}

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
  capabilities: Capabilities | null;
  privacy: Privacy;
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
  capabilities: Capabilities | null;
  privacy: Privacy | null;
}

export interface PriceData {
  fetchedAt: string;
  sourceUrl: string;
  freeModelsSourceUrl: string;
  capabilitiesSourceUrl: string;
  sourceLang: string;
  monthlyCredit: number;
  monthlyCost: number;
  models: Model[];
  freeModels: FreeModel[];
}

export type SupportedLocale = "en" | "de";

export type Change =
  | { type: "text"; lang: Record<SupportedLocale, string> }
  | { type: "model_added"; model: string; pricing: PricingType }
  | { type: "model_removed"; model: string; days: number }
  | { type: "price_changed"; model: string; from: PricingType; to: PricingType; fields: PriceField[] }
  | { type: "usage_changed"; model: string; from: number; to: number }
  | { type: "capabilities_changed"; model: string; from: Capabilities | null; to: Capabilities | null }
  | { type: "privacy_changed"; model: string; from: Privacy | null; to: Privacy | null }
  | { type: "free_added"; model: string }
  | { type: "free_removed"; model: string; availableFrom: string; until: string };

export interface ChangelogEntry {
  date: string;
  changes: Change[];
}

export interface ChangelogData {
  entries: ChangelogEntry[];
}
