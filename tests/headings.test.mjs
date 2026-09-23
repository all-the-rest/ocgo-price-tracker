// Heading-Anker: zentrale, en-basierte, sprachstabile Quelle (`src/headings.ts`).
//
// Prüft ohne Build:
//  1. Alle HEADING_IDS-Werte sind eindeutig und slug-förmig (ASCII, klein).
//  2. Keine Komponente nutzt mehr hartkodierte Abschnitts-`id="…"`- oder
//     `anchor="…"`-Literale — alle kommen aus HEADING_IDS (identisches
//     SSR-/Client-Markup in EN und DE).
//  3. Keine deutsch abgeleiteten Alt-Anker (`#datenschutz`, `#free`) bleiben übrig.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const COMPONENTS = join(SRC, "components");

const headingsSrc = readFileSync(join(SRC, "headings.ts"), "utf8");

// `key: "value"`-Paare aus dem HEADING_IDS-Literal extrahieren.
const values = [...headingsSrc.matchAll(/^\s{2}(\w+):\s*"([^"]+)",?\s*$/gm)].map((m) => ({
  key: m[1],
  id: m[2],
}));

describe("HEADING_IDS (src/headings.ts)", () => {
  it("enthält alle erwarteten Anker", () => {
    const keys = values.map((v) => v.key).sort();
    for (const k of [
      "changelog",
      "freeModels",
      "go",
      "imprint",
      "privacy",
      "privacyPolicy",
      "prices",
      "share",
    ]) {
      assert.ok(keys.includes(k), `HEADING_IDS fehlt Schlüssel: ${k}`);
    }
  });

  it("IDs sind eindeutig und slug-förmig (en-basiert, sprachstabil)", () => {
    assert.ok(values.length > 0, "keine IDs gefunden");
    const ids = values.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length, `doppelte IDs: ${ids}`);
    for (const { key, id } of values) {
      assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${key}: kein Slug (${id})`);
    }
  });

  it("kein deutsch abgeleiteter Alt-Anker bleibt übrig", () => {
    for (const retired of ["datenschutz"]) {
      assert.ok(
        !values.some((v) => v.id === retired),
        `Alt-Anker noch vorhanden: ${retired}`,
      );
    }
    // `free` wurde zu `free-models` (EN-Heading „Free models“) präzisiert.
    assert.ok(values.some((v) => v.id === "free-models"), "free-models fehlt");
    assert.ok(!values.some((v) => v.id === "free"), "Kurzform free noch vorhanden");
  });
});

describe("Komponenten nutzen HEADING_IDS (keine hartkodierten Anker)", () => {
  const files = readdirSync(COMPONENTS)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(COMPONENTS, f))
    .concat([join(SRC, "App.tsx")]);

  // Abschnitts-Anker, die aus HEADING_IDS kommen müssen (Dialog-Interna wie
  // share-title/share-size/share-preview und dynamische Changelog-IDs ausgenommen).
  const retiredLiterals = [
    'id="prices"',
    'id="ranking"',
    'id="free"',
    'id="privacy"',
    'id="faq"',
    'id="changelog"',
    'id="go"',
    'id="impressum"',
    'id="datenschutz"',
    'anchor="prices"',
    'anchor="ranking"',
    'anchor="free"',
    'anchor="privacy"',
    'anchor="faq"',
    'anchor="changelog"',
    'anchor="go"',
    'anchor="impressum"',
    'anchor="datenschutz"',
    '"#share"',
    "'#share'",
    "href=\"#impressum\"",
    "href=\"#datenschutz\"",
  ];

  for (const file of files) {
    it(`${file.split("/").slice(-2).join("/")} ohne hartkodierte Anker`, () => {
      const src = readFileSync(file, "utf8");
      for (const lit of retiredLiterals) {
        assert.ok(!src.includes(lit), `${file} enthält noch ${lit}`);
      }
    });
  }

  it("alle Abschnitts-Komponenten importieren HEADING_IDS", () => {
    const consumers = [
      "PriceTable.tsx",
      "FreeModelsTable.tsx",
      "PrivacyTable.tsx",
      "Changelog.tsx",
      "Hero.tsx",
      "Legal.tsx",
      "Footer.tsx",
      "ShareDialog.tsx",
    ];
    for (const name of consumers) {
      const src = readFileSync(join(COMPONENTS, name), "utf8");
      assert.ok(
        src.includes("HEADING_IDS"),
        `${name} importiert HEADING_IDS nicht`,
      );
    }
  });
});
