import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import {
  parseHtml,
  parsePlans,
  parsePlanTable,
  parsePlanPrice,
  planIdFromLabel,
  extractPlanTableMap,
  parsePatternNum,
  computeDiff,
  buildChanges,
  upsertChangelogJson,
  mergeChanges,
  splitChange,
  mergeFreeModels,
  validateSnapshot,
  validateChangelog,
  modelKey,
  extractFreeModelsFromDocs,
  parseZenEndpointIds,
  parseZenFreeModelPrivacy,
  patternPartMatches,
  enrichCapabilities,
  computeCapabilityDiff,
  enrichFreeModels,
  parseDocsUsageBonuses,
  parsePeakHours,
  parsePeakRanges,
  parsePrivacyNotes,
  validUntilFor,
  ScrapeError,
  usageMapsEqual,
  computePrivacyDiff,
  normalizeChangelogIds,
  parseGermanDate,
  canonicalModelName,
  canonicalFreeName,
} from "../scripts/scrape.mjs";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "go-de.html"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Synthetische Seiten im echten Doku-Aufbau: Plan-Tabelle + `starlight-tabs`
// mit einem `[role=tabpanel]` je Plan (Panel-Label == Plan-Name).
// ---------------------------------------------------------------------------

const DE_HEADERS = [
  "Modell",
  "Eingabe",
  "Ausgabe",
  "Cache-Lesevorgang",
  "Cache-Schreibvorgang",
  "Monatliches Limit",
];
const EN_HEADERS = ["Model", "Input", "Output", "Cached Read", "Cached Write", "Usage"];

function tableHtml(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function planTable(plans) {
  return tableHtml(
    ["Abonnement", "Preis", "Enthaltene Nutzung"],
    plans.map((p) => [p.name, `$${p.price}/Monat`, "x"])
  );
}

/**
 * Baut eine Seite wie die Doku: Plan-Tabelle + Tab-Panels (Labels → Plan-Ids).
 * Panels ohne Preistabelle (Rate-Limits) werden bewusst nicht erzeugt.
 */
function buildPage({ plans = [{ name: "Go", price: 10 }], panels = [], extra = "" } = {}) {
  const tabs = panels
    .map(
      (p, i) =>
        `<div id="tab-panel-${i + 1}" aria-labelledby="tab-${i + 1}" role="tabpanel">${p.table}</div>`
    )
    .join("");
  const tabList = panels
    .map(
      (p, i) =>
        `<li role="presentation"><a role="tab" href="#tab-panel-${i + 1}" id="tab-${i + 1}">${p.label}</a></li>`
    )
    .join("");
  const tabsHtml = panels.length
    ? `<starlight-tabs data-sync-key="go-plan"><div class="tablist-wrapper"><ul role="tablist">${tabList}</ul></div>${tabs}</starlight-tabs>`
    : "";
  return `<html><body><main>${planTable(plans)}${tabsHtml}${extra}</main></body></html>`;
}

const pricePanel = (label, rows, headers = DE_HEADERS) => ({ label, table: tableHtml(headers, rows) });
const privacyTable = (rows) => tableHtml(["Modell", "Modelltraining", "Datenaufbewahrung"], rows);

// ---------------------------------------------------------------------------
// parseHtml: echte Fixture (Plan-Tabelle + zwei Preistabellen)
// ---------------------------------------------------------------------------

test("parseHtml: extrahiert 39 Modelle aus dem HTML-Dump", () => {
  const models = parseHtml(fixture);
  assert.equal(models.length, 39);
  for (const m of models) {
    assert.equal(typeof m.name, "string");
    assert.equal(typeof m.usage, "object");
    assert.ok("go" in m.usage && "go-plus" in m.usage, `${m.name} hat usage.go/go-plus`);
  }
});

test("parseHtml: Grok 4.7 mit $15/$60-Nutzung", () => {
  const grok = parseHtml(fixture).find((m) => m.name === "Grok 4.7" && m.tier === "≤ 200K tokens");
  assert.equal(grok.input, 2);
  assert.equal(grok.output, 6);
  assert.equal(grok.cachedRead, 0.5);
  assert.equal(grok.cachedWrite, null);
  assert.deepEqual(grok.usage, { go: 15, "go-plus": 60 });
});

test("parseHtml: DeepSeek V4 Flash (Off-Peak) mit $30/$120-Nutzung", () => {
  const flash = parseHtml(fixture).find((m) => m.name === "DeepSeek V4 Flash" && m.tier === "Off-Peak");
  assert.equal(flash.input, 0.15);
  assert.equal(flash.output, 0.6);
  assert.deepEqual(flash.usage, { go: 30, "go-plus": 120 });
});

test("parseHtml: MiMo V2.5 Pro mit kleinen Preisen", () => {
  const pro = parseHtml(fixture).find((m) => m.name === "MiMo V2.5 Pro");
  assert.equal(pro.input, 0.435);
  assert.equal(pro.cachedRead, 0.003625);
  assert.deepEqual(pro.usage, { go: 15, "go-plus": 60 });
});

test("parseHtml: kostenlose Zeilen (Nutzung '-'/unbegrenzt) → Preise 0, usage null in beiden Plänen", () => {
  const free = parseHtml(fixture).filter((m) => m.usage.go === null);
  assert.deepEqual(free.map((m) => m.name).sort(), ["LongCat 2.5 Preview Free", "Space Bunny Free"]);
  for (const m of free) {
    assert.deepEqual(m.usage, { go: null, "go-plus": null });
    assert.deepEqual([m.input, m.output, m.cachedRead, m.cachedWrite], [0, 0, 0, 0]);
    assert.equal(m.pattern, null);
  }
});

test("parseHtml: Tier-Splitting bei GPT 5.6 Luna", () => {
  const models = parseHtml(fixture);
  const tiers = models
    .filter((m) => m.name === "GPT 5.6 Luna")
    .map((m) => m.tier)
    .sort();
  assert.deepEqual(tiers, ["> 272K tokens", "≤ 272K tokens"]);
  assert.equal(modelKey(models.find((m) => m.name === "GPT 5.6 Luna" && m.tier === "≤ 272K tokens")), "GPT 5.6 Luna (≤ 272K tokens)");
});

test("parseHtml: pro-Modell-Anfragemuster (Komma-Tausender)", () => {
  const models = parseHtml(fixture);
  const by = (name) => models.find((m) => m.name === name);
  assert.deepEqual(by("Grok 4.7").pattern, { input: 390, cachedRead: 32500, output: 120 });
  assert.deepEqual(by("GLM-5.3").pattern, { input: 700, cachedRead: 52000, output: 150 });
  assert.deepEqual(by("GLM-5.3-Flash").pattern, { input: 1000, cachedRead: 55000, output: 200 });
  assert.deepEqual(by("Kimi K2.6").pattern, { input: 870, cachedRead: 55000, output: 200 });
  assert.deepEqual(by("MiniMax M2.7").pattern, { input: 300, cachedRead: 55000, output: 125 });
  for (const l of models.filter((m) => m.name === "GPT 5.6 Luna")) {
    assert.deepEqual(l.pattern, { input: 1000, cachedRead: 50000, output: 220 });
  }
});

// ---------------------------------------------------------------------------
// Pläne (Plan-Tabelle + Tab-Zuordnung)
// ---------------------------------------------------------------------------

test("parsePlans: Go (10/60) und Go Plus (40/240) aus der Fixture", () => {
  const plans = parsePlans(fixture);
  assert.deepEqual(plans, [
    {
      id: "go",
      name: "Go",
      priceMonthly: 10,
      creditsMonthly: 60,
      sourceUrl: "https://opencode.ai/docs/de/go/",
    },
    {
      id: "go-plus",
      name: "Go Plus",
      priceMonthly: 40,
      creditsMonthly: 240,
      sourceUrl: "https://opencode.ai/docs/de/go/",
    },
  ]);
});

test("creditsMonthly = höchste endliche Nutzung je Plan", () => {
  const plans = parsePlans(fixture);
  assert.equal(plans.find((p) => p.id === "go").creditsMonthly, 60);
  assert.equal(plans.find((p) => p.id === "go-plus").creditsMonthly, 240);
});

test("parsePlanPrice/planIdFromLabel: Formate und Normalisierung", () => {
  assert.equal(parsePlanPrice("$10/Monat"), 10);
  assert.equal(parsePlanPrice("$40/Monat"), 40);
  assert.equal(parsePlanPrice("10 $/Monat"), 10);
  assert.equal(planIdFromLabel("Go"), "go");
  assert.equal(planIdFromLabel("Go Plus"), "go-plus");
  assert.equal(planIdFromLabel("  Pro   Plus "), "pro-plus");
  assert.throws(() => parsePlanPrice("kostenlos"), ScrapeError);
});

test("parsePlanTable: englische Header (Plan/Price) funktionieren ebenfalls", () => {
  const html = `<html><body><main>${tableHtml(
    ["Plan", "Price", "Included usage"],
    [
      ["Go", "$10/month", "x"],
      ["Go Plus", "$40/month", "x"],
    ]
  )}</main></body></html>`;
  const plans = parsePlanTable(cheerio.load(html));
  assert.deepEqual(plans.map((p) => [p.id, p.priceMonthly]), [
    ["go", 10],
    ["go-plus", 40],
  ]);
});

test("extractPlanTableMap: ordnet über ARIA zu (nicht über Position)", () => {
  const $ = cheerio.load(
    buildPage({
      plans: [
        { name: "Go", price: 10 },
        { name: "Go Plus", price: 40 },
      ],
      panels: [
        pricePanel("Go", [["A", "$1", "$1", "-", "-", "$60"]]),
        pricePanel("Go Plus", [["A", "$1", "$1", "-", "-", "$120"]]),
      ],
    })
  );
  const plans = parsePlanTable($);
  const map = extractPlanTableMap($, plans);
  assert.deepEqual([...map.keys()], ["go", "go-plus"]);
});

test("parseHtml: deutsche Header werden erkannt", () => {
  const html = buildPage({
    panels: [pricePanel("Go", [["Deutsches Modell", "$1.40", "$4.40", "$0.26", "-", "$15"]])],
    extra: privacyTable([["Deutsches Modell", "Nicht verwendet", "0 Tage"]]),
  });
  const m = parseHtml(html)[0];
  assert.equal(m.name, "Deutsches Modell");
  assert.equal(m.input, 1.4);
  assert.deepEqual(m.usage, { go: 15 });
});

// ---------------------------------------------------------------------------
// Fehlerfälle der Plan-/Tab-Struktur
// ---------------------------------------------------------------------------

test("parseHtml: fehlende Plan-Tabelle → ScrapeError", () => {
  assert.throws(() => parseHtml("<html><body><h1>nix</h1></body></html>"), ScrapeError);
});

test("parseHtml: #Preistabellen ≠ #Pläne → ScrapeError", () => {
  const html = buildPage({
    plans: [
      { name: "Go", price: 10 },
      { name: "Go Plus", price: 40 },
    ],
    panels: [pricePanel("Go", [["A", "$1", "$1", "-", "-", "$60"]])],
  });
  assert.throws(() => parseHtml(html), /Anzahl Preistabellen/);
});

test("parseHtml: Panel-Label ohne passenden Plan → ScrapeError", () => {
  const html = buildPage({
    plans: [{ name: "Go", price: 10 }],
    panels: [pricePanel("Go Plus", [["A", "$1", "$1", "-", "-", "$60"]])],
  });
  assert.throws(() => parseHtml(html), /keinem Plan/);
});

test("parseHtml: Preis-Tab-Panel ohne aria-labelledby → ScrapeError", () => {
  const table = tableHtml(DE_HEADERS, [["A", "$1", "$1", "-", "-", "$60"]]);
  const html = `<html><body><main>${planTable([{ name: "Go", price: 10 }])}<starlight-tabs><div class="tablist-wrapper"><ul role="tablist"><li><a role="tab" href="#tab-panel-1" id="tab-1">Go</a></li></ul></div><div id="tab-panel-1" role="tabpanel">${table}</div></starlight-tabs></main></body></html>`;
  assert.throws(() => parseHtml(html), /aria-labelledby/);
});

test("parseHtml: Tab ohne zugehöriges Panel → ScrapeError", () => {
  const table = tableHtml(DE_HEADERS, [["A", "$1", "$1", "-", "-", "$60"]]);
  const html = `<html><body><main>${planTable([
    { name: "Go", price: 10 },
    { name: "Go Plus", price: 40 },
  ])}<starlight-tabs><div class="tablist-wrapper"><ul role="tablist"><li><a role="tab" href="#tab-panel-1" id="tab-1">Go</a></li><li><a role="tab" href="#tab-panel-2" id="tab-2">Go Plus</a></li></ul></div><div id="tab-panel-1" aria-labelledby="tab-1" role="tabpanel">${table}</div></starlight-tabs></main></body></html>`;
  assert.throws(() => parseHtml(html), /kein zugehöriges Panel/);
});

test("parseHtml: abweichende Tokenpreise zwischen den Plänen → ScrapeError", () => {
  const html = buildPage({
    plans: [
      { name: "Go", price: 10 },
      { name: "Go Plus", price: 40 },
    ],
    panels: [
      pricePanel("Go", [["A", "$1", "$1", "-", "-", "$60"]]),
      pricePanel("Go Plus", [["A", "$2", "$1", "-", "-", "$120"]]),
    ],
  });
  assert.throws(() => parseHtml(html), /Tokenpreise weichen/);
});

test("parseHtml: abweichende Modellmenge zwischen den Plänen → ScrapeError", () => {
  const html = buildPage({
    plans: [
      { name: "Go", price: 10 },
      { name: "Go Plus", price: 40 },
    ],
    panels: [
      pricePanel("Go", [["A", "$1", "$1", "-", "-", "$60"]]),
      pricePanel("Go Plus", [["B", "$1", "$1", "-", "-", "$120"]]),
    ],
  });
  assert.throws(() => parseHtml(html), /abweichende Modellzeilen/);
});

test("parseHtml: wirft bei unparsebarem Preis", () => {
  const html = buildPage({
    panels: [pricePanel("Go", [["Test Model", "$abc", "$1", "-", "-", "$60"]])],
  });
  assert.throws(() => parseHtml(html));
});

for (const limit of ["<strong>Unbegrenzt</strong>", "Unlimited", "-", "<strong>$60</strong>"]) {
  test(`parseHtml: Free-Preise mit Nutzung ${limit}`, () => {
    const html = buildPage({
      panels: [
        pricePanel("Go", [
          ["Union Alpha", "Free", " free ", "FREE", "-", `${limit}<br><small>für begrenzte Zeit</small>`],
          ["Priced Model", "$1", "$1", "-", "-", "$60"],
        ]),
      ],
      extra: privacyTable([["Other", "Nicht verwendet", "0 Tage"]]),
    });
    const model = parseHtml(html).find((m) => m.name === "Union Alpha");
    const limited = limit.includes("$60");
    assert.deepEqual(model.usage, { go: limited ? 60 : null });
    assert.equal(model.pattern, null);
    for (const field of ["input", "output", "cachedRead"]) {
      assert.equal(model[field], 0, field);
    }
    assert.equal(model.cachedWrite, limited ? null : 0);
  });
}

test("parseHtml: unbekanntes Nutzungslimit bleibt ein Fehler", () => {
  const html = buildPage({
    panels: [pricePanel("Go", [["Broken", "$1", "$1", "-", "-", "<strong>Unknown</strong>"]])],
  });
  assert.throws(() => parseHtml(html), /Nutzung unparsebar/);
});

// ---------------------------------------------------------------------------
// Anfragemuster-Zahlen
// ---------------------------------------------------------------------------

test("parsePatternNum: Komma-Tausender (32,500) UND Punkt-Tausender (1.100)", () => {
  assert.equal(parsePatternNum("32,500"), 32500);
  assert.equal(parsePatternNum("1.100"), 1100);
  assert.equal(parsePatternNum("71,300"), 71300);
  assert.equal(parsePatternNum("76,500"), 76500);
  assert.equal(parsePatternNum("1.5"), 1.5);
  assert.throws(() => parsePatternNum("abc"), ScrapeError);
  assert.throws(() => parsePatternNum(""), ScrapeError);
});

test("patternPartMatches: härtet gegen Kollisionen", () => {
  assert.equal(patternPartMatches("5.1", "glm5.1", "glm"), true);
  assert.equal(patternPartMatches("5.1", "glm5.10", "glm"), false);
  assert.equal(patternPartMatches("k2.6", "kimik2.6", "kimik"), true);
  assert.equal(patternPartMatches("kimik2.7", "kimik2.7code", "kimik"), true);
});

test("parseDocsUsageBonuses: extrahiert den 4×-Faktor aus der Doku-Zelle", () => {
  const $ = cheerio.load(`<html><body><main>${tableHtml(EN_HEADERS, [
    ["DeepSeek V4.1 Flash", "$0.15", "$0.60", "$0.003", "-", "<del>$15</del> <strong>$60</strong><br><small>4x · Endet am 20. Sept.</small>"],
    ["Grok 4.7", "$1", "$2", "$0.1", "-", "$15"],
  ])}</main></body></html>`);
  const bonuses = parseDocsUsageBonuses($);
  assert.equal(bonuses.get("deepseekv4.1flash"), 4);
  assert.equal(bonuses.size, 1);
});

test("parseHtml: Nutzungs-Zelle mit Doku-Bonus (del/strong/small) → aktueller Wert", () => {
  const html = buildPage({
    panels: [
      pricePanel("Go", [
        [
          "DeepSeek V4.1 Flash (Off-Peak)",
          "$0.15",
          "$0.60",
          "$0.003",
          "-",
          "<del>$15</del> <strong>$60</strong><br><small>4x · Endet am 20. Sept.</small>",
        ],
      ]),
    ],
    extra:
      privacyTable([["DeepSeek V4.1 Flash", "Nicht verwendet", "0 Tage"]]) +
      "<ul><li>DeepSeek V4.1 Flash — 410 Eingabe-, 71,300 Cache-, 310 Ausgabe-Tokens pro Anfrage</li></ul>",
  });
  const model = parseHtml(html)[0];
  assert.deepEqual(model.usage, { go: 60 });
  assert.deepEqual(model.pattern, { input: 410, cachedRead: 71300, output: 310 });
});

// ---------------------------------------------------------------------------
// Anfragemuster-Auflösung / Peaks
// ---------------------------------------------------------------------------

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

test("parsePeakHours: zwei Notizen / zwei Provider erhalten je ihr eigenes Fenster", () => {
  const $ = cheerio.load(
    "<main>" +
      "<p><strong>DeepSeek V4 Flash:</strong> Peak hours are 01:00-04:00 UTC; all other hours are Off-Peak.</p>" +
      "<p><strong>Grok 4.7:</strong> Peak hours are 08:00-12:00 UTC; all other hours are Off-Peak.</p>" +
      "</main>"
  );
  const models = [
    { name: "DeepSeek V4 Flash", tier: "Off-Peak" },
    { name: "DeepSeek V4 Flash", tier: "Peak" },
    { name: "Grok 4.7", tier: "Off-Peak" },
    { name: "Grok 4.7", tier: "Peak" },
  ];
  assert.deepEqual(parsePeakHours($, models), {
    deepseekv4flash: [[1, 4]],
    "grok4.7": [[8, 12]],
  });
});

test("parsePeakHours: Peak-Modell ohne Notiz → ScrapeError nennt das Modell", () => {
  const $ = cheerio.load(
    "<main><p><strong>DeepSeek V4 Flash:</strong> Peak hours are 01:00-04:00 UTC.</p></main>"
  );
  const models = [
    { name: "DeepSeek V4 Flash", tier: "Peak" },
    { name: "Grok 4.7", tier: "Peak" },
  ];
  assert.throws(() => parsePeakHours($, models), (err) => {
    assert.ok(err instanceof ScrapeError);
    assert.match(err.message, /Grok 4\.7/);
    return true;
  });
});

test("parsePeakHours: Peak-/UTC-Notiz ohne Peak-Modell → ScrapeError", () => {
  const $ = cheerio.load(
    "<main>" +
      "<p><strong>DeepSeek V4 Flash:</strong> Peak hours are 01:00-04:00 UTC.</p>" +
      "<p><strong>Alle Peak-Preise:</strong> gelten täglich von 00:00-23:00 UTC für Neukunden.</p>" +
      "</main>"
  );
  const models = [{ name: "DeepSeek V4 Flash", tier: "Peak" }];
  assert.throws(() => parsePeakHours($, models), ScrapeError);
});

test("parsePeakHours: zwei Notizen mit widersprüchlichen Fenstern → ScrapeError", () => {
  const $ = cheerio.load(
    "<main>" +
      "<p><strong>DeepSeek V4 Flash:</strong> Peak hours are 01:00-04:00 UTC.</p>" +
      "<p><strong>DeepSeek V4 Flash:</strong> Peak hours are 06:00-10:00 UTC.</p>" +
      "</main>"
  );
  const models = [{ name: "DeepSeek V4 Flash", tier: "Peak" }];
  assert.throws(() => parsePeakHours($, models), (err) => {
    assert.ok(err instanceof ScrapeError);
    assert.match(err.message, /Widersprüchliche Peak-Zeitfenster/);
    assert.match(err.message, /DeepSeek V4 Flash/);
    return true;
  });
});

test("parsePeakRanges: ungültiges Fenster → ScrapeError", () => {
  assert.throws(() => parsePeakRanges("Peak hours are 99:00-04:00 UTC"), ScrapeError);
  assert.throws(() => parsePeakRanges("Peak hours are 04:00-01:00 UTC"), ScrapeError);
  assert.throws(() => parsePeakRanges("Peak hours ohne Zahl UTC"), ScrapeError);
});

// ---------------------------------------------------------------------------
// Datenschutz
// ---------------------------------------------------------------------------

test("parseHtml: Datenschutz — Grok 4.7 mit 30 Tagen Aufbewahrung", () => {
  const grok = parseHtml(fixture).find((m) => m.name === "Grok 4.7");
  assert.deepEqual(grok.privacy, { training: false, retentionDays: 30, validUntil: null });
});

test("parseHtml: Datenschutz — ZDR-Modelle mit true (0 Tage)", () => {
  const glm = parseHtml(fixture).find((m) => m.name === "GLM-5.2");
  assert.deepEqual(glm.privacy, { training: false, retentionDays: true, validUntil: null });
});

test("parseHtml: Datenschutz — DeepSeek V4 Flash mit gültig-bis-Datum (31. Oktober 2026)", () => {
  const flash = parseHtml(fixture).find((m) => m.name === "DeepSeek V4 Flash");
  assert.deepEqual(flash.privacy, { training: false, retentionDays: true, validUntil: "2026-10-31" });
});

test("parseHtml: kostenlose Preistabellen-Zeile ohne Nutzung bekommt Datenschutz", () => {
  const free = parseHtml(fixture).find((m) => m.name === "Space Bunny Free");
  assert.deepEqual(free.privacy, { training: false, retentionDays: true, validUntil: null });
});

test("parsePrivacyNotes: Familien-Label (DeepSeek) → validUntil (ISO)", () => {
  const $ = cheerio.load(
    "<main><ul><li><strong>DeepSeek:</strong> Die ZDR-Vereinbarung wird monatlich erneuert. Die aktuelle Vereinbarung gilt bis einschließlich 30. September 2026.</li></ul></main>"
  );
  const notes = parsePrivacyNotes($);
  assert.equal(notes.get("deepseek"), "2026-09-30");
});

test("validUntilFor: Familien-Fallback gilt für alle Modelle der Familie", () => {
  const map = new Map([["deepseek", "2026-09-30"]]);
  assert.equal(validUntilFor("deepseekv4flash", map), "2026-09-30");
  assert.equal(validUntilFor("deepseekv4pro", map), "2026-09-30");
  assert.equal(validUntilFor("deepseekv41flash", map), "2026-09-30");
});

test("validUntilFor: Exakt-/spezifischer Treffer gewinnt gegen Familien-Fallback", () => {
  const map = new Map([
    ["deepseek", "2026-09-30"],
    ["deepseekv4flash", "2026-10-31"],
  ]);
  assert.equal(validUntilFor("deepseekv4flash", map), "2026-10-31");
  assert.equal(validUntilFor("deepseekv4pro", map), "2026-09-30");
});

test("validUntilFor: ohne Treffer null, kein falscher Präfix-Match", () => {
  assert.equal(validUntilFor("grok47", new Map([["deepseek", "2026-09-30"]])), null);
  assert.equal(validUntilFor("deepseekv4flash", new Map()), null);
});

test("parseHtml: Datenschutz-Notiz ohne passendes Modell → ScrapeError", () => {
  const html = buildPage({
    panels: [pricePanel("Go", [["Alpha", "$1", "$1", "-", "-", "$60"]])],
    extra:
      privacyTable([["Alpha", "Nicht verwendet", "0 Tage"]]) +
      "<ul><li><strong>DeepSeek:</strong> Die ZDR-Vereinbarung gilt bis einschließlich 30. September 2026.</li></ul>",
  });
  assert.throws(() => parseHtml(html), ScrapeError);
});

test("parseHtml: Datenschutz — Muse Spark 1.2 ohne ZDR ('Kein ZDR' → false)", () => {
  const muse = parseHtml(fixture).find((m) => m.name === "Muse Spark 1.2 Contributor");
  assert.deepEqual(muse.privacy, { training: true, retentionDays: false, validUntil: null });
});

test("parseHtml: Datenschutz — unbekannte Aufbewahrung ('–') lässt retentionDays weg", () => {
  const html = buildPage({
    panels: [pricePanel("Go", [["Alpha", "$1", "$1", "-", "-", "$60"]])],
    extra: privacyTable([["Alpha", "Nicht verwendet", "–"]]),
  });
  const privacy = parseHtml(html)[0].privacy;
  assert.equal(privacy.training, false);
  assert.equal(privacy.retentionDays, undefined);
});

test("parseHtml: Datenschutz — Fußnoten-Stern ('0 Tage*') zählt als ZDR", () => {
  const html = buildPage({
    panels: [pricePanel("Go", [["Alpha", "$1", "$1", "-", "-", "$60"]])],
    extra: privacyTable([["Alpha", "Nicht verwendet", "0 Tage*"]]),
  });
  assert.deepEqual(parseHtml(html)[0].privacy, { training: false, retentionDays: true, validUntil: null });
});

test("parseHtml: Datenschutz — Luna (beide Tiers) aus einer Tabellenzeile", () => {
  const luna = parseHtml(fixture).filter((m) => m.name === "GPT 5.6 Luna");
  assert.equal(luna.length, 2);
  for (const l of luna) {
    assert.deepEqual(l.privacy, { training: false, retentionDays: 30, validUntil: null });
  }
});

test("parseHtml: Datenschutz — MiniMax M2.5 übernimmt Familien-Fallback von M2.7", () => {
  const html = buildPage({
    panels: [
      pricePanel("Go", [
        ["MiniMax M2.5", "$0.30", "$1.20", "$0.06", "-", "$60"],
        ["MiniMax M2.7", "$0.30", "$1.20", "$0.06", "-", "$60"],
      ]),
    ],
    extra: privacyTable([["MiniMax M2.7", "Nicht verwendet", "0 Tage"]]),
  });
  const mimo = parseHtml(html).find((m) => m.name === "MiniMax M2.5");
  assert.deepEqual(mimo.privacy, {
    training: false,
    retentionDays: true,
    validUntil: null,
    fallback: true,
  });
});

test("parseHtml: Datenschutz — Modell ohne Zeile und ohne Fallback bleibt null", () => {
  const html = buildPage({
    panels: [pricePanel("Go", [["Alpha", "$1", "$1", "-", "-", "$60"]])],
    extra: privacyTable([["Beta", "Nicht verwendet", "0 Tage"]]),
  });
  assert.equal(parseHtml(html)[0].privacy, null);
});

test("parseHtml: wirft bei fehlender Datenschutz-Tabelle", () => {
  const html = buildPage({
    panels: [pricePanel("Go", [["Test Model", "$1", "$1", "-", "-", "$60"]])],
  });
  assert.throws(() => parseHtml(html));
});

// ---------------------------------------------------------------------------
// Namens-Normalisierung
// ---------------------------------------------------------------------------

test("canonicalModelName: normalisiert MiMo-Bindestrich-Schreibweisen", () => {
  assert.equal(canonicalModelName("MiMo-V2.5"), "MiMo V2.5");
  assert.equal(canonicalModelName("MiMo-V2.5-Pro"), "MiMo V2.5 Pro");
  assert.equal(canonicalModelName("MiMo-V2.6-Flash"), "MiMo V2.6 Flash");
  assert.equal(canonicalModelName("MiMo-V2.6-Pro"), "MiMo V2.6 Pro");
  assert.equal(canonicalModelName("MiMo V2.5"), "MiMo V2.5");
  assert.equal(canonicalModelName("GLM-5.2"), "GLM-5.2");
  assert.equal(canonicalModelName("Grok 4.7"), "Grok 4.7");
});

test("canonicalFreeName: normalisiert Free-Anzeigenamen, behält Suffix", () => {
  assert.equal(canonicalFreeName("MiMo-V2.6-Flash Free"), "MiMo V2.6 Flash Free");
  assert.equal(canonicalFreeName("Ox Alpha Free"), "Ox Alpha Free");
});

test("parseHtml: Bindestrich-Schreibweise wird auf kanonische Namen normalisiert", () => {
  const spaced = fixture.replaceAll("<td>MiMo-V2.5</td>", "<td>MiMo V2.5</td>");
  assert.ok(spaced !== fixture);
  const models = parseHtml(spaced);
  const mimo = models.find((m) => m.name === "MiMo V2.5");
  assert.ok(mimo);
  // Muster und Datenschutz bleiben zugeordnet.
  assert.deepEqual(mimo.pattern, { input: 830, cachedRead: 71500, output: 295 });
  assert.ok(mimo.privacy);
});

// ---------------------------------------------------------------------------
// Diff / Changelog (usage als Map, usage_changed mit plan)
// ---------------------------------------------------------------------------

const base = [
  { name: "Alpha", tier: null, usage: { go: 60 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null },
  { name: "Beta", tier: null, usage: { go: 15 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null },
];

test("usageMapsEqual: gleiche Schlüssel/Werte gleich, fehlende oder abweichende ungleich", () => {
  assert.equal(usageMapsEqual({ go: 15, "go-plus": 60 }, { go: 15, "go-plus": 60 }), true);
  assert.equal(usageMapsEqual({ go: 15 }, { go: 15, "go-plus": 60 }), false);
  assert.equal(usageMapsEqual({ go: 15 }, { go: 30 }), false);
  assert.equal(usageMapsEqual({ go: null }, { "go-plus": null }), false);
});

test("computeDiff: erkennt hinzugefügte und entfernte Modelle", () => {
  const next = [
    ...base,
    { name: "Gamma", tier: null, usage: { go: 60 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null },
  ];
  const diff = computeDiff(base, next);
  assert.deepEqual(diff.added, ["Gamma"]);
  assert.deepEqual(diff.removed, []);
  const removed = computeDiff(next, base);
  assert.deepEqual(removed.removed, ["Gamma"]);
});

test("computeDiff: erkennt Nutzungsverbesserung als komplette Pricing-Änderung", () => {
  const next = [{ ...base[0] }, { ...base[1], usage: { go: 60 } }];
  const diff = computeDiff(base, next);
  assert.deepEqual(diff.changed, [
    {
      key: "Beta",
      from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 15 } },
      to: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 } },
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

test("computeDiff: neue Plan-Nutzung (go-plus) ist eine Änderung", () => {
  const next = [{ ...base[0], usage: { go: 60, "go-plus": 120 } }, { ...base[1] }];
  const diff = computeDiff(base, next);
  assert.equal(diff.changed.length, 1);
  assert.deepEqual(diff.changed[0].to.usage, { go: 60, "go-plus": 120 });
});

test("buildChanges: Legacy-Snapshot mit Skalar-usage erzeugt keine Phantom-go-Events", () => {
  // Vor der Plan-Umstellung war `usage` eine Zahl; der Übergang darf für
  // unveränderte go-Nutzung kein `usage_changed go: null → 60` erzeugen.
  const prev = [{ name: "Alpha", tier: null, usage: 60, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const next = [{ ...base[0], usage: { go: 60, "go-plus": 120 } }];
  assert.deepEqual(buildChanges(prev, next, [], [], "2026-09-28", new Map()), [
    { type: "usage_changed", model: "Alpha", plans: [{ plan: "go-plus", from: null, to: 120 }] },
  ]);
});

const PLAN_PLUS = {
  id: "go-plus",
  name: "Go Plus",
  priceMonthly: 40,
  creditsMonthly: 240,
  sourceUrl: "https://opencode.ai/docs/de/go/",
};

test("buildChanges: neuer Plan → genau ein plan_added zuerst, neue-Plan-Nutzung unterdrückt", () => {
  const prev = [{ name: "Alpha", tier: null, usage: { go: 60 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const next = [{ name: "Alpha", tier: null, usage: { go: 60, "go-plus": 120 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const changes = buildChanges(prev, next, [], [], "2026-09-28", new Map(), [PLAN_PLUS]);
  assert.deepEqual(changes, [
    { type: "plan_added", plan: "go-plus", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240 },
  ]);
  assert.equal(changes.filter((c) => c.type === "usage_changed").length, 0, "kein usage_changed mit neuer Plan-Id");
});

test("buildChanges: kein neuer Plan → kein plan_added", () => {
  const prev = [{ name: "Alpha", tier: null, usage: { go: 60, "go-plus": 120 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const next = [{ name: "Alpha", tier: null, usage: { go: 60, "go-plus": 120 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  assert.deepEqual(buildChanges(prev, next, [], [], "2026-09-28", new Map(), []), []);
});

test("buildChanges: neuer Plan + echte Nutzungsänderung an go → plan_added UND usage_changed (go)", () => {
  const prev = [{ name: "Alpha", tier: null, usage: { go: 60 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const next = [{ name: "Alpha", tier: null, usage: { go: 120, "go-plus": 240 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  assert.deepEqual(buildChanges(prev, next, [], [], "2026-09-28", new Map(), [PLAN_PLUS]), [
    { type: "plan_added", plan: "go-plus", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240 },
    { type: "usage_changed", model: "Alpha", plans: [{ plan: "go", from: 60, to: 120 }] },
  ]);
});

test("buildChanges: allererster Lauf (prev null) → plan_added für jeden übergebenen Plan", () => {
  assert.deepEqual(buildChanges(null, base, [], [], "2026-09-28", new Map(), [PLAN_PLUS]), [
    { type: "plan_added", plan: "go-plus", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240 },
  ]);
  // Ohne neuen Plan bleibt der Basis-Lauf leer (kein Basis-Snapshot).
  assert.deepEqual(buildChanges(null, base, [], [], "2026-09-28", new Map(), []), []);
});

test("computeDiff: reine Schreibvariante (Bindestrich vs. Leerzeichen) ist kein add/remove", () => {
  const prev = [
    { name: "MiMo V2.5", tier: null, usage: { go: 60 }, input: 0.14, output: 0.28, cachedRead: 0.0028, cachedWrite: null },
    { name: "MiMo V2.5 Pro", tier: null, usage: { go: 15 }, input: 0.435, output: 0.87, cachedRead: 0.003625, cachedWrite: null },
  ];
  const next = [
    { name: "MiMo-V2.5", tier: null, usage: { go: 60 }, input: 0.14, output: 0.28, cachedRead: 0.0028, cachedWrite: null },
    { name: "MiMo-V2.5-Pro", tier: null, usage: { go: 15 }, input: 0.435, output: 0.87, cachedRead: 0.003625, cachedWrite: null },
  ];
  const diff = computeDiff(prev, next);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed, []);
  assert.deepEqual(buildChanges(prev, next, [], [], "2026-09-22", new Map()), []);
});

test("buildChanges: Legacy-firstSeen mit undefined-Key bricht nicht", () => {
  const fs = new Map([[undefined, "2026-08-05"]]);
  assert.deepEqual(buildChanges(base, base, [], [], "2026-09-22", fs), []);
});

test("buildChanges: Schreibvariante mit Preisänderung → price_changed in stabiler Schreibweise", () => {
  const prev = [
    { name: "MiMo V2.5", tier: null, usage: { go: 60 }, input: 0.14, output: 0.28, cachedRead: 0.0028, cachedWrite: null },
  ];
  const next = [
    { name: "MiMo-V2.5", tier: null, usage: { go: 60 }, input: 0.2, output: 0.28, cachedRead: 0.0028, cachedWrite: null },
  ];
  assert.deepEqual(buildChanges(prev, next, [], [], "2026-09-22", new Map()), [
    {
      type: "price_changed",
      model: "MiMo V2.5",
      from: { input: 0.14, output: 0.28, cachedRead: 0.0028, cachedWrite: null, usage: { go: 60 } },
      to: { input: 0.2, output: 0.28, cachedRead: 0.0028, cachedWrite: null, usage: { go: 60 } },
      fields: ["input"],
    },
  ]);
});

test("computeCapabilityDiff/computePrivacyDiff: matchen trotz Schreibvariante", () => {
  const prev = [
    {
      name: "MiMo V2.5",
      tier: null,
      capabilities: { input: ["text"], output: ["text"], reasoning: false, toolCall: true },
      privacy: { training: false, retentionDays: true, validUntil: null },
    },
  ];
  const same = [
    {
      name: "MiMo-V2.5",
      tier: null,
      capabilities: { input: ["text"], output: ["text"], reasoning: false, toolCall: true },
      privacy: { training: false, retentionDays: true, validUntil: null },
    },
  ];
  assert.deepEqual(computeCapabilityDiff(prev, same), []);
  assert.deepEqual(computePrivacyDiff(prev, same), []);
  const changedCaps = [{ ...same[0], capabilities: { input: ["text", "image"], output: ["text"], reasoning: false, toolCall: true } }];
  assert.deepEqual(computeCapabilityDiff(prev, changedCaps).map((d) => d.key), ["MiMo V2.5"]);
});

test("buildChanges: Baseline ohne Vorgänger erzeugt keinen Eintrag", () => {
  assert.deepEqual(buildChanges(null, base, [], []), []);
});

test("buildChanges: Off-Peak-Stufe gilt als Normal-Nutzung (kein add/remove, Preisänderung)", () => {
  const prev = [{ name: "Delta", tier: null, usage: { go: 15 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const next = [
    { name: "Delta", tier: "Off-Peak", usage: { go: 15 }, input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null },
    { name: "Delta", tier: "Peak", usage: { go: 15 }, input: 3, output: 4, cachedRead: 0.2, cachedWrite: null },
  ];
  const changes = buildChanges(prev, next, [], []);
  assert.deepEqual(changes, [
    {
      type: "model_added",
      model: "Delta (Peak)",
      pricing: { input: 3, output: 4, cachedRead: 0.2, cachedWrite: null, usage: { go: 15 } },
    },
    {
      type: "price_changed",
      model: "Delta",
      from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 15 } },
      to: { input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 15 } },
      fields: ["input"],
    },
  ]);
});

test("buildChanges: Off-Peak mit Preis- UND Nutzungsänderung → price_changed UND usage_changed", () => {
  const prev = [{ name: "Delta", tier: null, usage: { go: 120 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const next = [
    { name: "Delta", tier: "Off-Peak", usage: { go: 15 }, input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null },
    { name: "Delta", tier: "Peak", usage: { go: 15 }, input: 3, output: 4, cachedRead: 0.2, cachedWrite: null },
  ];
  const changes = buildChanges(prev, next, [], []);
  assert.deepEqual(changes, [
    {
      type: "model_added",
      model: "Delta (Peak)",
      pricing: { input: 3, output: 4, cachedRead: 0.2, cachedWrite: null, usage: { go: 15 } },
    },
    {
      type: "price_changed",
      model: "Delta",
      from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 120 } },
      to: { input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 15 } },
      fields: ["input"],
    },
    { type: "usage_changed", model: "Delta", plans: [{ plan: "go", from: 120, to: 15 }] },
  ]);
});

test("buildChanges: Off-Peak mit NUR Nutzungsänderung erzeugt usage_changed je Stufe", () => {
  const prev = [
    { name: "Delta", tier: "Off-Peak", usage: { go: 15 }, input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null },
    { name: "Delta", tier: "Peak", usage: { go: 15 }, input: 3, output: 4, cachedRead: 0.2, cachedWrite: null },
  ];
  const next = [
    { name: "Delta", tier: "Off-Peak", usage: { go: 30 }, input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null },
    { name: "Delta", tier: "Peak", usage: { go: 30 }, input: 3, output: 4, cachedRead: 0.2, cachedWrite: null },
  ];
  assert.deepEqual(buildChanges(prev, next, [], []), [
    { type: "usage_changed", model: "Delta", plans: [{ plan: "go", from: 15, to: 30 }] },
    { type: "usage_changed", model: "Delta (Peak)", plans: [{ plan: "go", from: 15, to: 30 }] },
  ]);
});

test("buildChanges: Modell hinzugefügt (mit Pricing) und Nutzung verschlechtert", () => {
  const next = [
    { ...base[0], usage: { go: 15 } },
    { ...base[1] },
    { name: "Gamma", tier: null, usage: { go: 60 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null },
  ];
  const changes = buildChanges(base, next, [], []);
  assert.deepEqual(changes, [
    {
      type: "model_added",
      model: "Gamma",
      pricing: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 } },
    },
    { type: "usage_changed", model: "Alpha", plans: [{ plan: "go", from: 60, to: 15 }] },
  ]);
});

test("buildChanges: Nutzungsänderung in mehreren Plänen → EIN Event mit plans-Array", () => {
  const prev = [{ name: "Alpha", tier: null, usage: { go: 15, "go-plus": 60 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const next = [{ name: "Alpha", tier: null, usage: { go: 30, "go-plus": 120 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  assert.deepEqual(buildChanges(prev, next, [], []), [
    {
      type: "usage_changed",
      model: "Alpha",
      plans: [
        { plan: "go", from: 15, to: 30 },
        { plan: "go-plus", from: 60, to: 120 },
      ],
    },
  ]);
});

test("buildChanges: nur geänderte Pläne landen im plans-Array", () => {
  const prev = [{ name: "Alpha", tier: null, usage: { go: 15, "go-plus": 60 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  const next = [{ name: "Alpha", tier: null, usage: { go: 15, "go-plus": 120 }, input: 1, output: 2, cachedRead: 0.1, cachedWrite: null }];
  assert.deepEqual(buildChanges(prev, next, [], []), [
    { type: "usage_changed", model: "Alpha", plans: [{ plan: "go-plus", from: 60, to: 120 }] },
  ]);
});

test("buildChanges: reine Nutzungsänderung feuert KEIN price_changed", () => {
  const next = [{ ...base[0], usage: { go: 120 } }, { ...base[1] }];
  const changes = buildChanges(base, next, [], []);
  assert.deepEqual(changes, [
    { type: "usage_changed", model: "Alpha", plans: [{ plan: "go", from: 60, to: 120 }] },
  ]);
  assert.equal(changes.some((c) => c.type === "price_changed"), false);
});

test("buildChanges: Preisänderung enthält alte und neue Pricing-Zeile mit fields", () => {
  const next = [{ ...base[0], input: 1.5 }, { ...base[1] }];
  const changes = buildChanges(base, next, [], []);
  assert.deepEqual(changes, [
    {
      type: "price_changed",
      model: "Alpha",
      from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 } },
      to: { input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 } },
      fields: ["input"],
    },
  ]);
});

test("splitChange: nur Nutzung → usage_changed (plans-Array), nur Preis → price_changed", () => {
  const p = (o) => ({ input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 }, ...o });
  assert.deepEqual(splitChange({ key: "Alpha", from: p({}), to: p({ usage: { go: 120 } }) }), [
    { type: "usage_changed", model: "Alpha", plans: [{ plan: "go", from: 60, to: 120 }] },
  ]);
  assert.deepEqual(splitChange({ key: "Alpha", from: p({}), to: p({ cachedRead: 0.5 }) }), [
    { type: "price_changed", model: "Alpha", from: p({}), to: p({ cachedRead: 0.5 }), fields: ["cachedRead"] },
  ]);
});

test("splitChange: mehrere geänderte Pläne → ein Event mit allen im plans-Array", () => {
  const from = { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 15, "go-plus": 60 } };
  const to = { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 30, "go-plus": 120 } };
  assert.deepEqual(splitChange({ key: "Alpha", from, to }), [
    {
      type: "usage_changed",
      model: "Alpha",
      plans: [
        { plan: "go", from: 15, to: 30 },
        { plan: "go-plus", from: 60, to: 120 },
      ],
    },
  ]);
});

test("splitChange: nur ein Plan ändert sich → plans-Array mit genau einem Eintrag", () => {
  const from = { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 15, "go-plus": 60 } };
  const to = { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 15, "go-plus": 120 } };
  assert.deepEqual(splitChange({ key: "Alpha", from, to }), [
    { type: "usage_changed", model: "Alpha", plans: [{ plan: "go-plus", from: 60, to: 120 }] },
  ]);
});

test("splitChange: unveränderte Nutzung → kein usage_changed (kein leeres plans-Event)", () => {
  const p = (o) => ({ input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60, "go-plus": 120 }, ...o });
  assert.deepEqual(splitChange({ key: "Alpha", from: p({}), to: p({ input: 1.5 }) }), [
    { type: "price_changed", model: "Alpha", from: p({}), to: p({ input: 1.5 }), fields: ["input"] },
  ]);
});

test("splitChange: Preis UND Nutzung ändern sich → getrennte Events", () => {
  const from = { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 } };
  const to = { input: 1, output: 2, cachedRead: 0.5, cachedWrite: null, usage: { go: 120 } };
  assert.deepEqual(splitChange({ key: "Alpha", from, to }), [
    { type: "price_changed", model: "Alpha", from, to, fields: ["cachedRead"] },
    { type: "usage_changed", model: "Alpha", plans: [{ plan: "go", from: 60, to: 120 }] },
  ]);
});

test("splitChange: mehrere Preisfelder werden aufgelistet, Float-Toleranz zählt gleich", () => {
  const from = { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 } };
  const to = { input: 1.0000000001, output: 2, cachedRead: 0.05, cachedWrite: 0.3, usage: { go: 60 } };
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
      pricing: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 } },
    },
  ]);
});

test("buildChanges: capabilities_changed innerhalb von 72h nach model_added unterdrückt", () => {
  const prev = [
    { ...base[0], capabilities: { input: ["text"], output: ["text"], reasoning: false, toolCall: false } },
  ];
  const next = [
    { ...base[0], capabilities: { input: ["text"], output: ["text"], reasoning: true, toolCall: true } },
  ];
  const recent = new Map([["Alpha", "2026-08-04"]]);
  assert.deepEqual(buildChanges(prev, next, [], [], "2026-08-06", recent), []);
  const older = new Map([["Alpha", "2026-08-01"]]);
  assert.deepEqual(buildChanges(prev, next, [], [], "2026-08-06", older), [
    {
      type: "capabilities_changed",
      model: "Alpha",
      from: prev[0].capabilities,
      to: next[0].capabilities,
    },
  ]);
});

test("buildChanges: kostenlose Modelle hinzugefügt/entfernt", () => {
  const prevFree = [{ id: "a-free", availableFrom: "2026-08-01" }];
  const nextFree = [
    { id: "a-free", availableFrom: "2026-08-01" },
    { id: "big-pickle", availableFrom: "2026-08-05", name: "Big Pickle" },
  ];
  const added = buildChanges(base, base, prevFree, nextFree, "2026-08-06");
  assert.deepEqual(added, [{ type: "free_added", model: "big-pickle", name: "Big Pickle" }]);

  const removed = buildChanges(base, base, prevFree, [], "2026-08-06");
  assert.deepEqual(removed, [
    { type: "free_removed", model: "a-free", availableFrom: "2026-08-01", until: "2026-08-06" },
  ]);
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

test("buildChanges: kein Baseline-Event bei erstmals vorhandenem privacy", () => {
  const prev = [{ ...base[0] }];
  const next = [{ ...base[0], privacy: { training: false, retentionDays: true, validUntil: null } }];
  assert.deepEqual(buildChanges(prev, next, [], []), []);
});

test("buildChanges: keine privacy_changed bei gleichen Werten", () => {
  const p = { training: false, retentionDays: true, validUntil: null };
  const prev = [{ ...base[0], privacy: p }];
  const next = [{ ...base[0], privacy: { ...p } }];
  assert.deepEqual(buildChanges(prev, next, [], []), []);
});

test("buildChanges: reine validUntil-Änderung bei kostenlosen Modellen erzeugt keinen privacy_changed", () => {
  const prevFree = [{ id: "a-free", availableFrom: "2026-08-01", privacy: { training: true, validUntil: null } }];
  const nextFree = [{ id: "a-free", availableFrom: "2026-08-01", privacy: { training: true, validUntil: "2026-09-30" } }];
  assert.deepEqual(buildChanges(base, base, prevFree, nextFree, "2026-08-06"), []);
});

test("buildChanges: privacy_changed für kostenlose Zen-Modelle", () => {
  const prevFree = [{ id: "a-free", availableFrom: "2026-08-01", privacy: { training: true, validUntil: null } }];
  const nextFree = [{ id: "a-free", availableFrom: "2026-08-01", privacy: { training: false, retentionDays: true, validUntil: null } }];
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

test("buildChanges: capabilities_changed bei geänderten Fähigkeiten", () => {
  const cap = { input: ["text"], output: ["text"], reasoning: true, toolCall: true };
  const prev = [{ ...base[0], capabilities: null }];
  const next = [{ ...base[0], capabilities: cap }];
  const changes = buildChanges(prev, next, [], []);
  assert.deepEqual(changes, [{ type: "capabilities_changed", model: "Alpha", from: null, to: cap }]);
});

test("computePrivacyDiff: erzeugt privacy_changed nur bei Stufen-Wechsel (Erst-Befüllung/validUntil ohne Event)", () => {
  const withPrivacy = (privacy) => ({ id: "m-1", name: "M 1", privacy });
  const b = withPrivacy({ training: true, retentionDays: undefined, validUntil: null });

  const diff = computePrivacyDiff(
    [b],
    [withPrivacy({ training: false, retentionDays: true, validUntil: null })]
  );
  assert.equal(diff.length, 1);
  assert.equal(diff[0].key, "M 1");
  assert.deepEqual(diff[0].to, { training: false, retentionDays: true, validUntil: null });

  assert.equal(
    computePrivacyDiff(
      [withPrivacy({ training: false, retentionDays: 30, validUntil: null })],
      [withPrivacy({ training: false, retentionDays: true, validUntil: null })]
    ).length,
    1
  );

  assert.deepEqual(
    computePrivacyDiff(
      [withPrivacy({ training: false, retentionDays: true, validUntil: "2026-01-01" })],
      [withPrivacy({ training: false, retentionDays: true, validUntil: "2026-12-31" })]
    ),
    []
  );

  assert.deepEqual(
    computePrivacyDiff(
      [{ id: "m-1", name: "M 1", privacy: undefined }],
      [withPrivacy({ training: false, retentionDays: true, validUntil: null })]
    ),
    []
  );
});

// ---------------------------------------------------------------------------
// Changelog-Speicher (id-basiert)
// ---------------------------------------------------------------------------

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
        changes: [{ type: "usage_changed", model: "DeepSeek V4 Flash", plans: [{ plan: "go", from: 60, to: 120 }] }],
      },
      { id: "2026-08-05T00-00-00Z", date: "2026-08-05", changes: [{ type: "text", lang: { de: "Initialversion", en: "Initial version" } }] },
    ],
  };
  const result = upsertChangelogJson(existing, "2026-08-07T00-00-00Z", "2026-08-07", []);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].id, "2026-08-07T00-00-00Z");
  assert.equal(result.entries[0].changes[0].model, "DeepSeek V4 Flash");
});

test("upsertChangelogJson: verschiedene Run-ids → eigene Einträge (kein Day-Merge)", () => {
  const existing = {
    entries: [
      {
        id: "2026-08-07T06-00-00Z",
        date: "2026-08-07",
        changes: [{ type: "usage_changed", model: "Alpha", plans: [{ plan: "go", from: 60, to: 120 }] }],
      },
    ],
  };
  const result = upsertChangelogJson(
    existing,
    "2026-08-07T14-00-00Z",
    "2026-08-07",
    [{ type: "free_added", model: "big-pickle" }, { type: "usage_changed", model: "Alpha", plans: [{ plan: "go", from: 120, to: 60 }] }]
  );
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].id, "2026-08-07T14-00-00Z");
  assert.equal(result.entries[1].id, "2026-08-07T06-00-00Z");
});

test("mergeChanges: gleiche type+model → neuestes gewinnt, neue Events werden angehängt", () => {
  const a = { type: "price_changed", model: "Alpha", from: { input: 1 }, to: { input: 2 }, fields: ["input"] };
  const b = { type: "price_changed", model: "Alpha", from: { input: 2 }, to: { input: 1.5 }, fields: ["input"] };
  const c = { type: "usage_changed", model: "Alpha", plans: [{ plan: "go", from: 60, to: 120 }] };
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

test("normalizeChangelogIds: weist fehlendes id = date zu, vorhandene bleiben", () => {
  const out = normalizeChangelogIds({
    entries: [
      { date: "2026-08-15", changes: [{ type: "text", lang: { en: "Initial", de: "Start" } }] },
      { id: "2026-08-16T10-00-00Z", date: "2026-08-16", changes: [{ type: "text", lang: { en: "x", de: "x" } }] },
    ],
  });
  assert.equal(out.entries[0].id, "2026-08-15");
  assert.equal(out.entries[1].id, "2026-08-16T10-00-00Z");
});

// ---------------------------------------------------------------------------
// Changelog-Validierung
// ---------------------------------------------------------------------------

test("validateChangelog: gültiger Changelog mit allen Event-Typen (neue Form)", () => {
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
            pricing: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60, "go-plus": 120 } },
          },
          {
            type: "model_removed",
            model: "Alpha",
            days: 5,
            pricing: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 } },
          },
          {
            type: "price_changed",
            model: "Beta",
            from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 15 } },
            to: { input: 1, output: 2, cachedRead: 0.5, cachedWrite: null, usage: { go: 15 } },
            fields: ["cachedRead"],
          },
          { type: "usage_changed", model: "Beta", plans: [{ plan: "go", from: 15, to: 60 }] },
          {
            type: "capabilities_changed",
            model: "Grok 4.7",
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
          { type: "plan_added", plan: "go-plus", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240 },
        ],
      },
    ],
  };
  assert.doesNotThrow(() => validateChangelog(changelog));
});

test("validateChangelog: Legacy-Formen (Skalar-usage, usage_changed ohne plans) werden abgelehnt", () => {
  const wrap = (change) => ({
    entries: [{ id: "2026-08-06T00-00-00Z", date: "2026-08-06", changes: [change] }],
  });
  assert.throws(() =>
    validateChangelog(
      wrap({
        type: "model_added",
        model: "Gamma",
        pricing: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: 60 },
      })
    )
  );
  assert.throws(() => validateChangelog(wrap({ type: "usage_changed", model: "Beta", from: 15, to: 60 })));
});

test("validateChangelog: usage_changed akzeptiert nur die plans-Form", () => {
  assert.doesNotThrow(() =>
    validateChangelog({
      entries: [
        {
          id: "2026-08-06T00-00-00Z",
          date: "2026-08-06",
          changes: [
            { type: "usage_changed", model: "A", plans: [{ plan: "go", from: 15, to: 30 }] },
            {
              type: "usage_changed",
              model: "B",
              plans: [
                { plan: "go", from: 15, to: 30 },
                { plan: "go-plus", from: 60, to: 120 },
              ],
            },
          ],
        },
      ],
    })
  );
  const wrap = (change) => ({
    entries: [{ id: "2026-08-06T00-00-00Z", date: "2026-08-06", changes: [change] }],
  });
  // Skalar ohne Plan und die frühere plan-Form sind keine gültigen Events mehr.
  assert.throws(() => validateChangelog(wrap({ type: "usage_changed", model: "C", from: 15, to: 60 })));
  assert.throws(() => validateChangelog(wrap({ type: "usage_changed", model: "D", plan: "go", from: 15, to: 60 })));
});

test("validateChangelog: plan_added akzeptiert die vollständige Form, lehnt unvollständige ab", () => {
  const wrap = (change) => ({
    entries: [{ id: "2026-09-28T00-00-00Z", date: "2026-09-28", changes: [change] }],
  });
  assert.doesNotThrow(() =>
    validateChangelog(
      wrap({ type: "plan_added", plan: "go-plus", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240 })
    )
  );
  assert.throws(() => validateChangelog(wrap({ type: "plan_added", plan: "go-plus" })));
  assert.throws(() =>
    validateChangelog(wrap({ type: "plan_added", plan: "go-plus", name: "Go Plus", priceMonthly: 40 }))
  );
  assert.throws(() =>
    validateChangelog(wrap({ type: "plan_added", plan: "go-plus", name: "Go Plus", creditsMonthly: 240 }))
  );
  assert.throws(() =>
    validateChangelog(wrap({ type: "plan_added", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240 }))
  );
  assert.throws(() =>
    validateChangelog(wrap({ type: "plan_added", plan: "go-plus", name: "Go Plus", priceMonthly: 0, creditsMonthly: 240 }))
  );
});

test("validateChangelog: usage_changed mit leerem plans, Legacy-Feldern oder ungültigem Wert bricht", () => {
  const wrap = (change) => ({
    entries: [{ id: "2026-08-06T00-00-00Z", date: "2026-08-06", changes: [change] }],
  });
  assert.throws(() => validateChangelog(wrap({ type: "usage_changed", model: "A", plans: [] })));
  assert.throws(() => validateChangelog(wrap({ type: "usage_changed", model: "A" })));
  assert.throws(() =>
    validateChangelog(
      wrap({ type: "usage_changed", model: "A", plans: [{ plan: "go", from: 15, to: 30 }], from: 15 })
    )
  );
  assert.throws(() => validateChangelog(wrap({ type: "usage_changed", model: "A", from: 15 })));
  assert.throws(() =>
    validateChangelog(wrap({ type: "usage_changed", model: "A", plans: [{ plan: "go", from: -1, to: 30 }] }))
  );
});

test("validateChangelog: fehlende fields, leere fields, ungültige usage brechen", () => {
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
              from: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 } },
              to: { input: 1.5, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 60 } },
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
          changes: [{ type: "price_changed", model: "X", from: {}, to: {}, fields: [] }],
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
          changes: [{ type: "usage_changed", model: "X", plans: [{ plan: "go", from: -1, to: 60 }] }],
        },
      ],
    })
  );
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
          changes: [{ type: "capabilities_changed", model: "X", from: null, to: { input: ["text"] } }],
        },
      ],
    })
  );
});

// ---------------------------------------------------------------------------
// Snapshot-Validierung
// ---------------------------------------------------------------------------

const SNAPSHOT_PLANS = [
  { id: "go", name: "Go", priceMonthly: 10, creditsMonthly: 60, sourceUrl: "https://opencode.ai/docs/de/go/" },
  { id: "go-plus", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240, sourceUrl: "https://opencode.ai/docs/de/go/" },
];

test("validateSnapshot: gültiger Snapshot (alle Modelle mit Token-Stats)", () => {
  const snapshot = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/docs/de/zen/",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    plans: SNAPSHOT_PLANS,
    peakHours: {},
    models: parseHtml(fixture).map((m) => ({ ...m, contextWindow: null })),
    freeModels: [
      {
        id: "big-pickle",
        fullId: "opencode/big-pickle",
        availableFrom: "2026-08-05",
        capabilities: null,
        contextWindow: null,
        privacy: { training: true, validUntil: null },
      },
    ],
  };
  assert.doesNotThrow(() => validateSnapshot(snapshot));
});

test("validateSnapshot: fehlende Token-Stats (pattern) brechen die Validierung", () => {
  const models = parseHtml(fixture);
  const withUsage = models.find((m) => Object.values(m.usage).some((v) => v !== null));
  const withoutPattern = { ...withUsage, pattern: null, contextWindow: null };
  const snapshot = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/docs/de/zen/",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    plans: SNAPSHOT_PLANS,
    peakHours: {},
    models: [withoutPattern],
    freeModels: [],
  };
  assert.throws(() => validateSnapshot(snapshot));
});

test("validateSnapshot: kostenlose Zeile (Preise 0, usage null) ohne Token-Stats ist gültig", () => {
  const snapshot = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/docs/de/zen/",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    plans: SNAPSHOT_PLANS,
    peakHours: {},
    models: [
      {
        name: "Ox Alpha Free",
        tier: null,
        input: 0,
        output: 0,
        cachedRead: 0,
        cachedWrite: 0,
        usage: { go: null, "go-plus": null },
        pattern: null,
        capabilities: null,
        contextWindow: null,
        privacy: { training: true, validUntil: null },
      },
    ],
    freeModels: [],
  };
  assert.doesNotThrow(() => validateSnapshot(snapshot));
});

test("validateSnapshot: kostenloses Modell ohne privacy bricht", () => {
  const snapshot = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/docs/de/zen/",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    plans: SNAPSHOT_PLANS,
    peakHours: {},
    models: parseHtml(fixture).map((m) => ({ ...m, contextWindow: null })),
    freeModels: [{ id: "big-pickle", fullId: "opencode/big-pickle", availableFrom: "2026-08-05", capabilities: null, contextWindow: null }],
  };
  assert.throws(() => validateSnapshot(snapshot));
});

test("validateSnapshot: kostenloses Modell ohne fullId bricht", () => {
  const snapshot = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/docs/de/zen/",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    plans: SNAPSHOT_PLANS,
    peakHours: {},
    models: parseHtml(fixture).map((m) => ({ ...m, contextWindow: null })),
    freeModels: [
      {
        id: "big-pickle",
        availableFrom: "2026-08-05",
        capabilities: null,
        contextWindow: null,
        privacy: { training: true, validUntil: null },
      },
    ],
  };
  assert.throws(() => validateSnapshot(snapshot));
});

test("validateSnapshot: Plan-Id ist frei (kein enum) — künftige Pläne validieren", () => {
  const snapshot = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/docs/de/zen/",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    plans: [...SNAPSHOT_PLANS, { id: "go-ultra", name: "Go Ultra", priceMonthly: 100, creditsMonthly: 1000, sourceUrl: "https://opencode.ai/docs/de/go/" }],
    peakHours: {},
    // Ein künftiger Plan liefert für jedes Modell eine Nutzung — die
    // usage-Schlüssel müssen exakt den Plan-Ids entsprechen. Der Wert spiegelt
    // die bestehende go-Nutzung (kostenlose Zeilen bleiben null).
    models: parseHtml(fixture).map((m) => ({ ...m, contextWindow: null, usage: { ...m.usage, "go-ultra": m.usage.go } })),
    freeModels: [],
  };
  assert.doesNotThrow(() => validateSnapshot(snapshot));
});

test("validateSnapshot: usage-Schlüssel müssen exakt die Plan-Ids sein", () => {
  const base = {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/docs/de/zen/",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    plans: SNAPSHOT_PLANS,
    peakHours: {},
    models: parseHtml(fixture).map((m) => ({ ...m, contextWindow: null })),
    freeModels: [],
  };
  assert.doesNotThrow(() => validateSnapshot(base));
  // Fehlender Plan-Schlüssel → rot.
  const missing = structuredClone(base);
  delete missing.models[0].usage.go;
  assert.throws(() => validateSnapshot(missing), /usage-Schlüssel/);
  // Unbekannter Plan-Schlüssel → rot.
  const extra = structuredClone(base);
  extra.models[0].usage.phantom = 5;
  assert.throws(() => validateSnapshot(extra), /usage-Schlüssel/);
});

test("validateSnapshot: Free-Modelle tragen keine Plan-Dimension (usage/plan/allowances)", () => {
  const makeSnapshot = (freeExtra) => ({
    fetchedAt: "2026-08-05T00:00:00.000Z",
    sourceUrl: "https://opencode.ai/docs/de/go/",
    freeModelsSourceUrl: "https://opencode.ai/docs/de/zen/",
    capabilitiesSourceUrl: "https://models.dev",
    sourceLang: "de",
    plans: SNAPSHOT_PLANS,
    peakHours: {},
    models: parseHtml(fixture).map((m) => ({ ...m, contextWindow: null })),
    freeModels: [
      {
        id: "big-pickle",
        fullId: "opencode/big-pickle",
        availableFrom: "2026-08-05",
        capabilities: null,
        contextWindow: null,
        privacy: { training: true, validUntil: null },
        ...freeExtra,
      },
    ],
  });
  assert.doesNotThrow(() => validateSnapshot(makeSnapshot()));
  for (const key of ["usage", "plan", "plans", "allowances"]) {
    assert.throws(() => validateSnapshot(makeSnapshot({ [key]: key === "usage" ? { go: 60 } : "go" })));
  }
});

test("buildChanges: free_added/free_removed sind plan-unabhängig (kein plan/plans)", () => {
  const prevFree = [{ id: "a-free", availableFrom: "2026-08-01" }];
  const nextFree = [
    { id: "a-free", availableFrom: "2026-08-01" },
    { id: "big-pickle", availableFrom: "2026-08-05", name: "Big Pickle" },
  ];
  const added = buildChanges(base, base, prevFree, nextFree, "2026-08-06");
  const removed = buildChanges(base, base, prevFree, [], "2026-08-06");
  for (const c of [...added, ...removed]) {
    assert.equal("plan" in c, false, `${c.type} darf kein plan-Feld haben`);
    assert.equal("plans" in c, false, `${c.type} darf kein plans-Feld haben`);
  }
  assert.deepEqual(added, [{ type: "free_added", model: "big-pickle", name: "Big Pickle" }]);
  assert.deepEqual(removed, [
    { type: "free_removed", model: "a-free", availableFrom: "2026-08-01", until: "2026-08-06" },
  ]);
});

// ---------------------------------------------------------------------------
// models.dev-Anreicherung
// ---------------------------------------------------------------------------

test("enrichCapabilities: löst über den opencode-Provider auf", () => {
  const models = [{ name: "Grok 4.7", tier: null }];
  const opencodeModels = {
    "grok-4.7": {
      id: "grok-4.7",
      name: "Grok 4.7",
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

test("enrichCapabilities: befüllt provider aus dem models.dev-id-Prefix", () => {
  const models = [{ name: "Grok 4.7", tier: null }];
  const metadataModels = {
    "xai/grok-4.7": {
      id: "xai/grok-4.7",
      name: "Grok 4.7",
      modalities: { input: ["text"], output: ["text"] },
    },
  };
  const enriched = enrichCapabilities(models, {}, metadataModels);
  assert.equal(enriched[0].provider, "xAI");
});

test("enrichCapabilities: provider null ohne ableitbaren Prefix", () => {
  const models = [{ name: "Intern", tier: null }];
  const opencodeModels = {
    intern: { id: "intern", name: "Intern", modalities: { input: ["text"], output: ["text"] } },
  };
  const enriched = enrichCapabilities(models, opencodeModels, {});
  assert.equal(enriched[0].provider, null);
});

test("enrichCapabilities: mappt glm-flash-Familie auf Z.ai (kein Glm-Flash-Fallback)", () => {
  const models = [{ name: "GLM-5.3-Flash", tier: null }];
  const opencodeModels = {
    "glm-5.3-flash": {
      id: "glm-5.3-flash",
      name: "GLM-5.3-Flash",
      family: "glm-flash",
      modalities: { input: ["text"], output: ["text"] },
    },
  };
  const enriched = enrichCapabilities(models, opencodeModels, {});
  assert.equal(enriched[0].provider, "Z.ai");
});

test("enrichCapabilities: mappt muse-Familie auf Meta (konsistent mit muse-free)", () => {
  const models = [{ name: "Muse Spark 1.3 Contributor", tier: null }];
  const opencodeModels = {
    "muse-spark-1.3": {
      id: "muse-spark-1.3",
      name: "Muse Spark 1.3 Contributor",
      family: "muse",
      modalities: { input: ["text"], output: ["text"] },
    },
  };
  const enriched = enrichCapabilities(models, opencodeModels, {});
  assert.equal(enriched[0].provider, "Meta");
});

test("enrichCapabilities: Stealth-IDs bekommen OpenCode Stealth (Vorrang vor models.dev)", () => {
  const models = [{ name: "Union Alpha Free", tier: null }];
  const goModels = {
    "union-alpha": { id: "union-alpha", name: "Union Alpha Free", family: "alpha" },
  };
  const enriched = enrichCapabilities(models, {}, {}, goModels);
  assert.equal(enriched[0].id, "opencode-go/union-alpha");
  assert.equal(enriched[0].provider, "OpenCode Stealth");
});

test("enrichCapabilities: Space Bunny Free (Go-Preiszeile) → OpenCode Stealth", () => {
  const models = [{ name: "Space Bunny Free", tier: null }];
  const goModels = {
    "space-bunny-free": { id: "space-bunny-free", name: "Space Bunny Free", family: "space-bunny" },
  };
  const enriched = enrichCapabilities(models, {}, {}, goModels);
  assert.equal(enriched[0].id, "opencode-go/space-bunny-free");
  assert.equal(enriched[0].provider, "OpenCode Stealth");
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

// ---------------------------------------------------------------------------
// Zen-Free-Models
// ---------------------------------------------------------------------------

test("parseZenEndpointIds: mappt normalisierten Modellnamen → Model-ID", () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "zen-de.html"), "utf8");
  const ids = parseZenEndpointIds(html);
  assert.equal(ids.get("bigpickle"), "big-pickle");
  assert.equal(ids.get("mimov2.5free"), "mimo-v2.5-free");
  assert.equal(ids.get("nemotron3.5lightningfree"), "nemotron-3.5-lightning-free");
  assert.equal(ids.size, 8);
});

test("extractFreeModelsFromDocs: extrahiert nur die kostenlosen Modelle aus Endpunkte + Preise", () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "zen-de.html"), "utf8");
  assert.deepEqual(extractFreeModelsFromDocs(html), [
    "big-pickle",
    "hy3-free",
    "mimo-v2.5-free",
    "muse-spark-1.2-contributor-free",
    "nemotron-3-ultra-free",
    "nemotron-3.5-lightning-free",
  ]);
});

test("extractFreeModelsFromDocs: ignoriert kostenpflichtige Modelle", () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "zen-de.html"), "utf8");
  const free = extractFreeModelsFromDocs(html);
  assert.ok(!free.includes("deepseek-v4-flash"));
  assert.ok(!free.includes("minimax-m3"));
});

test("extractFreeModelsFromDocs: erkennt deutsche „Kostenlos“-Zeilen (z. B. Jev 1.13 Free)", () => {
  const html = `<!DOCTYPE html><html><body>
<h2 id="endpunkte">Endpunkte</h2>
<table><thead><tr><th>Modell</th><th>ID</th></tr></thead><tbody>
<tr><td>Jev 1.13 Free</td><td>jev-1.13-free</td></tr>
<tr><td>Jev 1.13</td><td>jev-1.13</td></tr>
</tbody></table>
<h2 id="preise">Preise</h2>
<table><thead><tr><th>Modell</th><th>Input</th><th>Output</th></tr></thead><tbody>
<tr><td>Jev 1.13 Free</td><td>Kostenlos</td><td>Kostenlos</td></tr>
<tr><td>Jev 1.13</td><td>$0.042</td><td>Kostenlos</td></tr>
</tbody></table>
</body></html>`;
  assert.deepEqual(extractFreeModelsFromDocs(html), ["jev-1.13-free"]);
});

test("parseZenFreeModelPrivacy: klassifiziert ZDR, Training und „keine Aussage“", () => {
  const html = `<!DOCTYPE html><html><body>
<h2 id="preise">Preise</h2>
<p>Die kostenlosen Modelle:</p>
<ul>
<li>Space Bunny Free ist für begrenzte Zeit kostenlos. Der Anbieter befolgt eine Zero-Retention-Richtlinie und verwendet deine Daten nicht zum Trainieren von Modellen.</li>
<li>Big Pickle ist ein Stealth-Modell. Das Team nutzt diese Zeit, um Feedback zu sammeln und das Modell zu verbessern.</li>
<li>Jev 1.13 Free ist für begrenzte Zeit auf OpenCode verfügbar.</li>
<li>Unbekannt Free ist für begrenzte Zeit verfügbar — nicht in der Endpunkte-Tabelle.</li>
</ul>
</body></html>`;
  const $ = cheerio.load(html);
  const idsByName = new Map([
    ["spacebunnyfree", "space-bunny-free"],
    ["bigpickle", "big-pickle"],
    ["jev1.13free", "jev-1.13-free"],
  ]);
  const privacy = parseZenFreeModelPrivacy($, idsByName);
  assert.deepEqual(privacy.get("space-bunny-free"), { training: false, retentionDays: true, validUntil: null });
  assert.deepEqual(privacy.get("big-pickle"), { training: true, validUntil: null });
  assert.equal(privacy.has("jev-1.13-free"), false);
  assert.equal(privacy.size, 2);
});

test("parseZenFreeModelPrivacy: fehlende Liste → leere Map (kein Fehler)", () => {
  const $ = cheerio.load("<p>Die kostenlosen Modelle:</p><p>kein Listen-Element</p>");
  const privacy = parseZenFreeModelPrivacy($, new Map());
  assert.equal(privacy.size, 0);
});

test("parseZenFreeModelPrivacy: erkennt Trainings-Varianten (Verbesserung/Training)", () => {
  const html = `<p>Die kostenlosen Modelle:</p><ul>
<li>A Free ist verfügbar. Der Anbieter verwendet Daten zur Verbesserung des Modells.</li>
<li>B Free ist verfügbar. Die Daten werden zum Trainieren verwendet.</li>
</ul>`;
  const idsByName = new Map([
    ["afree", "a-free"],
    ["bfree", "b-free"],
  ]);
  const privacy = parseZenFreeModelPrivacy(cheerio.load(html), idsByName);
  assert.deepEqual(privacy.get("a-free"), { training: true, validUntil: null });
  assert.deepEqual(privacy.get("b-free"), { training: true, validUntil: null });
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

test("enrichFreeModels: befüllt provider aus dem models.dev-id-Prefix", () => {
  const free = [{ id: "some-model", availableFrom: "2026-08-05" }];
  const metadataModels = {
    "opencode/some-model": {
      id: "opencode/some-model",
      name: "Some Model",
      modalities: { input: ["text"], output: ["text"] },
    },
  };
  const enriched = enrichFreeModels(free, {}, metadataModels);
  assert.equal(enriched[0].provider, "OpenCode");
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

test("enrichFreeModels: Provider-Familie longcat → Hersteller Meituan", () => {
  const zenModels = {
    "longcat-2.5-preview-free": {
      id: "longcat-2.5-preview-free",
      name: "LongCat 2.5 Preview Free",
      family: "longcat",
      limit: { context: 1_000_000 },
      modalities: { input: ["text", "image"], output: ["text"] },
    },
  };
  const enriched = enrichFreeModels([{ id: "longcat-2.5-preview-free", availableFrom: "2026-09-26" }], zenModels, {});
  assert.equal(enriched[0].provider, "Meituan");
});

test("enrichFreeModels: setzt privacy (Modelltraining) für Zen-Modelle", () => {
  const enriched = enrichFreeModels([{ id: "big-pickle", availableFrom: "2026-08-05" }], {}, {});
  assert.deepEqual(enriched[0].privacy, { training: true, validUntil: null });
});

test("enrichFreeModels: geparste ZDR-Fußnote schlägt den Default", () => {
  const privacyById = new Map([["space-bunny-free", { training: false, retentionDays: true, validUntil: null }]]);
  const enriched = enrichFreeModels([{ id: "space-bunny-free", availableFrom: "2026-09-23" }], {}, {}, {}, privacyById);
  assert.deepEqual(enriched[0].privacy, { training: false, retentionDays: true, validUntil: null });
});

test("enrichFreeModels: FREE_MODEL_PRIVACY_OVERRIDES schlägt die geparste Map", () => {
  const privacyById = new Map([["big-pickle", { training: false, retentionDays: true, validUntil: null }]]);
  const enriched = enrichFreeModels(
    [
      { id: "big-pickle", availableFrom: "2026-08-05" },
      { id: "x-preview-f-free", availableFrom: "2026-08-20" },
    ],
    {},
    {},
    {},
    privacyById
  );
  assert.deepEqual(enriched[0].privacy, { training: false, retentionDays: true, validUntil: null });
  assert.deepEqual(enriched[1].privacy, { training: false, retentionDays: true, validUntil: null });
});

test("enrichFreeModels: ohne Map-Eintrag bleibt training:true (unbekannt)", () => {
  const privacyById = new Map([["other-free", { training: false, retentionDays: true, validUntil: null }]]);
  const enriched = enrichFreeModels([{ id: "big-pickle", availableFrom: "2026-08-05" }], {}, {}, {}, privacyById);
  assert.deepEqual(enriched[0].privacy, { training: true, validUntil: null });
});

test("enrichFreeModels: Stealth-IDs bekommen OpenCode Stealth", () => {
  const enriched = enrichFreeModels(
    [
      { id: "big-pickle", availableFrom: "2026-08-05" },
      { id: "union-alpha", availableFrom: "2026-09-16" },
      { id: "space-bunny-free", availableFrom: "2026-09-23" },
    ],
    {},
    {}
  );
  assert.equal(enriched[0].provider, "OpenCode Stealth");
  assert.equal(enriched[1].provider, "OpenCode Stealth");
  assert.equal(enriched[2].provider, "OpenCode Stealth");
});

test("enrichFreeModels: setzt fullId mit opencode-Prefix (Fallback ohne models.dev-Treffer)", () => {
  const enriched = enrichFreeModels([{ id: "does-not-exist-free", availableFrom: "2026-08-05" }], {}, {});
  assert.equal(enriched[0].fullId, "opencode/does-not-exist-free");
});

test("enrichFreeModels: fullId bevorzugt opencode-go vor opencode", () => {
  const free = [{ id: "union-alpha", availableFrom: "2026-09-16" }];
  const zenModels = { "union-alpha": { id: "union-alpha", name: "Union Alpha" } };
  const goModels = { "union-alpha": { id: "union-alpha", name: "Union Alpha" } };
  const enriched = enrichFreeModels(free, zenModels, {}, goModels);
  assert.equal(enriched[0].fullId, "opencode-go/union-alpha");
});

test("enrichFreeModels: lässt capabilities null bei unbekannter ID", () => {
  const enriched = enrichFreeModels([{ id: "does-not-exist-free", availableFrom: "2026-08-05" }], {}, {});
  assert.equal(enriched[0].capabilities, null);
});

// ---------------------------------------------------------------------------
// Datum
// ---------------------------------------------------------------------------

test("parseGermanDate: deutsches Datum → ISO, ungültige Eingaben → null", () => {
  assert.equal(parseGermanDate("31. August 2026"), "2026-08-31");
  assert.equal(parseGermanDate("5. Januar 2026"), "2026-01-05");
  assert.equal(parseGermanDate("3. Februar 2026."), "2026-02-03");
  assert.equal(parseGermanDate("31. Oktober 2026"), "2026-10-31");
  assert.equal(parseGermanDate("32. August 2026"), null);
  assert.equal(parseGermanDate("31. August"), null);
  assert.equal(parseGermanDate("31. Monat 2026"), null);
  assert.equal(parseGermanDate("gibtsnicht"), null);
  assert.equal(parseGermanDate(null), null);
});

// ---------------------------------------------------------------------------
// Generierter Datensatz (data/latest.json): Plan-Dimension nur auf models[],
// freeModels bleiben plan-unabhängig.
// ---------------------------------------------------------------------------

test("data/latest.json: 39 Modelle, usage-Schlüssel == Plan-Ids, 10 Free-Modelle ohne Plan-Feld", () => {
  const data = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data", "latest.json"), "utf8"));
  const planIds = data.plans.map((p) => p.id);
  assert.deepEqual(planIds, ["go", "go-plus"]);
  assert.equal(data.models.length, 39);
  for (const m of data.models) {
    assert.deepEqual(Object.keys(m.usage).slice().sort(), planIds.slice().sort(), `${m.name}: usage-Schlüssel`);
  }
  assert.equal(data.freeModels.length, 10);
  for (const f of data.freeModels) {
    for (const key of ["usage", "plan", "plans", "allowances"]) {
      assert.equal(key in f, false, `${f.id}: Free-Modell darf kein ${key}-Feld haben`);
    }
  }
  assert.doesNotThrow(() => validateSnapshot(data));
});
