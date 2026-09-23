import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

// Der Prerender läuft als Teil von `pnpm build`. In CI ist die Reihenfolge
// test → scrape → build → smoke, daher wird dieser Test nur ausgeführt, wenn
// `dist/` bereits vorliegt (lokal nach `pnpm build`); die CI-Absicherung
// übernimmt `scripts/smoke.mjs`.
const skip = !existsSync(join(DIST, "index.html"));

const read = (...parts) => readFileSync(join(DIST, ...parts), "utf8");
const jsonLdOf = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, "JSON-LD fehlt");
  return JSON.parse(m[1].replace(/\\u003c/g, "<"));
};

test("Prerender: englische und deutsche HTML-Datei vorhanden", { skip }, () => {
  assert.ok(existsSync(join(DIST, "index.html")), "dist/index.html fehlt");
  assert.ok(existsSync(join(DIST, "de", "index.html")), "dist/de/index.html fehlt");
});

test("Prerender: Inhalt steckt in #root, nicht nur im JS", { skip }, () => {
  for (const file of [["index.html"], ["de", "index.html"]]) {
    const html = read(...file);
    const start = html.indexOf('<div id="root">');
    const end = html.indexOf("</div>\n  </body>");
    assert.ok(start > -1 && end > start, `${file.join("/")}: #root fehlt`);
    assert.ok(end - start > 5000, `${file.join("/")}: #root praktisch leer`);
    assert.match(html, /<h1[\s>]/, `${file.join("/")}: <h1> fehlt`);
  }
});

test("Prerender: alle Modellnamen sind vorgerendert", { skip }, () => {
  const { models } = JSON.parse(readFileSync(join(ROOT, "data", "latest.json"), "utf8"));
  const en = read("index.html");
  for (const model of models) {
    assert.ok(en.includes(model.name), `Modell fehlt im Prerender: ${model.name}`);
  }
});

test("SEO: Sprach-Metadaten, Canonical und hreflang", { skip }, () => {
  const en = read("index.html");
  assert.match(en, /<html lang="en"/);
  assert.match(en, /rel="canonical" href="https:\/\/ocgo-pricing\.all-the\.rest\/"/);
  assert.match(en, /hreflang="de" href="https:\/\/ocgo-pricing\.all-the\.rest\/de\/"/);

  const de = read("de", "index.html");
  assert.match(de, /<html lang="de"/);
  assert.match(de, /rel="canonical" href="https:\/\/ocgo-pricing\.all-the\.rest\/de\/"/);
  assert.match(de, /<title>OpenCode Go Preise/);
});

test("SEO: JSON-LD (WebSite, ItemList) ist valide", { skip }, () => {
  const graph = jsonLdOf(read("index.html"));
  const types = graph.map((node) => node["@type"]);
  assert.deepEqual(types, ["WebSite", "ItemList"]);
  assert.ok(graph[1].itemListElement.length > 0, "ItemList ohne Modelle");
});

test("SEO: robots.txt und sitemap.xml", { skip }, () => {
  const robots = read("robots.txt");
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Sitemap: https:\/\/ocgo-pricing\.all-the\.rest\/sitemap\.xml/);

  const sitemap = read("sitemap.xml");
  assert.match(sitemap, /<loc>https:\/\/ocgo-pricing\.all-the\.rest\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/ocgo-pricing\.all-the\.rest\/de\/<\/loc>/);
});
