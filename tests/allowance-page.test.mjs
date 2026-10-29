import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import solid from "vite-plugin-solid";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "tests", ".ssr-allowance-page");
let render, usageBadgeClass, usageBarClass, fieldPrice, renderHeader, renderHero;

before(async () => {
  await build({ configFile: false, root: ROOT, logLevel: "error", plugins: [solid({ ssr: true, generate: "ssr" })], build: { ssr: "tests/allowance-page-ssr.tsx", outDir: OUT, emptyOutDir: true, copyPublicDir: false, minify: false } });
  const file = readdirSync(OUT).find((name) => name.startsWith("allowance-page-ssr."));
  ({ render, usageBadgeClass, usageBarClass, fieldPrice, renderHeader, renderHero } = await import(pathToFileURL(join(OUT, file)).href));
});

test("allowance page displays data-driven plan caps and request estimates", () => {
  const plans = [
    { id: "alpha", name: "Alpha", priceMonthly: 10, creditsMonthly: 60, sourceUrl: "" },
    { id: "beta", name: "Beta", priceMonthly: 20, creditsMonthly: 120, sourceUrl: "" },
  ];
  const model = { name: "Example", tier: null, input: 1, output: 1, cachedRead: 1, cachedWrite: null, usage: { alpha: 10, beta: 20 }, pattern: { input: 1000, cachedRead: 0, output: 0 }, capabilities: null, contextWindow: null, provider: null, privacy: null };
  const html = render([model], plans);
  assert.match(html, /Alpha/);
  assert.match(html, /Beta/);
  assert.match(html, /\$<!--\$-->10<!--\/--> <!--\$-->usage\/mo/);
  assert.match(html, /\$<!--\$-->20<!--\/--> <!--\$-->usage\/mo/);
  assert.match(html, /requests/);
  assert.match(html, /role="tablist" aria-label="Sort requests by plan"/);
  assert.match(html, /role="tab"[^>]*aria-selected="true"/);
  const deHtml = render([model], plans, "de");
  assert.match(deHtml, /Nutzung pro Modell/);
  assert.match(deHtml, /100 % ist das monatliche SOLL-Guthaben des Plans/);
  assert.doesNotMatch(deHtml, /\{(goCredit|goPlusCredit|goTeamsCredit|teamsPrice)\}/);
  const enHtml = render([model], plans, "en");
  assert.match(enHtml, /100% is the plan's target monthly credit/);
  assert.doesNotMatch(enHtml, /\{(goCredit|goPlusCredit|goTeamsCredit|teamsPrice)\}/);
});

test("allowance intro derives the 100 % credits from the plan data", () => {
  const plans = [
    { id: "go", name: "Go", priceMonthly: 10, creditsMonthly: 60, sourceUrl: "" },
    { id: "go-plus", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240, sourceUrl: "" },
    { id: "go-teams", name: "Go Teams", priceMonthly: 20, creditsMonthly: 65, sourceUrl: "" },
  ];
  const model = { name: "Example", tier: null, input: 1, output: 1, cachedRead: 1, cachedWrite: null, usage: { go: 10, "go-plus": 40, "go-teams": 15 }, pattern: { input: 1000, cachedRead: 0, output: 0 }, capabilities: null, contextWindow: null, provider: null, privacy: null };
  const en = render([model], plans, "en");
  assert.match(en, /Go \$60, Go Plus \$240 \(4× Go\), and Go Teams \$65 \(Go credit \+ one \$5 uplift in the target\)/);
  assert.match(en, /Go Teams costs \$20\/member\/month/);
  const de = render([model], plans, "de");
  assert.match(de, /Go \$60, Go Plus \$240 \(4× Go\) und Go Teams \$65 \(Go-Guthaben \+ einmalig \$5 im SOLL\)/);
});

test("localized allowance document titles match the prerendered route metadata", async () => {
  const { readFile } = await import("node:fs/promises");
  const i18nSource = await readFile(join(ROOT, "src/i18n.ts"), "utf8");
  assert.match(i18nSource, /allowanceDocumentTitle: "Monthly Model Allowances — OpenCode Go"/);
  assert.match(i18nSource, /allowanceDocumentTitle: "Monatliche Modellnutzung — OpenCode Go"/);
  const prerender = await readFile(join(ROOT, "scripts/prerender.mjs"), "utf8");
  assert.match(prerender, /title: lang === "de" \? "Monatliche Modellnutzung — OpenCode Go" : "Monthly Model Allowances — OpenCode Go"/);
});

test("allowance rows sort by requests for the selected plan and unlimited is green/bold", () => {
  const plans = [{ id: "a", name: "A", priceMonthly: 10, creditsMonthly: 60, sourceUrl: "" }, { id: "b", name: "B", priceMonthly: 20, creditsMonthly: 120, sourceUrl: "" }];
  const model = (name, usage) => ({ name, tier: null, input: 1, output: 1, cachedRead: 1, cachedWrite: null, usage, pattern: { input: 1000, cachedRead: 0, output: 0 }, capabilities: null, contextWindow: null, provider: null, privacy: null });
  const html = render([model("Fewer", { a: 10, b: 50 }), model("More", { a: 50, b: 10 })], plans, "en", "a");
  assert.ok(html.indexOf("More") < html.indexOf("Fewer"));
  const unlimited = render([model("Free", { a: null, b: null })], plans);
  assert.match(unlimited, /rounded-full bg-success/);
  assert.match(unlimited, /font-bold text-base-content/);
});

test("allowance usage colors match the main-table thresholds", () => {
  const plan = { id: "a", name: "A", priceMonthly: 10, creditsMonthly: 60, sourceUrl: "" };
  const cases = [
    [9.99, "bg-error text-base-content border border-error", "bg-error"],
    [15, "bg-error/75 text-base-content border border-error", "bg-error/75"],
    [30, "bg-warning text-base-content border border-warning", "bg-warning"],
    [60, "bg-success/60 text-base-content border border-success", "bg-success/60"],
    [61, "bg-green-800 text-green-50 border border-green-800", "bg-green-800"],
  ];
  for (const [usage, badge, bar] of cases) {
    assert.equal(usageBadgeClass(usage, plan), badge);
    assert.equal(usageBarClass(usage, plan), bar);
    assert.equal(usageBadgeClass(usage, plan).match(/\bbg-[\w/-]+/)?.[0], bar, `label/background match at $${usage}`);
    assert.doesNotMatch(badge, /text-white|text-base-100/);
  }
});

test("header distinguishes the localized internal comparison button from the external link", () => {
  for (const [lang, label, href] of [["en", "Compare plans", "/allowances/"], ["de", "Pläne vergleichen", "/de/allowances/"]]) {
    const html = renderHeader(lang);
    assert.match(html, new RegExp(`class="btn btn-primary btn-sm w-full justify-start whitespace-nowrap text-primary-content" href="${href}"`));
    assert.match(html, new RegExp(`class="btn btn-primary btn-sm whitespace-nowrap text-primary-content" href="${href}"`));
    assert.ok(html.includes(label));
    assert.ok(html.includes('href="https://ai-10-usd.all-the.rest/"'));
    assert.ok(html.includes("AI für $10 (Vergleich)") || html.includes("AI for $10 (comparison)"));
    assert.match(html, /aria-hidden="true">↗/);
  }
});

test("Go Teams shows its SOLL credit as the full monthly credit (100 %)", () => {
  const goCredits = 60;
  const plan = { id: "go-teams", name: "Go Teams", priceMonthly: 20, creditsMonthly: goCredits + 5, sourceUrl: "" };
  const hero = renderHero(plan);
  assert.match(hero, /Monthly credit/);
  assert.match(hero, new RegExp(`<div class="stat-value">\\$${goCredits + 5}</div>`));
  assert.match(hero, /full monthly credit/);
  assert.doesNotMatch(hero, /Monthly reference|not a shared pool/);
  assert.doesNotMatch(hero, /\$<!--\$-->120<!--\/-->/);
  assert.equal(usageBadgeClass(19, plan), "bg-error text-base-content border border-error");
  assert.equal(usageBadgeClass(21, plan), "bg-warning text-base-content border border-warning");
  assert.equal(usageBadgeClass(goCredits + 5, plan), "bg-success/60 text-base-content border border-success");
  const model = { input: 1, output: 1, cachedRead: 1, cachedWrite: null, usage: { "go-teams": 25 } };
  // "Volles Guthaben" stays available for Go Teams: list price × SOLL credit / usage.
  assert.equal(fieldPrice(model, "input", "full", plan), (goCredits + 5) / 25);
  assert.equal(fieldPrice(model, "input", "paid", plan), 0.8);
});

test("DeepSeek V4.1 Flash is dark-green above the Go and Go Teams SOLL credits", () => {
  const go = { id: "go", name: "Go", priceMonthly: 10, creditsMonthly: 60, sourceUrl: "" };
  const teams = { id: "go-teams", name: "Go Teams", priceMonthly: 20, creditsMonthly: go.creditsMonthly + 5, sourceUrl: "" };
  const plus = { id: "go-plus", name: "Go Plus", priceMonthly: 40, creditsMonthly: 240, sourceUrl: "" };
  assert.equal(usageBadgeClass(80, go), "bg-green-800 text-green-50 border border-green-800");
  assert.equal(usageBarClass(80, go), "bg-green-800");
  assert.equal(usageBadgeClass(85, teams), "bg-green-800 text-green-50 border border-green-800");
  assert.equal(usageBarClass(85, teams), "bg-green-800");
  assert.equal(usageBadgeClass(160, plus), "bg-warning text-base-content border border-warning");
  assert.equal(usageBarClass(160, plus), "bg-warning");
  assert.ok([usageBadgeClass(80, go), usageBadgeClass(85, teams), usageBadgeClass(160, plus)].every((value) => !/text-white|text-base-100/.test(value)));
});

test("finite Go Teams allowances always have semantic non-gray colors", () => {
  const teams = { id: "go-teams", name: "Go Teams", priceMonthly: 20, creditsMonthly: 65, sourceUrl: "" };
  for (const usage of [20, 65, 5]) {
    const badge = usageBadgeClass(usage, teams);
    const bar = usageBarClass(usage, teams);
    assert.ok(badge.includes("text-base-content"));
    assert.doesNotMatch(badge, /badge-ghost|text-white|text-base-100/);
    assert.match(bar, /^bg-(error|warning|success|green-800)(\/\d+)?$/);
    assert.doesNotMatch(bar, /base-300|base-content/);
  }
});

test("live data: every rendered allowance badge background matches its bar", async () => {
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(await readFile(join(ROOT, "data/latest.json"), "utf8"));
  for (const plan of data.plans) {
    const colored = data.models.filter((model) => typeof model.usage[plan.id] === "number");
    if (colored.length === 0) continue;
    const html = render(colored, [plan], "en", plan.id);
    for (const model of colored) {
      const usage = model.usage[plan.id];
      const badge = usageBadgeClass(usage, plan);
      const bar = usageBarClass(usage, plan);
      assert.equal(badge.match(/\bbg-[\w/-]+/)?.[0], bar, `${plan.id}/${model.name}: label background == bar`);
      assert.ok(html.includes(`badge badge-xs ${badge}`), `${plan.id}/${model.name}: badge rendered`);
      if (plan.creditsMonthly !== null) {
        assert.doesNotMatch(bar, /base-300|base-content/, `${plan.id}/${model.name}: finite allowance is never neutral`);
      }
    }
  }
});

test("Go Teams SOLL credit is Go + $5 and all finite rows render 100 %-based colors", async () => {
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(await readFile(join(ROOT, "data/latest.json"), "utf8"));
  const go = data.plans.find((plan) => plan.id === "go");
  const teams = data.plans.find((plan) => plan.id === "go-teams");
  assert.ok(teams, "Go Teams plan present");
  assert.ok(go, "Go plan present");
  assert.equal(teams.creditsMonthly, go.creditsMonthly + 5, "SOLL credit = Go + $5 uplift");
  const finite = data.models.filter((model) => typeof model.usage[teams.id] === "number");
  assert.ok(finite.length > 0, "catalog has finite Go Teams allowances");
  const html = render(finite, [teams], "en", teams.id);
  for (const model of finite) {
    const bar = usageBarClass(model.usage[teams.id], teams);
    assert.match(bar, /^bg-(error|warning|success|green-800)(\/\d+)?$/);
    assert.ok(html.includes(`class="h-full rounded-full ${bar}"`));
  }
});
