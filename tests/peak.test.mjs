// Auswertungslogik der Peak-Regeln (Spezifikation §2). Läuft durch denselben
// Vite-SSR-Build wie die Tabellen-/Share-Tests → ein fehlender Export bricht
// den Build und damit diesen Test rot, statt erst im Browser aufzufallen.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import solid from "vite-plugin-solid";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "tests", ".ssr-peak");

let peak;
before(async () => {
  await build({
    configFile: false,
    root: ROOT,
    logLevel: "error",
    plugins: [solid({ ssr: true, generate: "ssr" })],
    build: {
      ssr: "tests/ssr-entry.tsx",
      outDir: OUT_DIR,
      emptyOutDir: true,
      copyPublicDir: false,
      minify: false,
      sourcemap: false,
    },
  });
  const entry = join(
    OUT_DIR,
    readdirSync(OUT_DIR).find((f) => f.startsWith("ssr-entry."))
  );
  peak = await import(pathToFileURL(entry).href);
});

// DeepSeek-Regel: Mo–Fr, Fenster 01–04 und 06–10 UTC, Sa/So ganz Off-Peak.
const RULE = {
  timezone: "Asia/Shanghai",
  peak: { days: [1, 2, 3, 4, 5], windowsUtc: [[1, 4], [6, 10]] },
  offPeak: { days: [6, 7], allDay: true },
};
// Synthetischer Kalender nur für den Nachweis, dass die optionale
// Feiertagslogik lebt — die OpenCode-Doku nennt keine Feiertage, `data/latest.json`
// führt deshalb weder `holidays` noch `holidayCalendars`.
const HOLIDAY_CAL = { dates: ["2026-10-01", "2026-10-02"], coveredThrough: "2026-12-31" };

test("isPeakAt: Werktag im Fenster → Peak", () => {
  // Mittwoch 2026-09-30 02:00 UTC = 10:00 Shanghai.
  assert.equal(peak.isPeakAt(RULE, undefined, Date.UTC(2026, 8, 30, 2, 0)), true);
});

test("isPeakAt: Werktag außerhalb der Fenster → Off-Peak", () => {
  assert.equal(peak.isPeakAt(RULE, undefined, Date.UTC(2026, 8, 30, 5, 0)), false);
  assert.equal(peak.isPeakAt(RULE, undefined, Date.UTC(2026, 8, 30, 23, 0)), false);
});

test("isPeakAt: Wochenende → Off-Peak (auch im Fenster)", () => {
  // Samstag 2026-10-03 02:00 UTC.
  assert.equal(peak.isPeakAt(RULE, undefined, Date.UTC(2026, 9, 3, 2, 0)), false);
});

test("isPeakAt: Feiertag 01.10.2026 gilt als normaler Werktag (Quelle nennt keine Feiertage)", () => {
  // 2026-10-01 ist ein Donnerstag → innerhalb des Fensters Peak (kein Feiertag
  // in den Daten).
  assert.equal(peak.isPeakAt(RULE, undefined, Date.UTC(2026, 9, 1, 2, 0)), true);
  // Die optionale Logik lebt weiter: mit `holidays` + Kalender wäre derselbe
  // Zeitpunkt Off-Peak.
  const rule = { ...RULE, holidays: { policy: "off-peak", calendar: "china" } };
  assert.equal(peak.isPeakAt(rule, undefined, Date.UTC(2026, 9, 1, 2, 0)), true, "ohne Kalender Peak");
  assert.equal(peak.isPeakAt(rule, HOLIDAY_CAL, Date.UTC(2026, 9, 1, 2, 0)), false, "mit Kalender Off-Peak");
});

test("isPeakAt: vor effectiveFrom kein Peak", () => {
  const rule = {
    ...RULE,
    effectiveFrom: "2026-08-23T00:00:00+08:00",
    peak: { days: [1, 2, 3, 4, 5], windowsUtc: [[1, 4]] },
  };
  // Donnerstag 2026-08-20 02:00 UTC liegt vor dem 23.08. → kein Peak
  assert.equal(peak.isBeforeEffectiveFrom(rule, Date.UTC(2026, 7, 20, 2, 0)), true);
  assert.equal(peak.isPeakAt(rule, undefined, Date.UTC(2026, 7, 20, 2, 0)), false);
  // Montag 2026-08-24 02:00 UTC liegt danach → Peak
  assert.equal(peak.isPeakAt(rule, undefined, Date.UTC(2026, 7, 24, 2, 0)), true);
});

test("Zonenrand: Wochentag wird in der Regel-Zone gebildet (16:30 UTC = 00:30 Shanghai)", () => {
  // Sonntag 2026-09-27 16:30 UTC = Montag 2026-09-28 00:30 Shanghai.
  assert.equal(peak.localIsoDate(Date.UTC(2026, 8, 27, 16, 30), "Asia/Shanghai"), "2026-09-28");
  assert.equal(peak.isoWeekday("2026-09-28"), 1);
  assert.equal(peak.isoWeekday("2026-09-27"), 7);
  // Regel mit Montags-Fenster 16–17 UTC: in UTC wäre es Sonntag (kein Peak),
  // in Shanghai Montag → Peak.
  const mondayRule = { timezone: "Asia/Shanghai", peak: { days: [1], windowsUtc: [[16, 17]] }, offPeak: { days: [2, 3, 4, 5, 6, 7], allDay: true } };
  assert.equal(peak.isPeakAt(mondayRule, undefined, Date.UTC(2026, 8, 27, 16, 30)), true);
});

test("nextTransition: findet Fensterende/-anfang und den Wochenend-Sprung", () => {
  // In einem Peak-Fenster → nächstes Ende.
  assert.equal(
    peak.nextTransition(RULE, undefined, Date.UTC(2026, 8, 30, 2, 0)),
    Date.UTC(2026, 8, 30, 4, 0)
  );
  // Zwischen den Fenstern → nächster Anfang.
  assert.equal(
    peak.nextTransition(RULE, undefined, Date.UTC(2026, 8, 30, 5, 0)),
    Date.UTC(2026, 8, 30, 6, 0)
  );
  // Freitag nach dem letzten Fenster → Montag 01:00 UTC (Wochenende off-peak).
  assert.equal(
    peak.nextTransition(RULE, undefined, Date.UTC(2026, 9, 2, 11, 0)),
    Date.UTC(2026, 9, 5, 1, 0)
  );
});

test("formatDayScope/formatDayList: aus den Daten generiert", () => {
  assert.equal(peak.formatDayScope([1, 2, 3, 4, 5], "de"), "Mo–Fr");
  assert.equal(peak.formatDayScope([1, 2, 3, 4, 5], "en"), "Mon–Fri");
  assert.equal(peak.formatDayScope([1, 2, 3, 4, 5, 6, 7], "de"), "täglich");
  assert.equal(peak.formatDayScope([1, 2, 3, 4, 5, 6, 7], "en"), "daily");
  assert.equal(peak.formatDayScope([1, 3], "de"), "Mo, Mi");
  assert.equal(peak.formatDayList([6, 7], "de"), "Sa/So");
  assert.equal(peak.formatDayList([6, 7], "en"), "Sat/Sun");
});

test("peakRuleFor/calendarFor: Zuordnung über die Normalform", () => {
  const rules = { "deepseekv4.1flash": RULE };
  assert.equal(peak.peakRuleFor(rules, "DeepSeek V4.1 Flash"), RULE);
  assert.equal(peak.peakRuleFor(rules, "DeepSeek V4 Flash"), undefined);
  const withHolidays = { ...RULE, holidays: { policy: "off-peak", calendar: "china" } };
  assert.equal(peak.calendarFor({ china: HOLIDAY_CAL }, withHolidays), HOLIDAY_CAL);
  assert.equal(peak.calendarFor({ china: HOLIDAY_CAL }, RULE), undefined);
});

test("Footer: keine Feiertags-Zeile (Zeilensatz entfernt, strikt quellenbindend)", () => {
  const PLAN = {
    id: "go",
    name: "Go",
    priceMonthly: 10,
    creditsMonthly: 60,
    sourceUrl: "https://opencode.ai/docs/de/go/",
  };
  const base = {
    fetchedAt: "2026-09-30T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/docs/de/zen/",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    plans: [PLAN],
    models: [],
    freeModels: [],
  };
  // Selbst mit (synthetisch) referenziertem Kalender gibt es keine Zeile mehr.
  const referenced = {
    ...base,
    peakRules: { deepseekv4flash: { ...RULE, holidays: { policy: "off-peak", calendar: "china" } } },
    holidayCalendars: { china: HOLIDAY_CAL },
  };
  for (const lang of ["de", "en"]) {
    const html = peak.renderFooter(referenced, lang);
    assert.doesNotMatch(html, /Feiertagskalender|holiday calendar/);
    assert.doesNotMatch(html, /Abdeckung beendet|coverage ended/);
  }
  // Der bestehende `Stand`-Hinweis bleibt.
  assert.match(peak.renderFooter({ ...base, peakRules: {} }, "de"), /Stand/);
});
