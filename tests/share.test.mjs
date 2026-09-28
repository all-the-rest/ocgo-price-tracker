// Share-Vertrag: share.ts ↔ weighted.ts laufen durch denselben Vite-SSR-Build
// wie die Tabellen-Tests — ein fehlender Export (z. B. formatReqPerMonth in
// weighted.ts) bricht den Build und damit diesen Test, statt erst im Browser
// aufzufallen. Zusätzlich: Ranking- und Filter-Parität zur Haupttabelle.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import solid from "vite-plugin-solid";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "tests", ".ssr");

// Aktiver Plan für die Share-Tests (entspricht `plans[0]` aus data/latest.json).
const PLAN = {
  id: "go",
  name: "Go",
  priceMonthly: 10,
  creditsMonthly: 60,
  sourceUrl: "https://opencode.ai/docs/de/go/",
};

let ssr;

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
});

const freeModel = {
  name: "Free Test",
  tier: null,
  input: 0,
  output: 0,
  cachedRead: 0,
  cachedWrite: null,
  usage: { go: null, "go-plus": null },
  pattern: null,
  capabilities: null,
  contextWindow: null,
  provider: null,
  privacy: null,
};

const paidModel = {
  ...freeModel,
  name: "Paid Test",
  input: 1,
  output: 3,
  cachedRead: 0.2,
  usage: { go: 15, "go-plus": 60 },
  pattern: { input: 390, cachedRead: 32500, output: 120 },
};

test("share-Exports sind verfügbar (fängt fehlende weighted-Exports)", () => {
  for (const fn of ["shareRequests", "topModels", "formatReqPerMonth", "formatTokens", "requestsPerMonth"]) {
    assert.equal(typeof ssr[fn], "function", `${fn} muss exportiert sein`);
  }
});

test("kostenloses Modell rankt per Infinity ganz oben", () => {
  assert.equal(ssr.shareRequests(freeModel, PLAN), Infinity);
  const rows = ssr.topModels([paidModel, freeModel], 5, PLAN, []);
  assert.equal(rows[0]?.name, "Free Test");
});

test("Anfragen/Monat sind plan-abhängig (Go vs. Go Plus)", () => {
  // paidModel: usage go 15, go-plus 60 → mehr inkludierte Nutzung im Plus-Plan,
  // Listenpreis-Kosten identisch → mehr Anfragen pro Monat.
  const go = ssr.shareRequests(paidModel, PLAN);
  const plus = ssr.shareRequests(paidModel, { ...PLAN, id: "go-plus", priceMonthly: 40, creditsMonthly: 240 });
  assert.ok(plus > go, "Go Plus enthält mehr Nutzung → mehr Anfragen/Monat");
});

test("Fähigkeiten-Filter mit OR-Semantik wie die Tabelle", () => {
  const withVideo = {
    ...paidModel,
    name: "Video Test",
    capabilities: { input: ["text", "video"], output: ["text"], reasoning: false, toolCall: false },
  };
  const filtered = ssr.topModels([paidModel, withVideo], 5, PLAN, ["video"]);
  assert.deepEqual(filtered.map((r) => r.name), ["Video Test"]);
});
