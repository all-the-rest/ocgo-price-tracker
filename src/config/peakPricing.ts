/**
 * Peak-/Off-Peak-Auswertung (datengetrieben, Spezifikation §2).
 *
 * Früher standen Wochentags-Scope und Wochenend-Regel hier hartkodiert
 * (`weekendOffPeakDaysBeijing`, `effectiveFromMs`). Jetzt kommt alles aus den
 * Daten (`peakRules` + `holidayCalendars` in `data/latest.json`); dieses Modul
 * ist die **eine** Quelle der Auswertung — die Komponenten rendern nur.
 *
 * Harte Regeln (Spezifikation §2):
 * - Wochentag und Feiertags-Datum werden **immer in `rule.timezone`** gebildet,
 *   nie in der Browser-Zone (sonst verschiebt sich „chinesischer Feiertag" je
 *   nach Aufrufer).
 * - Kein `isWorkday`/调休: ein 调休-Samstag bleibt Off-Peak.
 * - Vor `effectiveFrom` gilt **kein** Peak (Vorlaufzeit).
 */
import type { HolidayCalendar, HolidayCalendars, PeakRule, PeakRules } from "../types";

/** Normalform eines Modellnamens für die Peak-Zuordnung (Punkt bleibt stehen). */
export const normalizePeakModel = (name: string): string => name.toLowerCase().replace(/[\s-]+/g, "");

/** Peak-Regel eines Modells (Normalform) oder `undefined`. */
export function peakRuleFor(rules: PeakRules | undefined, name: string): PeakRule | undefined {
  return rules?.[normalizePeakModel(name)];
}

/** Feiertagskalender, den eine Regel referenziert (oder `undefined`). */
export function calendarFor(
  calendars: HolidayCalendars | undefined,
  rule: PeakRule | undefined,
): HolidayCalendar | undefined {
  const key = rule?.holidays?.calendar;
  return key ? calendars?.[key] : undefined;
}

// ---------------------------------------------------------------------------
// Zeit-/Zonen-Helfer (keine Browser-Zonen-Abhängigkeit)
// ---------------------------------------------------------------------------

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatters.set(timeZone, f);
  }
  return f;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = offsetFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    offsetFormatters.set(timeZone, f);
  }
  return f;
}

function partsToMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

/** Lokales Kalenderdatum (`YYYY-MM-DD`) von `nowMs` in `timeZone`. */
export function localIsoDate(nowMs: number, timeZone: string): string {
  const m = partsToMap(dateFormatter(timeZone).formatToParts(new Date(nowMs)));
  return `${m.year}-${m.month}-${m.day}`;
}

/** ISO-Wochentag (1 = Montag … 7 = Sonntag) eines `YYYY-MM-DD`-Datums. */
export function isoWeekday(isoDate: string): number {
  const [y, mo, d] = isoDate.split("-").map(Number);
  const js = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = Sonntag
  return js === 0 ? 7 : js;
}

function addDaysIso(isoDate: string, n: number): string {
  const [y, mo, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Offset (ms) der Zone `timeZone` zum Zeitpunkt `ts`. */
function zoneOffsetMs(ts: number, timeZone: string): number {
  const m = partsToMap(offsetFormatter(timeZone).formatToParts(new Date(ts)));
  const asUtc = Date.UTC(
    Number(m.year),
    Number(m.month) - 1,
    Number(m.day),
    Number(m.hour) % 24,
    Number(m.minute),
    Number(m.second),
  );
  return asUtc - ts;
}

/** UTC-Millisekunden der lokalen Mitternacht von `isoDate` in `timeZone`. */
export function zonedMidnightUtc(isoDate: string, timeZone: string): number {
  const [y, mo, d] = isoDate.split("-").map(Number);
  const base = Date.UTC(y, mo - 1, d);
  let ts = base;
  for (let i = 0; i < 2; i++) ts = base - zoneOffsetMs(ts, timeZone);
  return ts;
}

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

/** Vor `effectiveFrom` gilt kein Peak (Vorlaufzeit). */
export function isBeforeEffectiveFrom(rule: PeakRule, nowMs: number): boolean {
  return typeof rule.effectiveFrom === "string" && nowMs < Date.parse(rule.effectiveFrom);
}

function utcHourOf(nowMs: number): number {
  return new Date(nowMs).getUTCHours();
}

function inPeakWindow(rule: PeakRule, nowMs: number): boolean {
  const hour = utcHourOf(nowMs);
  return rule.peak.windowsUtc.some(([start, end]) => hour >= start && hour < end);
}

/**
 * Ist `nowMs` gemäß `rule` Peak? (Spezifikation §2)
 * 1. Feiertag (in `rule.timezone`) → Off-Peak
 * 2. Wochentag in `peak.days` UND UTC-Stunde in einem Fenster → Peak
 * 3. sonst Off-Peak
 */
export function isPeakAt(rule: PeakRule, calendar: HolidayCalendar | undefined, nowMs: number): boolean {
  if (isBeforeEffectiveFrom(rule, nowMs)) return false;
  const localDay = localIsoDate(nowMs, rule.timezone);
  // optional: nur aktiv, wenn die Quelle Feiertage nennt (`rule.holidays` +
  // Kalender). Die OpenCode-Doku nennt keine → bei uns inert.
  if (rule.holidays?.policy === "off-peak" && calendar?.dates.includes(localDay)) return false;
  if (!rule.peak.days.includes(isoWeekday(localDay))) return false;
  return inPeakWindow(rule, nowMs);
}

/**
 * Nächster Zeitpunkt, an dem sich der Peak-Zustand ändert (oder `null`).
 *
 * Kandidaten sind die einzigen möglichen Übergänge: UTC-Fenster-Grenzen,
 * lokale Mitternachten der Regel-Zone (Wochentagswechsel) und Mitternachten
 * der Feiertage (Beginn/Ende). Der erste Kandidat mit echtem Zustandswechsel
 * gewinnt — Fenster-Grenzen an Off-Peak-Tagen erzeugen keinen (werden also
 * wie bisher herausgefiltert).
 */
export function nextTransition(
  rule: PeakRule,
  calendar: HolidayCalendar | undefined,
  nowMs: number,
  horizonDays = 9,
): number | null {
  const candidates = new Set<number>();
  const utcMidnight = (() => {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  })();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  for (let d = 0; d <= horizonDays; d++) {
    for (const [start, end] of rule.peak.windowsUtc) {
      candidates.add(utcMidnight + d * DAY_MS + start * HOUR_MS);
      candidates.add(utcMidnight + d * DAY_MS + end * HOUR_MS);
    }
  }
  const localToday = localIsoDate(nowMs, rule.timezone);
  for (let i = 0; i <= horizonDays; i++) {
    const day = addDaysIso(localToday, i);
    candidates.add(zonedMidnightUtc(day, rule.timezone));
    if (rule.holidays?.policy === "off-peak" && calendar?.dates.includes(day)) {
      candidates.add(zonedMidnightUtc(addDaysIso(day, 1), rule.timezone));
    }
  }
  if (typeof rule.effectiveFrom === "string") {
    const eff = Date.parse(rule.effectiveFrom);
    if (Number.isFinite(eff)) candidates.add(eff);
  }
  const current = isPeakAt(rule, calendar, nowMs);
  const sorted = [...candidates].filter((t) => t > nowMs).sort((a, b) => a - b);
  for (const t of sorted) {
    if (isPeakAt(rule, calendar, t) !== current) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lokalisierung (Labels aus den Daten generiert, keine hartkodierte Prosa)
// ---------------------------------------------------------------------------

export const WEEKDAY_SHORT: Record<"de" | "en", readonly string[]> = {
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

const TIMEZONE_LABELS: Record<string, { de: string; en: string }> = {
  "Asia/Shanghai": { de: "Peking-Zeit", en: "Beijing time" },
  "Asia/Singapore": { de: "Singapur-Zeit", en: "Singapore time" },
  UTC: { de: "UTC", en: "UTC" },
};

export function timezoneLabel(timeZone: string, lang: "de" | "en"): string {
  return TIMEZONE_LABELS[timeZone]?.[lang] ?? timeZone;
}

const CALENDAR_LABELS: Record<string, { de: string; en: string }> = {
  china: { de: "China", en: "China" },
};

export function calendarLabel(calendar: string, lang: "de" | "en"): string {
  return CALENDAR_LABELS[calendar]?.[lang] ?? calendar;
}

/** Wochentags-Scope aus `days` generieren: `Mo–Fr`, `Mo, Mi` oder `täglich`. */
export function formatDayScope(days: readonly number[], lang: "de" | "en"): string {
  const names = WEEKDAY_SHORT[lang];
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7 || sorted.length === 0) return lang === "de" ? "täglich" : "daily";
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous) return `${names[sorted[0] - 1]}–${names[sorted[sorted.length - 1] - 1]}`;
  return sorted.map((d) => names[d - 1]).join(", ");
}

/** Kompakte Tages-Liste aus `days` (`Sa/So`), z. B. für Wochenend-Hinweise. */
export function formatDayList(days: readonly number[], lang: "de" | "en"): string {
  const names = WEEKDAY_SHORT[lang];
  return [...new Set(days)].sort((a, b) => a - b).map((d) => names[d - 1]).join("/");
}
