import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import solid from "vite-plugin-solid";
import * as cheerio from "cheerio";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "tests", ".ssr");
const FIELDS = ["input", "output", "cachedRead", "cachedWrite", "cost", "requests"];
const BASES = ["list", "full", "paid"];
// Beide echten Pläne (Zahlen aus data/latest.json): Tokenpreise identisch,
// Nutzung pro Plan verschieden → jede Sortierung hängt am aktiven Plan.
const PLAN = {
  id: "go",
  name: "Go",
  priceMonthly: 10,
  creditsMonthly: 60,
  sourceUrl: "https://opencode.ai/docs/de/go/",
};
const PLAN_PLUS = {
  id: "go-plus",
  name: "Go Plus",
  priceMonthly: 40,
  creditsMonthly: 240,
  sourceUrl: "https://opencode.ai/docs/de/go/",
};
const PLANS = [PLAN, PLAN_PLUS];

let ssr;
let models;

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
  ssr = await import(pathToFileURL(entry).href);
  models = JSON.parse(readFileSync(join(ROOT, "data", "latest.json"), "utf8")).models;
});

const displayedValue = (m, field, basis, plan) =>
  field === "cost" ? ssr.requestCost(m, basis, plan)
  : field === "requests" ? ssr.requestsPerMonth(m, plan)
  : ssr.fieldPrice(m, field, basis, plan);

const extractRowNames = (html) => {
  const $ = cheerio.load(html);
  const names = [];
  $("tbody tr").each((_, tr) => {
    names.push(
      $(tr)
        .find("th span.block")
        .first()
        .text()
        .trim()
    );
  });
  return names;
};

const expectedOrder = (field, basis, dir, plan) =>
  [...models]
    .sort((a, b) => {
      const va = displayedValue(a, field, basis, plan);
      const vb = displayedValue(b, field, basis, plan);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va - vb) * dir;
    })
    .map((m) => m.name);

test("Changelog: Run-id rendert die Uhrzeit (MEZ/MESZ), Anker = entry.id, mehrere Einträge/Tag", () => {
  const html = ssr.renderChangelog(
    [
      {
        id: "2026-08-28T09-46-46Z",
        date: "2026-08-28",
        changes: [{ type: "text", lang: { en: "Morning run", de: "Morgenlauf" } }],
      },
      {
        id: "2026-08-28T06-08-51Z",
        date: "2026-08-28",
        changes: [{ type: "text", lang: { en: "Early run", de: "Frühlauf" } }],
      },
      // Altschema-Eintrag: id = date → keine Uhrzeit
      { id: "2026-08-26", date: "2026-08-26", changes: [{ type: "free_added", model: "ox-alpha", name: "Ox Alpha Free" }] },
    ],
    PLANS
  );
  const $ = cheerio.load(html);

  // Beide Einträge desselben Tages erhalten einen eigenen id-Anker.
  assert.equal($("#2026-08-28T09-46-46Z").length, 1);
  assert.equal($("#2026-08-28T06-08-51Z").length, 1);

  // 2026-08-28T09:46:46Z → 11:46 in Europa/Wien (MESZ, UTC+2).
  assert.match($("#2026-08-28T09-46-46Z h3").text(), /11:46/);
  // 2026-08-28T06:08:51Z → 08:08 in Europa/Wien (MESZ, UTC+2).
  assert.match($("#2026-08-28T06-08-51Z h3").text(), /08:08/);

  // Altschema (id = Datum): Datum ohne Uhrzeit.
  assert.doesNotMatch($("#2026-08-26 h3").text(), /\d{1,2}:\d{2}/);
});

test("Changelog: usage_changed rendert neue plans-Form mit Plan-Labels UND Legacy-Form ohne Label", () => {
  const html = ssr.renderChangelog(
    [
      {
        id: "2026-09-28T10-00-00Z",
        date: "2026-09-28",
        changes: [
          {
            type: "usage_changed",
            model: "GLM-5.3",
            plans: [
              { plan: "go", from: 15, to: 30 },
              { plan: "go-plus", from: 120, to: 240 },
            ],
          },
          // Legacy-Form (vor der Plan-Einführung): skalar, ohne Plan.
          { type: "usage_changed", model: "Old Model", from: 30, to: 60 },
          // price_changed mit Usage-Map (Plan-Labels) — Nutzung mit Änderung gefettet.
          {
            type: "price_changed",
            model: "DeepSeek V4 Flash",
            from: { input: 0.22, output: 0.66, cachedRead: 0.007, cachedWrite: null, usage: { go: 120 } },
            to: { input: 0.15, output: 0.6, cachedRead: 0.003, cachedWrite: null, usage: { go: 15 } },
            fields: ["input", "output", "cachedRead"],
          },
          // model_added mit Usage-Map.
          {
            type: "model_added",
            model: "Neu",
            pricing: { input: 1, output: 2, cachedRead: 0.1, cachedWrite: null, usage: { go: 15, "go-plus": 120 } },
          },
        ],
      },
    ],
    PLANS,
    "de"
  );
  const text = cheerio.load(html)("#changelog").text().replace(/\s+/g, " ");
  // Neue Form: Plan-Label + alte/neue Nutzung. Der Aufruf nutzt den Default-Plan
  // „go", deshalb ist hier nur der Go-Teil sichtbar (die Go-Plus-Ansicht prüft der
  // eigene Test „Changelog ist pro Plan").
  assert.match(text, /GLM-5\.3: Nutzung Go \$15 → \$30/);
  assert.doesNotMatch(text, /Go Plus \$120 → \$240/);
  // Legacy-Form: ohne Plan-Label (byte-stabil zur bereits veröffentlichten Release).
  assert.match(text, /Old Model: Nutzung \$30 → \$60/);
  // Usage-Map in der Preiszeile/`model_added`: alle Pläne mit Label, ∞ beibehalten.
  // Diese Zeilen bleiben plan-übergreifend — die Tokenpreise gelten in beiden Plänen.
  assert.match(text, /DeepSeek V4 Flash: .*@ Go \$120 → .*@ Go \$15/);
  assert.match(text, /Neu hinzugefügt .*@ Go \$15 \/ Go Plus \$120/);
});

// `plan × basis × field × dir`: beide Pläne werden in jedem Test geprüft (die
// Test-Anzahl bleibt stabil, statt die Matrix zu vervierfachen).
for (const basis of BASES) {
  for (const field of FIELDS) {
    for (const dir of [1, -1]) {
      test(`Sortierung ${basis}/${field}/${dir === 1 ? "asc" : "desc"} = Reihenfolge der angezeigten Werte (Plan go + go-plus)`, () => {
        for (const plan of PLANS) {
          const expected = expectedOrder(field, basis, dir, plan);
          const html = ssr.renderPriceTable(models, {
            basis,
            sortField: field,
            sortDir: dir,
            plan,
            lang: "de",
          });
          assert.deepEqual(extractRowNames(html), expected, `Plan ${plan.id} (${basis}/${field})`);
        }
      });
    }
  }
}

test("paid-Basis input asc: Effektivpreis entscheidet, nicht der rohe Listenpreis (Regression GLM-5.2 vs. GLM-5.3, beide Pläne)", () => {
  const glm52 = models.find((m) => m.name === "GLM-5.2");
  const glm53 = models.find((m) => m.name === "GLM-5.3");
  assert.ok(glm52 && glm53, "GLM-5.2 und GLM-5.3 sind im Datensatz");
  assert.equal(glm52.input, glm53.input, "rohe Input-Preise sind identisch (1.40)");
  for (const plan of PLANS) {
    assert.ok(
      displayedValue(glm52, "input", "paid", plan) < displayedValue(glm53, "input", "paid", plan),
      `Effektivpreis (paid, ${plan.id}) von GLM-5.2 ist wegen der höheren Nutzung niedriger`
    );
    const names = extractRowNames(
      ssr.renderPriceTable(models, {
        basis: "paid",
        sortField: "input",
        sortDir: 1,
        plan,
        lang: "de",
      })
    );
    assert.ok(
      names.indexOf("GLM-5.2") < names.indexOf("GLM-5.3"),
      `GLM-5.2 muss vor GLM-5.3 stehen (Plan ${plan.id})`
    );
  }
});

test("Gratis-Zeilen (unbegrenzte Nutzung): volles Guthaben zeigt $0, paid zeigt – (Regression)", () => {
  const free = models.filter((m) => m.usage.go === null && m.usage["go-plus"] === null);
  assert.ok(free.length > 0, "Datensatz enthält Gratis-Zeilen mit unbegrenzter Nutzung in beiden Plänen");

  for (const m of free) {
    for (const plan of PLANS) {
      // `full`: kein Multiplikator, aber der Listenpreis IST bekannt (0) → 0, nicht null.
      assert.equal(
        displayedValue(m, "input", "full", plan),
        0,
        `${m.name} (${plan.id}): full-Basis liefert 0 statt null`
      );
      // `paid`: Nutzung im Nenner fehlt → null (unverändertes Verhalten).
      assert.equal(
        displayedValue(m, "input", "paid", plan),
        null,
        `${m.name} (${plan.id}): paid-Basis liefert null (kein Faktor ohne Nutzung)`
      );
    }
  }

  // Gerendert: volles Guthaben → "$0.00" in der Input-Spalte, paid → "–".
  const full = cheerio.load(
    ssr.renderPriceTable(models, { basis: "full", sortField: "input", sortDir: 1, plan: PLAN, lang: "de" })
  );
  const paid = cheerio.load(
    ssr.renderPriceTable(models, { basis: "paid", sortField: "input", sortDir: 1, plan: PLAN, lang: "de" })
  );
  // Zellspalten: 0 = Fähigkeiten-Badges, 1 = Input, 2 = Output, 3 = Cached Read,
  // 4 = Cached Write, 5 = Nutzung, 6 = Kosten/Anfrage, 7 = Anfragen/Monat.
  const inputCell = ($, name) => {
    let found = null;
    $("tbody tr").each((_, tr) => {
      if ($(tr).find("th span.block").first().text().trim().startsWith(name)) {
        found = $(tr).find("td").eq(1).text().trim();
      }
    });
    return found;
  };
  for (const m of free) {
    // Format: `Intl.NumberFormat(maximumFractionDigits: 2)` rendert 0 als "$0"
    // (kein erzwungenes Nachkomma) — entspricht dem Verhalten vor der Plan-Umstellung.
    assert.equal(inputCell(full, m.name), "$0", `${m.name}: full-Basis zeigt $0, nicht –`);
    assert.equal(inputCell(paid, m.name), "–", `${m.name}: paid-Basis zeigt – (kein Faktor)`);
  }
});

test("Changelog ist pro Plan: Go-Plus-Ansicht zeigt keine Go-Nutzungsänderungen (und umgekehrt)", () => {
  const entry = {
    id: "2026-09-28T10-00-00Z",
    date: "2026-09-28",
    changes: [
      // Beide Pläne geändert → in jeder Ansicht sichtbar, aber nur mit dem
      // Plan, der gerade aktiv ist.
      {
        type: "usage_changed",
        model: "GLM-5.3",
        plans: [
          { plan: "go", from: 15, to: 30 },
          { plan: "go-plus", from: 120, to: 240 },
        ],
      },
      // Nur Go geändert → in der Go-Plus-Ansicht komplett unsichtbar.
      { type: "usage_changed", model: "Kimi K3", plans: [{ plan: "go", from: 15, to: 45 }] },
      // Nur Go Plus geändert → in der Go-Ansicht komplett unsichtbar.
      { type: "usage_changed", model: "Qwen3.8 Max", plans: [{ plan: "go-plus", from: 60, to: 180 }] },
      // Legacy (nur Go gab es) → gehört zu Go.
      { type: "usage_changed", model: "Alt", from: 30, to: 60 },
      // Plan-unabhängige Events → in beiden Ansichten.
      { type: "free_added", model: "big-pickle", name: "Big Pickle" },
    ],
  };
  const text = (planId) =>
    cheerio
      .load(ssr.renderChangelog([entry], PLANS, "de", planId))
      .text()
      .replace(/\s+/g, " ");

  const go = text("go");
  assert.match(go, /GLM-5\.3: Nutzung Go \$15 → \$30/, "Go: eigener Plan-Wert sichtbar");
  assert.doesNotMatch(go, /Go Plus \$120 → \$240/, "Go: Go-Plus-Wert NICHT sichtbar");
  assert.match(go, /Kimi K3: Nutzung Go \$15 → \$45/, "Go: nur-Go-Event sichtbar");
  assert.doesNotMatch(go, /Qwen3\.8 Max/, "Go: nur-Go-Plus-Event NICHT sichtbar");
  assert.match(go, /Alt: Nutzung \$30 → \$60/, "Go: Legacy-Event gehört zu Go");
  assert.match(go, /Big Pickle/, "Go: plan-unabhängiges Event sichtbar");

  const plus = text("go-plus");
  assert.match(plus, /GLM-5\.3: Nutzung Go Plus \$120 → \$240/, "Go Plus: eigener Plan-Wert sichtbar");
  assert.doesNotMatch(plus, /Go \$15 → \$30/, "Go Plus: Go-Wert NICHT sichtbar");
  assert.doesNotMatch(plus, /Kimi K3/, "Go Plus: nur-Go-Event NICHT sichtbar");
  assert.match(plus, /Qwen3\.8 Max: Nutzung Go Plus \$60 → \$180/, "Go Plus: eigenes Event sichtbar");
  assert.doesNotMatch(plus, /Alt: Nutzung/, "Go Plus: Legacy-Event (Go) NICHT sichtbar");
  assert.match(plus, /Big Pickle/, "Go Plus: plan-unabhängiges Event sichtbar");
});

test("Changelog: Eintrag ohne verbleibendes Event verschwindet ganz (keine leere Überschrift)", () => {
  const nurGo = {
    id: "2026-09-28T10-00-00Z",
    date: "2026-09-28",
    changes: [{ type: "usage_changed", model: "Kimi K3", plans: [{ plan: "go", from: 15, to: 45 }] }],
  };
  const html = ssr.renderChangelog([nurGo], PLANS, "de", "go-plus");
  const $ = cheerio.load(html);
  assert.equal($("#2026-09-28T10-00-00Z").length, 0, "Eintrag mit keinem Go-Plus-Event wird nicht gerendert");
  assert.doesNotMatch($("#changelog").text(), /Kimi K3/);
});

test("Changelog: plan_added erscheint nur im Tab des neuen Plans (Plan-Label)", () => {
  const entry = {
    id: "2026-09-28T10-00-00Z",
    date: "2026-09-28",
    changes: [
      { type: "plan_added", plan: "go-plus", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240 },
    ],
  };
  const plus = cheerio
    .load(ssr.renderChangelog([entry], PLANS, "de", "go-plus"))
    .text()
    .replace(/\s+/g, " ");
  assert.match(plus, /Go Plus: neuer Tarif — \$40 pro Monat, bis \$240 enthaltene Nutzung pro Modell/);

  const goHtml = ssr.renderChangelog([entry], PLANS, "de", "go");
  assert.equal(
    cheerio.load(goHtml)("#2026-09-28T10-00-00Z").length,
    0,
    "unter Go verschwindet der Eintrag ganz"
  );
  assert.doesNotMatch(cheerio.load(goHtml)("#changelog").text(), /neuer Tarif/);
});

test("Training-Filter (showTraining=false) blendet nur 'Muse Spark 1.2 Contributor' aus", () => {
  const trainingNames = models
    .filter((m) => m.privacy && m.privacy.training === true)
    .map((m) => m.name);
  assert.ok(
    trainingNames.includes("Muse Spark 1.2 Contributor"),
    "Muse Spark 1.2 Contributor muss training=true haben"
  );
  assert.ok(trainingNames.length >= 1, "mindestens ein Modell mit training=true");
  if (models.some((m) => m.name === "Muse Spark 1.3 Contributor")) {
    assert.ok(
      trainingNames.includes("Muse Spark 1.3 Contributor"),
      "Muse Spark 1.3 Contributor muss ebenfalls training=true haben"
    );
  }
  const html = ssr.renderPriceTable(models, {
    basis: "full",
    sortField: "name",
    sortDir: 1,
    plan: PLAN,
    lang: "de",
    showTraining: false,
  });
  const names = extractRowNames(html);
  for (const n of trainingNames) {
    assert.ok(!names.includes(n), `${n} ist ausgeblendet`);
  }
  assert.equal(names.length, models.length - trainingNames.length, "genau training-Modelle weniger");
  const expected = [...models]
    .filter((m) => !(m.privacy && m.privacy.training === true))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .map((m) => m.name);
  assert.deepEqual(names, expected, "Reihenfolge der übrigen Modelle bleibt korrekt");
});

test("PrivacyTable: Free-Modelle erscheinen nur einmal; Free-Wert ergänzt models-Zeile ohne Angabe", () => {
  const zdr = { training: false, retentionDays: true, validUntil: null };
  const training = { training: true, validUntil: null };
  const models = [
    { name: "Space Bunny Free", privacy: null },
    { name: "LongCat 2.5 Preview Free", privacy: zdr },
    { name: "Other Model", privacy: training },
  ];
  const freeModels = [
    { id: "space-bunny-free", name: "Space Bunny Free", privacy: zdr },
    // Free-Zeile sagt Training, models-Zeile sagt ZDR → models-Zeile gewinnt.
    { id: "longcat-2.5-preview-free", name: "LongCat 2.5 Preview Free", privacy: training },
    { id: "big-pickle", name: "Big Pickle", privacy: training },
  ];
  const $ = cheerio.load(ssr.renderPrivacyTable(models, freeModels, "de", { field: "model", dir: 1 }));
  const names = [];
  $("tbody tr td.font-medium").each((_, td) => names.push($(td).text().trim()));
  assert.deepEqual(names, ["Big Pickle", "LongCat 2.5 Preview Free", "Other Model", "Space Bunny Free"]);

  const rowBadge = (name) => {
    const tr = $("tbody tr").filter((_, el) => $(el).find("td.font-medium").text().trim() === name);
    return tr.find("td .badge").first().attr("class") ?? "";
  };
  // models-Zeile ohne Angabe → Free-Zeile ergänzt ZDR (badge-success).
  assert.match(rowBadge("Space Bunny Free"), /badge-success/);
  // both vorhanden → models-Zeile gewinnt (ZDR, nicht Training).
  assert.match(rowBadge("LongCat 2.5 Preview Free"), /badge-success/);
  assert.match(rowBadge("Big Pickle"), /badge-error/);
});
