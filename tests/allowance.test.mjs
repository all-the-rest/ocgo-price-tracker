import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import solid from "vite-plugin-solid";
import * as cheerio from "cheerio";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "tests", ".ssr-allowance");
const GO = { id: "go", name: "Go", priceMonthly: 10, creditsMonthly: 60, sourceUrl: "https://opencode.ai/v2/docs/console/go/" };
const PLUS = { id: "go-plus", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240, sourceUrl: "https://opencode.ai/v2/docs/console/go/" };

let ssr;
let baseModel;

before(async () => {
  await build({
    configFile: false,
    root: ROOT,
    logLevel: "error",
    plugins: [solid({ ssr: true, generate: "ssr" })],
    build: { ssr: "tests/ssr-entry.tsx", outDir: OUT_DIR, emptyOutDir: true, copyPublicDir: false, minify: false, sourcemap: false },
  });
  const entry = join(OUT_DIR, readdirSync(OUT_DIR).find((f) => f.startsWith("ssr-entry.")));
  ssr = await import(pathToFileURL(entry).href);
  baseModel = JSON.parse(readFileSync(join(ROOT, "data", "latest.json"), "utf8")).models[0];
});

const allowanceBadgeClass = (html, name) => {
  const $ = cheerio.load(html);
  const row = $("tbody tr").filter((_, tr) => $(tr).find("th").first().text().trim().startsWith(name));
  return (row.find("td").eq(5).find('span[class*="badge-sm"]').first().attr("class") ?? "")
    .replace(/^badge badge-sm\s*/, "");
};

const render = (plan, amounts) => {
  const models = amounts.map((amount) => ({
    ...structuredClone(baseModel),
    id: `allowance-${amount}`,
    name: `Allowance ${amount}`,
    input: 1,
    output: 1,
    cachedRead: 1,
    cachedWrite: null,
    usage: { ...baseModel.usage, [plan.id]: amount },
  }));
  return ssr.renderPriceTable(models, { basis: "list", sortField: "name", sortDir: 1, plan, lang: "en" });
};

test("allowance badge colors use paid guard and percent of plan credits", () => {
  assert.equal(GO.priceMonthly, 10);
  assert.equal(GO.creditsMonthly, 60);
  let html = render(GO, [8, 10, 15, 20, 30, 60, 80]);
  const cases = [
    [8, "bg-error text-base-content border border-error"],
    [10, "bg-error/75 text-base-content border border-error"],
    [15, "bg-error/75 text-base-content border border-error"],
    [20, "bg-warning text-base-content border border-warning"],
    [30, "bg-warning text-base-content border border-warning"],
    [60, "bg-success/60 text-base-content border border-success"],
    [80, "bg-green-800 text-green-50 border border-green-800"],
  ];
  for (const [amount, expected] of cases) assert.equal(allowanceBadgeClass(html, `Allowance ${amount}`), expected, `Go $${amount}`);

  assert.equal(PLUS.priceMonthly, 40);
  assert.equal(PLUS.creditsMonthly, 240);
  html = render(PLUS, [60, 90, 240]);
  for (const [amount, expected] of [
    [60, "bg-error/75 text-base-content border border-error"],
    [90, "bg-warning text-base-content border border-warning"],
    [240, "bg-success/60 text-base-content border border-success"],
  ]) {
    assert.equal(allowanceBadgeClass(html, `Allowance ${amount}`), expected, `Go Plus $${amount}`);
  }
});
