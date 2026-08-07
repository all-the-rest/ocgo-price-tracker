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
const FIELDS = ["input", "output", "cachedRead", "cachedWrite", "cost"];
const BASES = ["list", "full", "paid"];
const CREDIT = 60;
const COST = 10;

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

const displayedValue = (m, field, basis) =>
  field === "cost" ? ssr.requestCost(m, basis, COST) : ssr.fieldPrice(m, field, basis, COST);

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

const expectedOrder = (field, basis, dir) =>
  [...models]
    .sort((a, b) => {
      const va = displayedValue(a, field, basis);
      const vb = displayedValue(b, field, basis);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va - vb) * dir;
    })
    .map((m) => m.name);

for (const basis of BASES) {
  for (const field of FIELDS) {
    for (const dir of [1, -1]) {
      test(`Sortierung ${basis}/${field}/${dir === 1 ? "asc" : "desc"} = Reihenfolge der angezeigten Werte`, () => {
        const expected = expectedOrder(field, basis, dir);
        const html = ssr.renderPriceTable(models, {
          basis,
          sortField: field,
          sortDir: dir,
          monthlyCredit: CREDIT,
          monthlyCost: COST,
          lang: "de",
        });
        assert.deepEqual(extractRowNames(html), expected);
      });
    }
  }
}

test("paid-Basis input asc: Effektivpreis entscheidet, nicht der rohe Listenpreis (Regression MiMo vs. DeepSeek V4 Flash)", () => {
  const mimo = models.find((m) => m.name === "MiMo V2.5");
  const flash = models.find((m) => m.name === "DeepSeek V4 Flash");
  assert.ok(mimo && flash, "MiMo V2.5 und DeepSeek V4 Flash sind im Datensatz");
  assert.equal(mimo.input, flash.input, "rohe Input-Preise sind identisch (0.14)");
  assert.ok(
    displayedValue(flash, "input", "paid") < displayedValue(mimo, "input", "paid"),
    "Effektivpreis (paid) von DeepSeek V4 Flash ist halb so hoch"
  );
  const names = extractRowNames(
    ssr.renderPriceTable(models, {
      basis: "paid",
      sortField: "input",
      sortDir: 1,
      monthlyCredit: CREDIT,
      monthlyCost: COST,
      lang: "de",
    })
  );
  assert.ok(
    names.indexOf("DeepSeek V4 Flash") < names.indexOf("MiMo V2.5"),
    "DeepSeek V4 Flash muss vor MiMo V2.5 stehen"
  );
});
