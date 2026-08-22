/**
 * Peak-/Off-Peak-Billing-Regeln (statisch, typisiert).
 *
 * - Off-Peak ist der Basispreis (Default). Peak-Preis = Off-Peak × peakFactor.
 * - Peak-Fenster gelten in UTC; alle übrigen Stunden sind Off-Peak.
 * - Am Wochenende (Samstag + Sonntag, Peking-Zeit) gilt durchgehend Off-Peak.
 * - Gültig ab „Effective 00:00 (Beijing Time) on Sunday, August 23, 2026".
 */

/** Benannte UTC-Peak-Fenster-Sets. Mechanismen verweisen per Key (`windowsRef`) darauf. */
export const PEAK_WINDOWS_UTC = {
  deepseek: [
    [1, 4],
    [6, 10],
  ],
} as const;

export type PeakWindowsKey = keyof typeof PEAK_WINDOWS_UTC;

/** Billing-Mechanismus: Referenz auf ein Fenster-Set + Peak-Faktor auf den Off-Peak-Basispreis. */
export interface PeakMechanism {
  readonly windowsRef: PeakWindowsKey;
  /** Peak-Preis = Off-Peak-(Basis-)Preis × peakFactor */
  readonly peakFactor: number;
}

export const PEAK_MECHANISMS = {
  deepseekUtcPeak: { windowsRef: "deepseek", peakFactor: 2 },
} as const satisfies Record<string, PeakMechanism>;

export type PeakMechanismKey = keyof typeof PEAK_MECHANISMS;

/** Modell-Normalform (normalizePeakModel) → Mechanismus-Key. */
export const PEAK_MODEL_MECHANISMS = {
  deepseekv4pro: "deepseekUtcPeak",
  deepseekv4flash: "deepseekUtcPeak",
  deepseekv4flashvisionexp: "deepseekUtcPeak",
} as const satisfies Record<string, PeakMechanismKey>;

/** Peking-Zeit = UTC+8 ganzjährig (keine DST). */
export const BEIJING_UTC_OFFSET_MINUTES = 8 * 60;

export const PEAK_PRICING_RULES = {
  /** „Effective 00:00 (Beijing Time) on Sunday, August 23, 2026" */
  effectiveFromMs: Date.parse("2026-08-23T00:00:00+08:00"),
  /** Durchgehend Off-Peak an diesen Wochentagen in Peking-Zeit: Samstag + Sonntag. */
  weekendOffPeakDaysBeijing: [0, 6] as const, // 0 = Sonntag, 6 = Samstag
} as const;

/** Wochentag in Peking-Zeit (0 = Sonntag … 6 = Samstag). */
export function beijingDayOfWeek(now: number): number {
  return new Date(now + BEIJING_UTC_OFFSET_MINUTES * 60_000).getUTCDay();
}

export function isBeijingWeekend(now: number): boolean {
  return (PEAK_PRICING_RULES.weekendOffPeakDaysBeijing as readonly number[]).includes(
    beijingDayOfWeek(now),
  );
}
