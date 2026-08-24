import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import {
  parseHtml,
  computeDiff,
  buildChanges,
  upsertChangelogJson,
  mergeChanges,
  splitChange,
  mergeFreeModels,
  validateSnapshot,
  validateChangelog,
  modelKey,
  extractFreeModels,
  patternPartMatches,
  enrichCapabilities,
  computeCapabilityDiff,
  enrichFreeModels,
  parseUsageBonuses,
  applyUsageBonuses,
  parseMonthlyCost,
  parseCreditFactor,
  parseMonthlyPricing,
  parsePeakHours,
  recomputeUsageDerived,
} from "../scripts/scrape.mjs";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "go-de.html"),
  "utf8"
);

const bonusFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "go-de-bonus.html"),
  "utf8"
);

const loadBonusFixture = () => cheerio.load(bonusFixture);

test("parseHtml: extrahiert 23 Modelle aus dem HTML-Dump", () => {
  const models = parseHtml(fixture);
  assert.equal(models.length, 23);
  for (const m of models) {
    assert.equal(typeof m.name, "string");
    assert.equal(typeof m.usage, "number");
    assert.equal(typeof m.multiplier, "number");
    assert.ok(Array.isArray([m.input, m.output, m.cachedRead, m.cachedWrite]));
  }
});

test("parseHtml: Grok 4.5 mit $15-Nutzung und ×4-Multiplikator", () => {
  const grok = parseHtml(fixture).find((m) => m.name === "Grok 4.5");
  assert.equal(grok.input, 2);
  assert.equal(grok.output, 6);
  assert.equal(grok.cachedRead, 0.3);
  assert.equal(grok.cachedWrite, null);
  assert.equal(grok.usage, 15);
  assert.equal(grok.multiplier, 4);
  assert.equal(grok.effectiveInput, 8);
  assert.equal(grok.effectiveOutput, 24);
  assert.equal(grok.effectiveCachedRead, 1.2);
  assert.equal(grok.effectiveCachedWrite, null);
});

test("parseHtml: DeepSeek V4 Flash mit $60-Nutzung und ×1", () => {
  const flash = parseHtml(fixture).find((m) => m.name === "DeepSeek V4 Flash");
  assert.equal(flash.input, 0.14);
  assert.equal(flash.output, 0.28);
  assert.equal(flash.usage, 60);
  assert.equal(flash.multiplier, 1);
  assert.equal(flash.effectiveInput, 0.14);
});

test("parsePeakHours: ordnet den gemeinsamen Flash/Pro-Hinweis beiden Modellen zu", () => {
  const $ = cheerio.load(
    "<main><p><strong>DeepSeek V4 Flash / Pro:</strong> Peak hours are 01:00-04:00 and 06:00-10:00 UTC; all other hours are Off-Peak.</p></main>"
  );
  const models = [
    { name: "DeepSeek V4 Flash", tier: "Off-Peak" },
    { name: "DeepSeek V4 Flash", tier: "Peak" },
    { name: "DeepSeek V4 Pro", tier: "Off-Peak" },
    { name: "DeepSeek V4 Pro", tier: "Peak" },
  ];
  assert.deepEqual(parsePeakHours($, models), {
    deepseekv4flash: [[1, 4], [6, 10]],
    deepseekv4pro: [[1, 4], [6, 10]],
  });
});

test("parseHtml: MiMo V2.5 Pro mit kleinen Preisen und ×4", () => {
  const pro = parseHtml(fixture).find((m) => m.name === "MiMo V2.5 Pro");
  assert.equal(pro.input, 0.435);
  assert.equal(pro.cachedRead, 0.003625);
  assert.equal(pro.usage, 15);
  assert.equal(pro.multiplier, 4);
  assert.equal(pro.effectiveInput, 1.74);
  assert.equal(pro.effectiveCachedRead, 0.0145);
});

test("parseHtml: Tier-Splitting bei GPT 5.6 Luna", () => {
  const models = parseHtml(fixture);
  const tiers = models
    .filter((m) => m.name === "GPT 5.6 Luna")
    .map((m) => m.tier)
    .sort();
  assert.deepEqual(tiers, ["> 272K tokens", "≤ 272K tokens"]);
  assert.equal(modelKey(models.find((m) => m.tier === "≤ 272K tokens")), "GPT 5.6 Luna (≤ 272K tokens)");
});

test("parseHtml: pro-Modell-Anfragemuster aus der Doku", () => {
  const models = parseHtml(fixture);
  const by = (name) => models.find((m) => m.name === name);
  assert.deepEqual(by("Grok 4.5").pattern, { input: 1100, cachedRead: 71500, output: 220 });
  assert.deepEqual(by("DeepSeek V4 Flash").pattern, { input: 790, cachedRead: 68000, output: 280 });
  assert.deepEqual(by("GLM-5.1").pattern, { input: 700, cachedRead: 52000, output: 150 });
  assert.deepEqual(by("Kimi K2.6").pattern, { input: 870, cachedRead: 55000, output: 200 });
  assert.deepEqual(by("MiMo V2.5 Pro").pattern, { input: 790, cachedRead: 86000, output: 305 });
  assert.deepEqual(by("MiniMax M2.5").pattern, { input: 300, cachedRead: 55000, output: 125 });
  for (const l of models.filter((m) => m.name === "GPT 5.6 Luna")) {
    assert.deepEqual(l.pattern, { input: 1000, cachedRead: 50000, output: 220 });
  }
});

test("parseHtml: wirft bei fehlender Preistabelle", () => {
  assert.throws(() => parseHtml("<html><body><h1>nix</h1></body></html>"));
});

test("parseHtml: wirft bei unparsebarem Preis", () => {
  const broken = `
    <html><body><main>
      <table>
        <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Nutzung</th></tr></thead>
        <tbody><tr><td>Test Model</td><td>$abc</td><td>$1</td><td>-</td><td>-</td><td>$60</td></tr></tbody>
      </table>
    </main></body></html>`;
  assert.throws(() => parseHtml(broken));
});

test("parseHtml: Datenschutz — Grok 4.5 mit 30 Tagen Aufbewahrung", () => {
  const grok = parseHtml(fixture).find((m) => m.name === "Grok 4.5");
  assert.deepEqual(grok.privacy, { training: false, retentionDays: 30, validUntil: null });
});

test("parseHtml: Datenschutz — ZDR-Modelle mit true (0 Tage)", () => {
  const glm = parseHtml(fixture).find((m) => m.name === "GLM-5.2");
  assert.deepEqual(glm.privacy, { training: false, retentionDays: true, validUntil: null });
});

test("parseHtml: Datenschutz — DeepSeek V4 Flash mit gültig-bis-Datum", () => {
  const flash = parseHtml(fixture).find((m) => m.name === "DeepSeek V4 Flash");
  assert.deepEqual(flash.privacy, { training: false, retentionDays: true, validUntil: "2026-08-31" });
});

test("parseHtml: Datenschutz — Muse Spark 1.2 ohne ZDR ('Kein ZDR' → false)", () => {
  const muse = parseHtml(fixture).find((m) => m.name === "Muse Spark 1.2");
  assert.deepEqual(muse.privacy, { training: true, retentionDays: false, validUntil: null });
});

test("parseHtml: Datenschutz — unbekannte Aufbewahrung ('–') lässt retentionDays weg", () => {
  const html = `
    <html><body><main>
      <table>
        <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Nutzung</th></tr></thead>
        <tbody><tr><td>Alpha</td><td>$1</td><td>$1</td><td>-</td><td>-</td><td>$60</td></tr></tbody>
      </table>
      <table>
        <thead><tr><th>Modell</th><th>Modelltraining</th><th>Datenaufbewahrung</th></tr></thead>
        <tbody><tr><td>Alpha</td><td>Nicht verwendet</td><td>–</td></tr></tbody>
      </table>
    </main></body></html>`;
  const privacy = parseHtml(html)[0].privacy;
  assert.equal(privacy.training, false);
  assert.equal(privacy.retentionDays, undefined);
});

test("parseHtml: Datenschutz — Luna (beide Tiers) aus einer Tabellenzeile", () => {
  const luna = parseHtml(fixture).filter((m) => m.name === "GPT 5.6 Luna");
  assert.equal(luna.length, 2);
  for (const l of luna) {
    assert.deepEqual(l.privacy, { training: false, retentionDays: 30, validUntil: null });
  }
});

test("parseHtml: Datenschutz — MiniMax M2.5 übernimmt Familien-Fallback von M2.7", () => {
  const mimo = parseHtml(fixture).find((m) => m.name === "MiniMax M2.5");
  assert.deepEqual(mimo.privacy, {
    training: false,
    retentionDays: true,
    validUntil: null,
    fallback: true,
  });
});

test("parseHtml: Datenschutz — Modell ohne Zeile und ohne Fallback bleibt null", () => {
  const html = `
    <html><body><main>
      <table>
        <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Nutzung</th></tr></thead>
        <tbody><tr><td>Alpha</td><td>$1</td><td>$1</td><td>-</td><td>-</td><td>$60</td></tr></tbody>
      </table>
      <table>
        <thead><tr><th>Modell</th><th>Modelltraining</th><th>Datenaufbewahrung</th></tr></thead>
        <tbody><tr><td>Beta</td><td>Nicht verwendet</td><td>0 Tage</td></tr></tbody>
      </table>
    </main></body></html>`;
  assert.equal(parseHtml(html)[0].privacy, null);
});

test("parseHtml: wirft bei fehlender Datenschutz-Tabelle", () => {
  const html = `
    <html><body><main>
      <table>
        <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Nutzung</th></tr></thead>
        <tbody><tr><td>Test Model</td><td>$1</td><td>$1</td><td>-</td><td>-</td><td>$60</td></tr></tbody>
      </table>
    </main></body></html>`;
  assert.throws(() => parseHtml(html));
});

test("parseUsageBonuses: extrahiert 2x-usage-Boni aus der Landingpage", () => {
  const $ = loadBonusFixture();
  const bonuses = parseUsageBonuses($);
  assert.equal(bonuses.get("gpt5.6luna"), 2);
  assert.equal(bonuses.get("deepseekv4flash"), 2);
  assert.equal(bonuses.size, 2);
});

test("parseUsageBonuses: leere Map bei fehlenden Bonus-Elementen", () => {
  const $ = cheerio.load("<div><span data-item data-model='grok-4.5'><span data-value>1</span></span></div>");
  assert.deepEqual([...parseUsageBonuses($).entries()], []);
});

test("applyUsageBonuses: verdoppelt usage und berechnet Effektivpreise neu", () => {
  const models = parseHtml(fixture);
  const bonuses = new Map([
    ["gpt5.6luna", 2],
    ["deepseekv4flash", 2],
  ]);
  applyUsageBonuses(models, bonuses);

  const luna = models.filter((m) => m.name === "GPT 5.6 Luna");
  assert.equal(luna.length, 2);
  for (const l of luna) {
    assert.equal(l.usage, 30);
    assert.equal(l.multiplier, 2);
  }
  assert.equal(luna.find((m) => m.tier === "≤ 272K tokens").effectiveInput, 0.4);
  assert.equal(luna.find((m) => m.tier === "≤ 272K tokens").effectiveOutput, 2.4);
  assert.equal(luna.find((m) => m.tier === "≤ 272K tokens").effectiveCachedWrite, 0.5);
  assert.equal(luna.find((m) => m.tier === "> 272K tokens").effectiveInput, 0.8);
  assert.equal(luna.find((m) => m.tier === "> 272K tokens").effectiveCachedWrite, 1);

  const flash = models.find((m) => m.name === "DeepSeek V4 Flash");
  assert.equal(flash.usage, 120);
  assert.equal(flash.multiplier, 0.5);
  assert.equal(flash.effectiveInput, 0.07);
  assert.equal(flash.effectiveOutput, 0.14);
  assert.equal(flash.effectiveCachedRead, 0.0014);
});

test("applyUsageBonuses: lässt Modelle ohne Bonus unverändert", () => {
  const models = parseHtml(fixture);
  applyUsageBonuses(models, new Map([["gpt5.6luna", 2]]));
  const grok = models.find((m) => m.name === "Grok 4.5");
  assert.equal(grok.usage, 15);
  assert.equal(grok.multiplier, 4);
  assert.equal(models.find((m) => m.name === "DeepSeek V4 Flash").usage, 60);
});

test("parseMonthlyPricing: Doku-Fixture liefert $10/Monat und Faktor 6", () => {
  const pricing = parseMonthlyPricing(cheerio.load(fixture));
  assert.deepEqual(pricing, { monthlyCost: 10, creditFactor: 6 });
});

test("parseMonthlyPricing: Landing-Fixture liefert $10/Monat aus dem CTA, keinen Faktor", () => {
  const pricing = parseMonthlyPricing(loadBonusFixture());
  assert.deepEqual(pricing, { monthlyCost: 10, creditFactor: null });
});

test("parseMonthlyPricing: Monatsguthaben = Monatspreis × Faktor (10 × 6 = 60)", () => {
  const landing = parseMonthlyPricing(loadBonusFixture());
  const docs = parseMonthlyPricing(cheerio.load(fixture));
  const monthlyCost = landing.monthlyCost ?? docs.monthlyCost;
  const creditFactor = docs.creditFactor ?? landing.creditFactor;
  assert.equal(monthlyCost, 10);
  assert.equal(monthlyCost * creditFactor, 60);
});

test("parseMonthlyPricing: fehlende Werte → null statt Fehler (Fallback-Pfad)", () => {
  const $ = cheerio.load("<html><body><p>Keine Preise hier.</p></body></html>");
  assert.deepEqual(parseMonthlyPricing($), { monthlyCost: null, creditFactor: null });
});

test("parseMonthlyCost: existierendes, aber unparsebares CTA-Element wirft", () => {
  const $ = cheerio.load('<span data-slot="cta-price-old">kostenlos</span>');
  assert.throws(() => parseMonthlyCost($), /unparsebar/);
});

test("parseMonthlyCost: cta-price-old (regulärer Preis) schlägt cta-price-new (Einführungspreis)", () => {
  const $ = cheerio.load(
    '<span data-slot="cta-price"><span data-slot="cta-price-old">$10/Monat</span><span data-slot="cta-price-new">$5 im ersten Monat</span></span>'
  );
  assert.equal(parseMonthlyCost($), 10);
});

test("parseMonthlyCost: schlankes cta-price ohne old/new-Children wird geparst", () => {
  const $ = cheerio.load('<span data-slot="cta-price">$10/Monat</span>');
  assert.equal(parseMonthlyCost($), 10);
});

test("parseCreditFactor: numerischer Faktor (das 6-fache) wird geparst", () => {
  const $ = cheerio.load("<p>unser Ziel ist, dir dafür das 6-fache dieses Betrags zu bieten.</p>");
  assert.equal(parseCreditFactor($), 6);
});

test("parseCreditFactor: unbekannter Faktor bei vorhandenem Satz wirft", () => {
  const $ = cheerio.load("<p>das Elffache dieses Betrags</p>");
  assert.throws(() => parseCreditFactor($), /unparsebar/);
});

test("applyUsageBonuses: monthlyCredit-Parameter fließt in multiplier und Effektivpreise ein", () => {
  const models = parseHtml(fixture);
  applyUsageBonuses(models, new Map([["deepseekv4flash", 2]]), 75);
  const flash = models.find((m) => m.name === "DeepSeek V4 Flash");
  assert.equal(flash.usage, 120);
  assert.equal(flash.multiplier, 0.625);
  assert.equal(flash.effectiveInput, 0.14 * (75 / 120));
});

const base = [
  { name: "Alpha", tier: null, usage: 60, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null },
  { name: "Beta", tier: null, usage: 15, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null },
];

test("computeDiff: erkennt hinzugefügte und entfernte Modelle", () => {
  const next = [
    ...base,
    { name: "Gamma", tier: null, usage: 60, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null },
  ];
  const diff = computeDiff(base, next);
  assert.deepEqual(diff.added, ["Gamma"]);
  assert.deepEqual(diff.removed, []);
  const removed = computeDiff(next, base);
  assert.deepEqual(removed.removed, ["Gamma"]);
});

test("computeDiff: erkennt Nutzungsverbesserung als komplette Pricing-Änderung", () => {
  const next = [{ ...base[0] }, { ...base[1], usage: 60 }];
  const diff = computeDiff(base, next);
  assert.deepEqual(diff.changed, [
    {
      key: "Beta",
      offPeak: false,
      from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 15 },
      to: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 },
    },
  ]);
});

test("computeDiff: erkennt Preisänderung mit Float-Toleranz", () => {
  const next = [{ ...base[0], input: 1.0000000001 }, { ...base[1] }];
  assert.equal(computeDiff(base, next).changed.length, 0);
  const changed = [{ ...base[0], input: 1.5 }, { ...base[1] }];
  const diff = computeDiff(base, changed);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].key, "Alpha");
  assert.equal(diff.changed[0].from.input, 1);
  assert.equal(diff.changed[0].to.input, 1.5);
});

test("buildChanges: Baseline ohne Vorgänger erzeugt keinen Eintrag", () => {
  assert.deepEqual(buildChanges(null, base, [], []), []);
});

test("buildChanges: Off-Peak-Stufe gilt als Normal-Nutzung (kein add/remove, Preisänderung)", () => {
  const prev = [{ name: "Delta", tier: null, usage: 15, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const next = [
    { name: "Delta", tier: "Off-Peak", usage: 15, input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null },
    { name: "Delta", tier: "Peak", usage: 15, input: 3, output: 4, cachedRead: 0.2, cachedWrite: null },
  ];
  const changes = buildChanges(prev, next, [], []);
  assert.deepEqual(changes, [
    {
      type: "model_added",
      model: "Delta (Peak)",
      pricing: { input: 3, output: 4, cachedRead: 0.2, cachedWrite: null, usage: 15 },
    },
    {
      type: "price_changed",
      model: "Delta",
      from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 15 },
      to: { input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 15 },
      fields: ["input"],
    },
  ]);
});

test("buildChanges: Off-Peak mit Preis- UND Nutzungsänderung wird zu EINEM price_changed (kein usage_changed)", () => {
  const prev = [{ name: "Delta", tier: null, usage: 120, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const next = [
    { name: "Delta", tier: "Off-Peak", usage: 15, input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null },
    { name: "Delta", tier: "Peak", usage: 15, input: 3, output: 4, cachedRead: 0.2, cachedWrite: null },
  ];
  const changes = buildChanges(prev, next, [], []);
  assert.deepEqual(changes, [
    {
      type: "model_added",
      model: "Delta (Peak)",
      pricing: { input: 3, output: 4, cachedRead: 0.2, cachedWrite: null, usage: 15 },
    },
    {
      type: "price_changed",
      model: "Delta",
      from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 120 },
      to: { input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 15 },
      fields: ["input"],
    },
  ]);
});

test("buildChanges: Off-Peak mit NUR Nutzungsänderung erzeugt usage_changed (kein Event-Verlust)", () => {
  // Gleiches Token-Budget pro Anfrage, nur die Nutzung ändert sich 15 → 30:
  // Peak UND Off-Peak müssen beide ein `usage_changed` bekommen (Regression: 2026-08-17).
  const prev = [
    { name: "Delta", tier: "Off-Peak", usage: 15, input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null },
    { name: "Delta", tier: "Peak", usage: 15, input: 3, output: 4, cachedRead: 0.2, cachedWrite: null },
  ];
  const next = [
    { name: "Delta", tier: "Off-Peak", usage: 30, input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null },
    { name: "Delta", tier: "Peak", usage: 30, input: 3, output: 4, cachedRead: 0.2, cachedWrite: null },
  ];
  const changes = buildChanges(prev, next, [], []);
  assert.deepEqual(changes, [
    { type: "usage_changed", model: "Delta", from: 15, to: 30 },
    { type: "usage_changed", model: "Delta (Peak)", from: 15, to: 30 },
  ]);
});

test("buildChanges: Modell hinzugefügt (mit Pricing) und Nutzung verschlechtert", () => {
  const next = [
    { ...base[0], usage: 15 },
    { ...base[1] },
    { name: "Gamma", tier: null, usage: 60, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null },
  ];
  const changes = buildChanges(base, next, [], []);
  assert.deepEqual(changes, [
    {
      type: "model_added",
      model: "Gamma",
      pricing: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 },
    },
    {
      type: "usage_changed",
      model: "Alpha",
      from: 60,
      to: 15,
    },
  ]);
});

test("buildChanges: Preisänderung enthält alte und neue Pricing-Zeile mit fields", () => {
  const next = [{ ...base[0], input: 1.5 }, { ...base[1] }];
  const changes = buildChanges(base, next, [], []);
  assert.deepEqual(changes, [
    {
      type: "price_changed",
      model: "Alpha",
      from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 },
      to: { input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 },
      fields: ["input"],
    },
  ]);
});

test("splitChange: nur Nutzung → usage_changed, nur Preis → price_changed", () => {
  const p = (o) => ({ input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60, ...o });
  assert.deepEqual(splitChange({ key: "Alpha", from: p({}), to: p({ usage: 120 }) }), [
    { type: "usage_changed", model: "Alpha", from: 60, to: 120 },
  ]);
  assert.deepEqual(splitChange({ key: "Alpha", from: p({}), to: p({ cachedRead: 0.5 }) }), [
    { type: "price_changed", model: "Alpha", from: p({}), to: p({ cachedRead: 0.5 }), fields: ["cachedRead"] },
  ]);
});

test("splitChange: Preis UND Nutzung ändern sich → zwei Events", () => {
  const from = { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 };
  const to = { input: 1, output: 2, cachedRead: 0.5, cachedWrite: null, usage: 120 };
  assert.deepEqual(splitChange({ key: "Alpha", from, to }), [
    { type: "price_changed", model: "Alpha", from, to, fields: ["cachedRead"] },
    { type: "usage_changed", model: "Alpha", from: 60, to: 120 },
  ]);
});

test("splitChange: mehrere Preisfelder werden aufgelistet, Float-Toleranz zählt gleich", () => {
  const from = { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 };
  const to = { input: 1.0000000001, output: 2, cachedRead: 0.05, cachedWrite: 0.3, usage: 60 };
  assert.deepEqual(splitChange({ key: "Alpha", from, to }), [
    { type: "price_changed", model: "Alpha", from, to, fields: ["cachedRead", "cachedWrite"] },
  ]);
});

test("buildChanges: keine Änderungen", () => {
  assert.deepEqual(buildChanges(base, base, [], []), []);
});

test("buildChanges: entferntes Modell mit Tagen aus firstSeen", () => {
  const firstSeen = new Map([["Alpha", "2026-08-01"]]);
  const changes = buildChanges(base, [base[1]], [], [], "2026-08-06", firstSeen);
  assert.deepEqual(changes, [
    {
      type: "model_removed",
      model: "Alpha",
      days: 5,
      pricing: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 },
    },
  ]);
});

test("buildChanges: kostenlose Modelle hinzugefügt/entfernt", () => {
  const prevFree = [{ id: "a-free", availableFrom: "2026-08-01" }];
  const nextFree = [
    { id: "a-free", availableFrom: "2026-08-01" },
    { id: "big-pickle", availableFrom: "2026-08-05", name: "Big Pickle" },
  ];
  // Mit models.dev-Namen → `name` im Event (z. B. x-preview-f-free → „Ox Alpha Free").
  const added = buildChanges(base, base, prevFree, nextFree, "2026-08-06");
  assert.deepEqual(added, [{ type: "free_added", model: "big-pickle", name: "Big Pickle" }]);

  // Ohne Namen → kein `name`-Feld (Rückfall in der UI auf die pretty ID).
  const removed = buildChanges(base, base, prevFree, [], "2026-08-06");
  assert.deepEqual(removed, [
    { type: "free_removed", model: "a-free", availableFrom: "2026-08-01", until: "2026-08-06" },
  ]);
});

test("mergeFreeModels: übernimmt availableFrom und setzt für neue Modelle das Datum", () => {
  const merged = mergeFreeModels(
    [{ id: "a-free", availableFrom: "2026-08-01" }],
    ["a-free", "big-pickle"],
    "2026-08-05"
  );
  assert.deepEqual(merged, [
    { id: "a-free", availableFrom: "2026-08-01" },
    { id: "big-pickle", availableFrom: "2026-08-05" },
  ]);
});

test("extractFreeModels: filtert free-Modelle und big-pickle", () => {
  const ids = ["gpt-5", "deepseek-v4-flash-free", "big-pickle", "mimo-v2.5-free", "grok-4.5", "big-pickle"];
  assert.deepEqual(extractFreeModels(ids), ["big-pickle", "deepseek-v4-flash-free", "mimo-v2.5-free"]);
});

test("upsertChangelogJson: ersetzt Eintrag mit gleicher id und entfernt leere Einträge", () => {
  const existing = {
    entries: [
      { id: "2026-08-06T00-00-00Z", date: "2026-08-06", changes: [] },
      { id: "2026-08-05T00-00-00Z", date: "2026-08-05", changes: [{ type: "text", lang: { de: "Alt", en: "Old" } }] },
      { id: "2026-08-04T00-00-00Z", date: "2026-08-04", changes: [] },
      { id: "2026-08-03T00-00-00Z", date: "2026-08-03", changes: [{ type: "text", lang: { de: "Uralt", en: "Ancient" } }] },
    ],
  };
  const result = upsertChangelogJson(existing, "2026-08-05T00-00-00Z", "2026-08-05", [
    { type: "text", lang: { de: "Neu", en: "New" } },
  ]);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].id, "2026-08-05T00-00-00Z");
  assert.deepEqual(result.entries[0].changes, [{ type: "text", lang: { de: "Neu", en: "New" } }]);
  assert.equal(result.entries[1].id, "2026-08-03T00-00-00Z");
});

test("upsertChangelogJson: fügt bei leeren Änderungen keinen Eintrag hinzu", () => {
  const existing = {
    entries: [{ id: "2026-08-05T00-00-00Z", date: "2026-08-05", changes: [{ type: "text", lang: { de: "x", en: "x" } }] }],
  };
  const result = upsertChangelogJson(existing, "2026-08-06T00-00-00Z", "2026-08-06", []);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, "2026-08-05T00-00-00Z");
});

test("upsertChangelogJson: leere Änderungen ersetzen den Eintrag derselben id nicht", () => {
  const existing = {
    entries: [
      {
        id: "2026-08-07T00-00-00Z",
        date: "2026-08-07",
        changes: [
          {
            type: "usage_changed",
            model: "DeepSeek V4 Flash",
            from: 60,
            to: 120,
          },
        ],
      },
      { id: "2026-08-05T00-00-00Z", date: "2026-08-05", changes: [{ type: "text", lang: { de: "Initialversion", en: "Initial version" } }] },
    ],
  };
  const result = upsertChangelogJson(existing, "2026-08-07T00-00-00Z", "2026-08-07", []);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].id, "2026-08-07T00-00-00Z");
  assert.equal(result.entries[0].changes[0].model, "DeepSeek V4 Flash");
});

test("validateChangelog: gültiger Changelog mit allen Event-Typen", () => {
  const changelog = {
    entries: [
      {
        id: "2026-08-05T00-00-00Z",
        date: "2026-08-05",
        changes: [{ type: "text", lang: { de: "Initialversion", en: "Initial version" } }],
      },
      {
        id: "2026-08-06T00-00-00Z",
        date: "2026-08-06",
        changes: [
          {
            type: "model_added",
            model: "Gamma",
            pricing: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 },
          },
          {
            type: "model_removed",
            model: "Alpha",
            days: 5,
            pricing: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 },
          },
          {
            type: "price_changed",
            model: "Beta",
            from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 15 },
            to: { input: 1, output: 2, cachedRead: 0.5, cachedWrite: null, usage: 15 },
            fields: ["cachedRead"],
          },
          {
            type: "usage_changed",
            model: "Beta",
            from: 15,
            to: 60,
          },
          {
            type: "capabilities_changed",
            model: "Grok 4.5",
            from: null,
            to: { input: ["text", "image"], output: ["text"], reasoning: true, toolCall: true },
          },
          {
            type: "privacy_changed",
            model: "DeepSeek V4 Flash",
            from: { training: false, retentionDays: 0, validUntil: "2026-08-31" },
            to: { training: false, retentionDays: 0, validUntil: "2026-09-30" },
          },
          { type: "free_added", model: "big-pickle" },
          { type: "free_removed", model: "a-free", availableFrom: "2026-08-01", until: "2026-08-06" },
        ],
      },
    ],
  };
  assert.doesNotThrow(() => validateChangelog(changelog));
});

test("validateChangelog: price_changed ohne fields bzw. usage_changed ungültig bricht", () => {
  assert.throws(() =>
    validateChangelog({
      entries: [
        {
          id: "2026-08-06T00-00-00Z",
          date: "2026-08-06",
          changes: [
            {
              type: "price_changed",
              model: "X",
              from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 },
              to: { input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 },
            },
          ],
        },
      ],
    })
  );
  assert.throws(() =>
    validateChangelog({
      entries: [
        {
          id: "2026-08-06T00-00-00Z",
          date: "2026-08-06",
          changes: [
            { type: "price_changed", model: "X", from: {}, to: {}, fields: [] },
          ],
        },
      ],
    })
  );
  assert.throws(() =>
    validateChangelog({
      entries: [
        {
          id: "2026-08-06T00-00-00Z",
          date: "2026-08-06",
          changes: [{ type: "usage_changed", model: "X", from: -1, to: 60 }],
        },
      ],
    })
  );
});

test("mergeChanges: gleiche type+model → neuestes gewinnt, neue Events werden angehängt", () => {
  const a = { type: "price_changed", model: "Alpha", from: { input: 1 }, to: { input: 2 }, fields: ["input"] };
  const b = { type: "price_changed", model: "Alpha", from: { input: 2 }, to: { input: 1.5 }, fields: ["input"] };
  const c = { type: "usage_changed", model: "Alpha", from: 60, to: 120 };
  assert.deepEqual(mergeChanges([a], [b, c]), [b, c]);
  assert.deepEqual(mergeChanges([c], [a]), [c, a]);
});

test("mergeChanges: verschiedene Typen/Modelle bleiben erhalten, ersetzte behalten Position", () => {
  const a = { type: "free_added", model: "big-pickle" };
  const b = { type: "price_changed", model: "Alpha", from: { input: 1 }, to: { input: 2 }, fields: ["input"] };
  const c = { type: "text", lang: { de: "x", en: "x" } };
  const d = { type: "text", lang: { de: "y", en: "y" } };
  assert.deepEqual(mergeChanges([a, c], [b, d]), [a, d, b]);
});

test("upsertChangelogJson: verschiedene Run-ids → eigene Einträge (kein Day-Merge)", () => {
  const existing = {
    entries: [
      {
        id: "2026-08-07T06-00-00Z",
        date: "2026-08-07",
        changes: [{ type: "usage_changed", model: "Alpha", from: 60, to: 120 }],
      },
    ],
  };
  const result = upsertChangelogJson(
    existing,
    "2026-08-07T14-00-00Z",
    "2026-08-07",
    [{ type: "free_added", model: "big-pickle" }, { type: "usage_changed", model: "Alpha", from: 120, to: 60 }]
  );
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].id, "2026-08-07T14-00-00Z");
  assert.equal(result.entries[1].id, "2026-08-07T06-00-00Z");
});

test("upsertChangelogJson: gleiche Run-id ersetzt den Eintrag idempotent (kein Duplikat)", () => {
  const existing = {
    entries: [
      {
        id: "2026-08-07T06-00-00Z",
        date: "2026-08-07",
        changes: [{ type: "usage_changed", model: "Alpha", from: 60, to: 120 }],
      },
    ],
  };
  // Wiederholung desselben Run-`id` mit identischen Änderungen → kein neuer
  // Eintrag, keine Verdopplung der Events.
  const result = upsertChangelogJson(existing, "2026-08-07T06-00-00Z", "2026-08-07", [
    { type: "usage_changed", model: "Alpha", from: 60, to: 120 },
  ]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, "2026-08-07T06-00-00Z");
  assert.equal(result.entries[0].changes.length, 1);
  assert.equal(result.entries[0].changes[0].type, "usage_changed");
});

test("validateChangelog: leere Einträge, unbekannte Typen und fehlende Felder brechen", () => {
  assert.throws(() => validateChangelog({ entries: [{ id: "2026-08-06T00-00-00Z", date: "2026-08-06", changes: [] }] }));
  assert.throws(() =>
    validateChangelog({ entries: [{ id: "2026-08-06T00-00-00Z", date: "2026-08-06", changes: [{ type: "baseline", modelCount: 1 }] }] })
  );
  assert.throws(() =>
    validateChangelog({ entries: [{ id: "2026-08-06T00-00-00Z", date: "2026-08-06", changes: [{ type: "model_added", model: "X" }] }] })
  );
  assert.throws(() =>
    validateChangelog({ entries: [{ id: "2026-08-06T00-00-00Z", date: "2026-08-06", changes: [{ type: "text", text: "no lang map" }] }] })
  );
  assert.throws(() =>
    validateChangelog({
      entries: [{ id: "2026-08-06T00-00-00Z", date: "2026-08-06", changes: [{ type: "model_removed", model: "X", days: -1 }] }],
    })
  );
  assert.throws(() =>
    validateChangelog({
      entries: [
        {
          id: "2026-08-06T00-00-00Z",
          date: "2026-08-06",
          changes: [
            { type: "capabilities_changed", model: "X", from: null, to: { input: ["text"] } },
          ],
        },
      ],
    })
  );
});

test("patternPartMatches: härtet gegen Kollisionen", () => {
  assert.equal(patternPartMatches("5.1", "glm5.1", "glm"), true);
  assert.equal(patternPartMatches("5.1", "glm5.10", "glm"), false);
  assert.equal(patternPartMatches("k2.6", "kimik2.6", "kimik"), true);
  assert.equal(patternPartMatches("kimik2.7", "kimik2.7code", "kimik"), true);
});

test("validateSnapshot: gültiger Snapshot (alle Modelle mit Token-Stats)", () => {
  const snapshot = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/zen/v1/models",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    monthlyCredit: 60,
    monthlyCost: 10,
    peakHours: {},
    models: parseHtml(fixture),
    freeModels: [
      {
        id: "big-pickle",
        availableFrom: "2026-08-05",
        capabilities: null,
        privacy: { training: true, validUntil: null },
      },
    ],
  };
  assert.doesNotThrow(() => validateSnapshot(snapshot));
});

test("validateSnapshot: fehlende Token-Stats (pattern) brechen die Validierung", () => {
  const models = parseHtml(fixture);
  const withoutPattern = { ...models[0], pattern: null };
  const snapshot = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/zen/v1/models",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    monthlyCredit: 60,
    monthlyCost: 10,
    models: [withoutPattern],
    freeModels: [],
  };
  assert.throws(() => validateSnapshot(snapshot));
});

test("recomputeUsageDerived: kostenlose Zeile (alles '-') bekommt Preise 0 statt null", () => {
  const model = {
    name: "Ox Alpha Free",
    tier: null,
    input: null,
    output: null,
    cachedRead: null,
    cachedWrite: null,
    usage: null,
    multiplier: null,
    effectiveInput: null,
    effectiveOutput: null,
    effectiveCachedRead: null,
    effectiveCachedWrite: null,
  };
  recomputeUsageDerived(model, 60);
  assert.equal(model.multiplier, null);
  assert.deepEqual(
    [model.input, model.output, model.cachedRead, model.cachedWrite],
    [0, 0, 0, 0]
  );
  assert.deepEqual(
    [model.effectiveInput, model.effectiveOutput, model.effectiveCachedRead, model.effectiveCachedWrite],
    [0, 0, 0, 0]
  );
});

test("validateSnapshot: kostenlose Zeile (Preise 0) ohne Token-Stats ist gültig", () => {
  const snapshot = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/zen/v1/models",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    monthlyCredit: 60,
    monthlyCost: 10,
    peakHours: {},
    models: [
      {
        name: "Ox Alpha Free",
        tier: null,
        input: 0,
        output: 0,
        cachedRead: 0,
        cachedWrite: 0,
        usage: null,
        multiplier: null,
        effectiveInput: 0,
        effectiveOutput: 0,
        effectiveCachedRead: 0,
        effectiveCachedWrite: 0,
        pattern: null,
        capabilities: null,
        privacy: { training: true, validUntil: null },
      },
    ],
    freeModels: [],
  };
  assert.doesNotThrow(() => validateSnapshot(snapshot));
});

test("enrichCapabilities: löst über den opencode-Provider auf", () => {
  const models = [{ name: "Grok 4.5", tier: null }];
  const opencodeModels = {
    "grok-4.5": {
      id: "grok-4.5",
      name: "Grok 4.5",
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    },
  };
  const enriched = enrichCapabilities(models, opencodeModels, {});
  assert.deepEqual(enriched[0].capabilities, {
    input: ["text", "image"],
    output: ["text"],
    reasoning: true,
    toolCall: true,
  });
});

test("enrichCapabilities: fällt auf kanonische Metadaten zurück", () => {
  const models = [{ name: "MiMo V2.5", tier: null }];
  const metadataModels = {
    "xiaomi/mimo-v2.5": {
      id: "xiaomi/mimo-v2.5",
      name: "MiMo-V2.5",
      modalities: { input: ["text", "image", "audio", "video"], output: ["text"] },
    },
  };
  const enriched = enrichCapabilities(models, {}, metadataModels);
  assert.deepEqual(enriched[0].capabilities, {
    input: ["text", "image", "audio", "video"],
    output: ["text"],
    reasoning: false,
    toolCall: false,
  });
});

test("enrichCapabilities: lässt capabilities null bei unbekanntem Modell", () => {
  const models = [{ name: "Völlig Unbekannt", tier: null }];
  const enriched = enrichCapabilities(models, {}, {});
  assert.equal(enriched[0].capabilities, null);
});

test("computeCapabilityDiff: erkennt Änderung und ignoriert gleiche Werte", () => {
  const cap = { input: ["text"], output: ["text"], reasoning: false, toolCall: false };
  const prev = [{ name: "Alpha", tier: null, capabilities: null }];
  const next = [{ name: "Alpha", tier: null, capabilities: cap }];
  assert.deepEqual(computeCapabilityDiff(prev, next), [{ key: "Alpha", from: null, to: cap }]);
  assert.deepEqual(computeCapabilityDiff(next, next), []);
  assert.deepEqual(
    computeCapabilityDiff([{ name: "Alpha" }], [{ name: "Alpha", capabilities: null }]),
    []
  );
});

test("buildChanges: capabilities_changed bei geänderten Fähigkeiten", () => {
  const cap = { input: ["text"], output: ["text"], reasoning: true, toolCall: true };
  const prev = [{ ...base[0], capabilities: null }];
  const next = [{ ...base[0], capabilities: cap }];
  const changes = buildChanges(prev, next, [], []);
  assert.deepEqual(changes, [{ type: "capabilities_changed", model: "Alpha", from: null, to: cap }]);
});

test("buildChanges: privacy_changed bei geänderter Datenaufbewahrung", () => {
  const prev = [{ ...base[0], privacy: { training: false, retentionDays: true, validUntil: null } }];
  const next = [{ ...base[0], privacy: { training: false, retentionDays: 30, validUntil: null } }];
  const changes = buildChanges(prev, next, [], []);
  assert.deepEqual(changes, [
    {
      type: "privacy_changed",
      model: "Alpha",
      from: { training: false, retentionDays: true, validUntil: null },
      to: { training: false, retentionDays: 30, validUntil: null },
    },
  ]);
});

test("buildChanges: privacy_changed bei Wechsel auf 'Kein ZDR' (false)", () => {
  const prev = [{ ...base[0], privacy: { training: false, retentionDays: true, validUntil: null } }];
  const next = [{ ...base[0], privacy: { training: false, retentionDays: false, validUntil: null } }];
  const changes = buildChanges(prev, next, [], []);
  assert.deepEqual(changes, [
    {
      type: "privacy_changed",
      model: "Alpha",
      from: { training: false, retentionDays: true, validUntil: null },
      to: { training: false, retentionDays: false, validUntil: null },
    },
  ]);
});

test("buildChanges: reine validUntil-Änderung (ZDR-Verlängerung) erzeugt keinen privacy_changed", () => {
  const prev = [{ ...base[0], privacy: { training: false, retentionDays: true, validUntil: "2026-08-31" } }];
  const next = [{ ...base[0], privacy: { training: false, retentionDays: true, validUntil: "2026-09-30" } }];
  assert.deepEqual(buildChanges(prev, next, [], []), []);
});

test("buildChanges: privacy_changed nur bei Status-Änderung (validUntil zählt nicht)", () => {
  const prev = [{ ...base[0], privacy: { training: false, retentionDays: true, validUntil: "2026-08-31" } }];
  const next = [{ ...base[0], privacy: { training: true, retentionDays: true, validUntil: "2026-09-30" } }];
  const changes = buildChanges(prev, next, [], []);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "privacy_changed");
  assert.deepEqual(changes[0].from, { training: false, retentionDays: true, validUntil: "2026-08-31" });
  assert.deepEqual(changes[0].to, { training: true, retentionDays: true, validUntil: "2026-09-30" });
});

test("buildChanges: reine validUntil-Änderung bei kostenlosen Modellen erzeugt keinen privacy_changed", () => {
  const prevFree = [
    {
      id: "a-free",
      availableFrom: "2026-08-01",
      privacy: { training: true, validUntil: null },
    },
  ];
  const nextFree = [
    {
      id: "a-free",
      availableFrom: "2026-08-01",
      privacy: { training: true, validUntil: "2026-09-30" },
    },
  ];
  assert.deepEqual(buildChanges(base, base, prevFree, nextFree, "2026-08-06"), []);
});

test("buildChanges: keine privacy_changed bei gleichen Werten", () => {
  const p = { training: false, retentionDays: true, validUntil: null };
  const prev = [{ ...base[0], privacy: p }];
  const next = [{ ...base[0], privacy: { ...p } }];
  assert.deepEqual(buildChanges(prev, next, [], []), []);
});

test("buildChanges: kein Baseline-Event bei erstmals vorhandenem privacy", () => {
  const prev = [{ ...base[0] }];
  const next = [{ ...base[0], privacy: { training: false, retentionDays: true, validUntil: null } }];
  assert.deepEqual(buildChanges(prev, next, [], []), []);
});

test("buildChanges: privacy_changed für kostenlose Zen-Modelle", () => {
  const prevFree = [
    {
      id: "a-free",
      availableFrom: "2026-08-01",
      privacy: { training: true, validUntil: null },
    },
  ];
  const nextFree = [
    {
      id: "a-free",
      availableFrom: "2026-08-01",
      privacy: { training: false, retentionDays: true, validUntil: null },
    },
  ];
  const changes = buildChanges(base, base, prevFree, nextFree, "2026-08-06");
  assert.deepEqual(changes, [
    {
      type: "privacy_changed",
      model: "a-free",
      from: { training: true, validUntil: null },
      to: { training: false, retentionDays: true, validUntil: null },
    },
  ]);
});

test("buildChanges: keine capabilities_changed bei gleichen Fähigkeiten", () => {
  const cap = { input: ["text"], output: ["text"], reasoning: false, toolCall: false };
  const prev = [{ ...base[0], capabilities: cap }];
  const next = [{ ...base[0], capabilities: { ...cap } }];
  const changes = buildChanges(prev, next, [], []);
  assert.deepEqual(changes, []);
});

test("enrichFreeModels: reichert Zen-Modelle über die opencode-ID an", () => {
  const free = [{ id: "mimo-v2.5-free", availableFrom: "2026-08-05" }];
  const opencodeModels = {
    "mimo-v2.5-free": {
      id: "mimo-v2.5-free",
      name: "MiMo V2.5 Free",
      modalities: { input: ["text", "image", "audio", "video"], output: ["text"] },
    },
  };
  const enriched = enrichFreeModels(free, opencodeModels, {});
  assert.deepEqual(enriched[0].capabilities, {
    input: ["text", "image", "audio", "video"],
    output: ["text"],
    reasoning: false,
    toolCall: false,
  });
});

test("enrichFreeModels: setzt privacy (Modelltraining) für Zen-Modelle", () => {
  const enriched = enrichFreeModels([{ id: "big-pickle", availableFrom: "2026-08-05" }], {}, {});
  assert.deepEqual(enriched[0].privacy, { training: true, validUntil: null });
});

test("validateSnapshot: kostenloses Modell ohne privacy bricht", () => {
  const snapshot = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/zen/v1/models",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    monthlyCredit: 60,
    monthlyCost: 10,
    models: parseHtml(fixture),
    freeModels: [{ id: "big-pickle", availableFrom: "2026-08-05", capabilities: null }],
  };
  assert.throws(() => validateSnapshot(snapshot));
});

test("enrichFreeModels: lässt capabilities null bei unbekannter ID", () => {
  const free = [{ id: "does-not-exist-free", availableFrom: "2026-08-05" }];
  const enriched = enrichFreeModels(free, {}, {});
  assert.equal(enriched[0].capabilities, null);
});

test("buildChanges: capabilities_changed für kostenlose Zen-Modelle", () => {
  const cap = { input: ["text", "image"], output: ["text"], reasoning: true, toolCall: true };
  const prevFree = [{ id: "a-free", availableFrom: "2026-08-01", capabilities: null }];
  const nextFree = [{ id: "a-free", availableFrom: "2026-08-01", capabilities: cap }];
  const changes = buildChanges(base, base, prevFree, nextFree, "2026-08-06");
  assert.deepEqual(changes, [{ type: "capabilities_changed", model: "a-free", from: null, to: cap }]);
});

test("buildChanges: keine capabilities_changed für unveränderte Zen-Modelle", () => {
  const cap = { input: ["text"], output: ["text"], reasoning: false, toolCall: false };
  const prevFree = [{ id: "a-free", availableFrom: "2026-08-01", capabilities: cap }];
  const nextFree = [{ id: "a-free", availableFrom: "2026-08-01", capabilities: { ...cap } }];
  const changes = buildChanges(base, base, prevFree, nextFree, "2026-08-06");
  assert.deepEqual(changes, []);
});
