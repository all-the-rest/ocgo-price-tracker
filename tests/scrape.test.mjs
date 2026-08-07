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
  assert.deepEqual(changes, [{ type: "model_removed", model: "Alpha", days: 5 }]);
});

test("buildChanges: kostenlose Modelle hinzugefügt/entfernt", () => {
  const prevFree = [{ id: "a-free", availableFrom: "2026-08-01" }];
  const nextFree = [
    { id: "a-free", availableFrom: "2026-08-01" },
    { id: "big-pickle", availableFrom: "2026-08-05" },
  ];
  const added = buildChanges(base, base, prevFree, nextFree, "2026-08-06");
  assert.deepEqual(added, [{ type: "free_added", model: "big-pickle" }]);

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

test("upsertChangelogJson: ersetzt Eintrag mit gleichem Datum und entfernt leere Einträge", () => {
  const existing = {
    entries: [
      { date: "2026-08-06", changes: [] },
      { date: "2026-08-05", changes: [{ type: "text", lang: { de: "Alt", en: "Old" } }] },
      { date: "2026-08-04", changes: [] },
      { date: "2026-08-03", changes: [{ type: "text", lang: { de: "Uralt", en: "Ancient" } }] },
    ],
  };
  const result = upsertChangelogJson(existing, "2026-08-05", [{ type: "text", lang: { de: "Neu", en: "New" } }]);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].date, "2026-08-05");
  assert.deepEqual(result.entries[0].changes, [{ type: "text", lang: { de: "Neu", en: "New" } }]);
  assert.equal(result.entries[1].date, "2026-08-03");
});

test("upsertChangelogJson: fügt bei leeren Änderungen keinen Eintrag hinzu", () => {
  const existing = { entries: [{ date: "2026-08-05", changes: [{ type: "text", lang: { de: "x", en: "x" } }] }] };
  const result = upsertChangelogJson(existing, "2026-08-06", []);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].date, "2026-08-05");
});

test("upsertChangelogJson: leere Änderungen löschen den Eintrag des gleichen Datums nicht", () => {
  const existing = {
    entries: [
      {
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
      { date: "2026-08-05", changes: [{ type: "text", lang: { de: "Initialversion", en: "Initial version" } }] },
    ],
  };
  const result = upsertChangelogJson(existing, "2026-08-07", []);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].date, "2026-08-07");
  assert.equal(result.entries[0].changes[0].model, "DeepSeek V4 Flash");
});

test("validateChangelog: gültiger Changelog mit allen Event-Typen", () => {
  const changelog = {
    entries: [
      {
        date: "2026-08-05",
        changes: [{ type: "text", lang: { de: "Initialversion", en: "Initial version" } }],
      },
      {
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

test("upsertChangelogJson: Events desselben Datums werden gemerged (2 Läufe/Tag)", () => {
  const existing = {
    entries: [
      {
        date: "2026-08-07",
        changes: [{ type: "usage_changed", model: "Alpha", from: 60, to: 120 }],
      },
    ],
  };
  const result = upsertChangelogJson(existing, "2026-08-07", [
    { type: "free_added", model: "big-pickle" },
    { type: "usage_changed", model: "Alpha", from: 120, to: 60 },
  ]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].date, "2026-08-07");
  assert.deepEqual(result.entries[0].changes, [
    { type: "usage_changed", model: "Alpha", from: 120, to: 60 },
    { type: "free_added", model: "big-pickle" },
  ]);
});

test("validateChangelog: leere Einträge, unbekannte Typen und fehlende Felder brechen", () => {
  assert.throws(() => validateChangelog({ entries: [{ date: "2026-08-06", changes: [] }] }));
  assert.throws(() =>
    validateChangelog({ entries: [{ date: "2026-08-06", changes: [{ type: "baseline", modelCount: 1 }] }] })
  );
  assert.throws(() =>
    validateChangelog({ entries: [{ date: "2026-08-06", changes: [{ type: "model_added", model: "X" }] }] })
  );
  assert.throws(() =>
    validateChangelog({ entries: [{ date: "2026-08-06", changes: [{ type: "text", text: "no lang map" }] }] })
  );
  assert.throws(() =>
    validateChangelog({
      entries: [{ date: "2026-08-06", changes: [{ type: "model_removed", model: "X", days: -1 }] }],
    })
  );
  assert.throws(() =>
    validateChangelog({
      entries: [
        {
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
    models: parseHtml(fixture),
    freeModels: [{ id: "big-pickle", availableFrom: "2026-08-05", capabilities: null }],
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
    models: [withoutPattern],
    freeModels: [],
  };
  assert.throws(() => validateSnapshot(snapshot));
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
