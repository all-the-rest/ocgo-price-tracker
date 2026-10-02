export type PriceField = "input" | "output" | "cachedRead" | "cachedWrite";

export type Basis = "list" | "full" | "paid";

export type PlanId = "go" | "go-plus";

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
  /**
   * Nutzung als Plan-Map (Plan-Id → $, `null` = unbegrenzt). Immer alle Pläne;
   * der Scraper validiert genau diese Form.
   */
  usage: UsageMap;
}

/** Plan-Id → Nutzung in $ (`null` = unbegrenzt / kostenlose Zeile). */
export type UsageMap = Record<PlanId, number | null>;

export interface RequestPattern {
  input: number;
  cachedRead: number;
  output: number;
}

export interface FreeModel {
  id: string;
  /** volle Kopier-ID wie in der UI (`opencode/<id>` bzw. `opencode-go/…`); `id` bleibt stabiler Schlüssel */
  fullId: string;
  /** optionaler Anzeigename (bei Alias-IDs wie x-preview-f-free = Ox Alpha Free) */
  name?: string;
  availableFrom: string;
  capabilities: Capabilities | null;
  /** Kontextfenster in Tokens (aus models.dev); null = unbekannt. */
  contextWindow: number | null;
  /** Hersteller/Provider (aus models.dev, z. B. "Anthropic", "xAI", "Z.ai"); null = unbekannt. */
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
  /** Nutzung je Plan (Plan-Id → $, `null` = unbegrenzt/kostenlose Zeile). */
  usage: Record<PlanId, number | null>;
  pattern: RequestPattern | null;
  capabilities: Capabilities | null;
  /** Kontextfenster in Tokens (aus models.dev); null = unbekannt. */
  contextWindow: number | null;
  /** Hersteller/Provider (aus models.dev, z. B. "Anthropic", "xAI", "Z.ai"); null = unbekannt. */
  provider: string | null;
  privacy: Privacy | null;
}

/**
 * Peak-/Off-Peak-Regel eines Modells (Datenform der Spezifikation §1).
 *
 * - `timezone` = IANA-Zone, in der der Wochentag bewertet wird (DeepSeek:
 *   `Asia/Shanghai`). Kein Offset, kein Label.
 * - `peak.days` / `offPeak.days` = ISO-Wochentage (1 = Montag … 7 = Sonntag),
 *   disjunkt und zusammen {1..7}.
 * - `peak.windowsUtc` = UTC-Stundenfenster `[start, end]` (0 ≤ start < end ≤ 24),
 *   nicht überlappend, aufsteigend; gelten an `peak.days`.
 * - `offPeak.allDay` ist immer `true` (ganztägig Off-Peak an `offPeak.days`).
 * - `holidays` wird nur gesetzt, wenn die Quelle Feiertage nennt; `calendar`
 *   ist ein Schlüssel in `holidayCalendars`.
 * - `effectiveFrom` optional, ISO 8601 mit Offset.
 */
export interface PeakRule {
  timezone: string;
  effectiveFrom?: string;
  peak: { days: number[]; windowsUtc: Array<[number, number]> };
  offPeak: { days: number[]; allDay: true };
  holidays?: { policy: "off-peak"; calendar: string };
}

/** Öffentlicher Feiertagskalender, referenziert von einer `PeakRule`. */
export interface HolidayCalendar {
  /** Aufsteigende ISO-Datumsstrings (lokale Kalendertage der Regel-Zone). */
  dates: string[];
  /** Letzter Kalendertag, den die Feiertagsquelle abdeckt (ISO-Datum). */
  coveredThrough: string;
}

/** Modell-Normalform (Scraper/UI) → Peak-Regel. */
export type PeakRules = Record<string, PeakRule>;

/** Kalender-Schlüssel (z. B. `china`) → Feiertagskalender. */
export type HolidayCalendars = Record<string, HolidayCalendar>;

/**
 * Ein Abonnement-Plan (analog cc-price-tracker `Plan`). OpenCode Go hat zwei
 * Abonnemente (`go`, `go-plus`); Tokenpreise sind identisch, die inkludierte
 * Nutzung pro Modell unterscheidet sich.
 */
export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number;
  /** Höchste endliche Nutzung des Plans — Basis für „volles Monatsguthaben“. */
  creditsMonthly: number;
  sourceUrl: string;
}

export interface PriceData {
  fetchedAt: string;
  sourceUrl: string;
  freeModelsSourceUrl: string;
  capabilitiesSourceUrl: string;
  sourceLang: string;
  plans: Plan[];
  peakRules: PeakRules;
  /**
   * Optional: nur befüllt, wenn die Quelle Feiertage nennt. Die OpenCode-Doku
   * nennt keine → das Feld fehlt in `data/latest.json` (strikt quellenbindend).
   */
  holidayCalendars?: HolidayCalendars;
  models: Model[];
  freeModels: FreeModel[];
}

export type SupportedLocale = "en" | "de";

/** Ein geänderter Plan innerhalb eines `usage_changed`-Events. */
export interface UsagePlanChange {
  plan: PlanId;
  from: number | null;
  to: number | null;
}

export type Change =
  | { type: "text"; lang: Record<SupportedLocale, string> }
  | { type: "model_added"; model: string; pricing: PricingType }
  | { type: "model_removed"; model: string; days: number; pricing: PricingType }
  | { type: "price_changed"; model: string; from: PricingType; to: PricingType; fields: PriceField[] }
  // Ein Event pro Modell, im `plans`-Array nur die tatsächlich geänderten Pläne.
  | { type: "usage_changed"; model: string; plans: UsagePlanChange[] }
  | { type: "capabilities_changed"; model: string; from: Capabilities | null; to: Capabilities | null }
  | { type: "privacy_changed"; model: string; from: Privacy | null; to: Privacy | null }
  | { type: "free_added"; model: string; name?: string }
  | { type: "free_removed"; model: string; name?: string; availableFrom: string; until: string }
  // Ein Abonnement ist neu hinzugekommen: genau ein Event pro Plan.
  | { type: "plan_added"; plan: PlanId; name: string; priceMonthly: number; creditsMonthly: number };

export interface ChangelogEntry {
  id: string;
  date: string;
  changes: Change[];
}

export interface ChangelogData {
  entries: ChangelogEntry[];
}
