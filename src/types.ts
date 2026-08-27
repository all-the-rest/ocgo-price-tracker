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
  /**
   * true = ZDR (0 Tage / Zero Data Retention)
   * false = kein ZDR (Daten werden aufbewahrt, Dauer unbekannt)
   * number = bekannte Aufbewahrungsdauer in Tagen
   * undefined/fehlend = unbekannt ("–" in der Doku)
   */
  retentionDays?: boolean | number;
  validUntil: string | null;
  fallback?: boolean;
}

export interface PricingType {
  input: number | null;
  output: number | null;
  cachedRead: number | null;
  cachedWrite: number | null;
  /** null = unbegrenzte Nutzung (kostenlose Modelle) */
  usage: number | null;
}

export interface RequestPattern {
  input: number;
  cachedRead: number;
  output: number;
}

export interface FreeModel {
  id: string;
  /** optionaler Anzeigename (bei Alias-IDs wie x-preview-f-free = Ox Alpha Free) */
  name?: string;
  availableFrom: string;
  capabilities: Capabilities | null;
  /** Kontextfenster in Tokens (aus models.dev); null = unbekannt. */
  contextWindow: number | null;
  /** Hersteller/Provider (aus models.dev, z. B. "anthropic", "xai"); null = unbekannt. */
  provider: string | null;
  privacy: Privacy;
}

export interface Model {
  name: string;
  tier: string | null;
  /** Modell-ID für OpenCode (`opencode/<id>`); null/fehlend = nicht im opencode-Provider gelistet */
  id?: string | null;
  input: number | null;
  output: number | null;
  cachedRead: number | null;
  cachedWrite: number | null;
  usage: number | null;
  multiplier: number | null;
  effectiveInput: number | null;
  effectiveOutput: number | null;
  effectiveCachedRead: number | null;
  effectiveCachedWrite: number | null;
  pattern: RequestPattern | null;
  capabilities: Capabilities | null;
  /** Kontextfenster in Tokens (aus models.dev); null = unbekannt. */
  contextWindow: number | null;
  /** Hersteller/Provider (aus models.dev, z. B. "anthropic", "xai"); null = unbekannt. */
  provider: string | null;
  privacy: Privacy | null;
}

export type PeakHours = Record<string, [number, number][]>;

export interface PriceData {
  fetchedAt: string;
  sourceUrl: string;
  freeModelsSourceUrl: string;
  capabilitiesSourceUrl: string;
  sourceLang: string;
  monthlyCredit: number;
  monthlyCost: number;
  peakHours: PeakHours;
  models: Model[];
  freeModels: FreeModel[];
}

export type SupportedLocale = "en" | "de";

export type Change =
  | { type: "text"; lang: Record<SupportedLocale, string> }
  | { type: "model_added"; model: string; pricing: PricingType }
  | { type: "model_removed"; model: string; days: number; pricing: PricingType }
  | { type: "price_changed"; model: string; from: PricingType; to: PricingType; fields: PriceField[] }
  | { type: "usage_changed"; model: string; from: number | null; to: number | null }
  | { type: "capabilities_changed"; model: string; from: Capabilities | null; to: Capabilities | null }
  | { type: "privacy_changed"; model: string; from: Privacy | null; to: Privacy | null }
  | { type: "free_added"; model: string; name?: string }
  | { type: "free_removed"; model: string; name?: string; availableFrom: string; until: string };

export interface ChangelogEntry {
  id: string;
  date: string;
  changes: Change[];
}

export interface ChangelogData {
  entries: ChangelogEntry[];
}
