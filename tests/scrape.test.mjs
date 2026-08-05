import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseHtml,
  computeDiff,
  buildChanges,
  upsertChangelogJson,
  mergeFreeModels,
  validateSnapshot,
  modelKey,
  extractFreeModels,
  patternPartMatches,
} from "../scripts/scrape.mjs";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "go-de.html"),
  "utf8"
);

test("parseHtml: extrahiert 22 Modelle aus dem HTML-Dump", () => {
  const models = parseHtml(fixture);
  assert.equal(models.length, 22);
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

test("computeDiff: erkennt Nutzungsverbesserung", () => {
  const next = [{ ...base[0] }, { ...base[1], usage: 60 }];
  const diff = computeDiff(base, next);
  assert.deepEqual(diff.usageChanges, [{ key: "Beta", from: 15, to: 60 }]);
});

test("computeDiff: erkennt Preisänderung mit Float-Toleranz", () => {
  const next = [{ ...base[0], input: 1.0000000001 }, { ...base[1] }];
  assert.equal(computeDiff(base, next).priceChanges.length, 0);
  const changed = [{ ...base[0], input: 1.5 }, { ...base[1] }];
  const diff = computeDiff(base, changed);
  assert.equal(diff.priceChanges.length, 1);
  assert.equal(diff.priceChanges[0].key, "Alpha");
  assert.equal(diff.priceChanges[0].fields[0].label, "Input");
  assert.equal(diff.priceChanges[0].fields[0].field, "input");
});

test("buildChanges: Baseline ohne Vorgänger", () => {
  assert.deepEqual(buildChanges(null, base, [], []), [
    { type: "baseline", modelCount: 2, freeModelCount: 0 },
  ]);
});

test("buildChanges: Modell hinzugefügt und Nutzung verschlechtert", () => {
  const next = [
    { ...base[0], usage: 15 },
    { ...base[1] },
    { name: "Gamma", tier: null, usage: 60, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null },
  ];
  const changes = buildChanges(base, next, [], []);
  assert.deepEqual(changes, [
    { type: "model_added", model: "Gamma" },
    { type: "usage_changed", model: "Alpha", from: 60, to: 15 },
  ]);
});

test("buildChanges: Preisänderung enthält alten und neuen Preis", () => {
  const next = [{ ...base[0], input: 1.5 }, { ...base[1] }];
  const changes = buildChanges(base, next, [], []);
  assert.deepEqual(changes, [{ type: "price_changed", model: "Alpha", field: "input", from: 1, to: 1.5 }]);
});

test("buildChanges: keine Änderungen", () => {
  assert.deepEqual(buildChanges(base, base, [], []), []);
});

test("buildChanges: kostenlose Modelle hinzugefügt/entfernt", () => {
  const prevFree = [{ id: "a-free", availableFrom: "2026-08-01" }];
  const nextFree = [
    { id: "a-free", availableFrom: "2026-08-01" },
    { id: "big-pickle", availableFrom: "2026-08-05" },
  ];
  const added = buildChanges(base, base, prevFree, nextFree, "2026-08-06");
  assert.deepEqual(added, [{ type: "free_added", model: "big-pickle", availableFrom: "2026-08-05" }]);

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

test("upsertChangelogJson: ersetzt Eintrag mit gleichem Datum und behält ältere", () => {
  const existing = {
    entries: [
      { date: "2026-08-05", changes: [{ type: "model_added", model: "Alt" }] },
      { date: "2026-08-04", changes: [{ type: "model_removed", model: "Uralt" }] },
    ],
  };
  const result = upsertChangelogJson(existing, "2026-08-05", [{ type: "model_added", model: "Neu" }]);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].date, "2026-08-05");
  assert.deepEqual(result.entries[0].changes, [{ type: "model_added", model: "Neu" }]);
  assert.equal(result.entries[1].date, "2026-08-04");
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
    sourceLang: "de",
    monthlyCredit: 60,
    models: parseHtml(fixture),
    freeModels: [{ id: "big-pickle", availableFrom: "2026-08-05" }],
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
    sourceLang: "de",
    monthlyCredit: 60,
    models: [withoutPattern],
    freeModels: [],
  };
  assert.throws(() => validateSnapshot(snapshot));
});
