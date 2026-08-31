import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderReleaseNotesForEntry,
  renderChange,
  pricingLine,
  fmtPrice,
  fmtCaps,
  fmtPrivacy,
  PRICE_FIELD_NAMES,
} from "../scripts/release-notes.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

const notesFor = (date, changes, id = `${date}T10-00-00Z`) =>
  renderReleaseNotesForEntry({ id, date, changes });

const full = (date, changes) => notesFor(date, changes);

const pricing = (over = {}) => ({
  input: 0.3,
  output: 1.2,
  cachedRead: 0.06,
  cachedWrite: null,
  usage: 30,
  ...over,
});

// ---------------------------------------------------------------------------
// Vollständiger Release-Post: Kopf + Bullets müssen dem Changelog-Eintrag
// entsprechen (inkl. Usage-Limit `@ $usage`).
// ---------------------------------------------------------------------------

test("release notes: model_added enthält Preise UND Usage-Limit", () => {
  const notes = full("2026-08-28", [
    {
      type: "model_added",
      model: "GLM-5.3-Flash",
      pricing: { input: 0.15, output: 0.5, cachedRead: 0.03, cachedWrite: null, usage: 30 },
    },
  ]);
  assert.equal(
    notes,
    [
      "# Price Update 2026-08-28",
      "",
      "Price changes for OpenCode Go on **2026-08-28**:",
      "",
      "- **GLM-5.3-Flash** — added ($0.15 / $0.5 / $0.03 @ $30)",
    ].join("\n")
  );
});

// ---------------------------------------------------------------------------
// Modell-Events
// ---------------------------------------------------------------------------

test("release notes: model_removed enthält Pricing (mit ∞-Usage) + Tage", () => {
  assert.equal(
    renderChange({
      type: "model_removed",
      model: "Ox Alpha Free",
      days: 5,
      pricing: { input: 0, output: 0, cachedRead: 0, cachedWrite: 0, usage: null },
    }),
    "- **Ox Alpha Free** — removed ($0 / $0 / $0 / $0 @ ∞ (unlimited), was available 5 days)"
  );
});

test("release notes: price_changed zeigt from/to mit Usage + Feldnamen", () => {
  assert.equal(
    renderChange({
      type: "price_changed",
      model: "DeepSeek V4 Pro",
      from: pricing({ input: 0.435, output: 0.87, cachedRead: 0.003625 }),
      to: pricing({ input: 0.66, output: 1.98, cachedRead: 0.022 }),
      fields: ["input", "output", "cachedRead"],
    }),
    "- **DeepSeek V4 Pro** — price change (Input, Output, Cached Read): " +
      "$0.435 / $0.87 / $0.003625 @ $30 → $0.66 / $1.98 / $0.022 @ $30"
  );
});

test("release notes: usage_changed zeigt from/to inkl. unbegrenzt", () => {
  assert.equal(
    renderChange({ type: "usage_changed", model: "Grok 4.6", from: 15, to: null }),
    "- **Grok 4.6** — usage: $15 → ∞ (unlimited)"
  );
  assert.equal(
    renderChange({ type: "usage_changed", model: "GPT 5.6 Luna", from: null, to: 60 }),
    "- **GPT 5.6 Luna** — usage: ∞ (unlimited) → $60"
  );
});

test("release notes: capabilities_changed zeigt From/To-Fähigkeiten", () => {
  assert.equal(
    renderChange({
      type: "capabilities_changed",
      model: "DeepSeek V4 Pro",
      from: null,
      to: { input: ["text"], output: ["text"], reasoning: true, toolCall: true },
    }),
    "- **DeepSeek V4 Pro** — capabilities: – → in:text out:text reasoning+tool"
  );
});

test("release notes: privacy_changed zeigt Stufen (training/ZDR/retention), Retention-true = ZDR", () => {
  // Regression: retentionDays===true ist ZDR (0 Tage), nicht "true days retention".
  assert.equal(
    renderChange({
      type: "privacy_changed",
      model: "Muse Spark 1.2",
      from: { training: true, validUntil: null },
      to: { training: false, retentionDays: true, validUntil: null },
    }),
    "- **Muse Spark 1.2** — privacy: training → ZDR"
  );
  assert.equal(
    renderChange({
      type: "privacy_changed",
      model: "x",
      from: { training: false, retentionDays: 30, validUntil: "2026-12-31" },
      to: { training: false, retentionDays: false, validUntil: null },
    }),
    "- **x** — privacy: 30 days retention (valid until 2026-12-31) → retention"
  );
});

test("release notes: free_added nutzt Namen, free_removed mit Tagen + verfügbar seit", () => {
  assert.equal(
    renderChange({ type: "free_added", model: "laguna-s-2.1-free", name: "Laguna S 2.1 Free" }),
    "- **Laguna S 2.1 Free** — new free model"
  );
  assert.equal(
    renderChange({ type: "free_added", model: "x-preview-f-free" }),
    "- **x-preview-f-free** — new free model"
  );
  assert.equal(
    renderChange({
      type: "free_removed",
      model: "laguna-s-2.1-free",
      name: "Laguna S 2.1 Free",
      availableFrom: "2026-08-05",
      until: "2026-08-28",
    }),
    "- **Laguna S 2.1 Free** — free model removed (was available 23 days, since 2026-08-05)"
  );
});

test("release notes: text-Event rendert englischen Text", () => {
  assert.equal(
    renderChange({ type: "text", lang: { en: "Initial version", de: "Initialversion" } }),
    "- Initial version"
  );
});

// ---------------------------------------------------------------------------
// Release-Text muss den Changelog-Eintrag vollständig abdecken (echte Daten)
// ---------------------------------------------------------------------------

function fmtUsage(u) {
  return u === null ? "∞ (unlimited)" : `$${u}`;
}

/** Fragment-Checks pro Change-Typ: Der Release-Text muss alle Kern-Infos enthalten. */
function assertCovered(notes, c) {
  const has = (s) =>
    assert.ok(notes.includes(s), `${c.type}: "${s}" fehlt im Release-Text:\n${notes}`);
  switch (c.type) {
    case "text":
      has(c.lang.en);
      return;
    case "model_added":
      has(c.model);
      has(pricingLine(c.pricing));
      return;
    case "model_removed":
      has(c.model);
      has(String(c.days));
      has(pricingLine(c.pricing));
      return;
    case "price_changed":
      has(c.model);
      has(pricingLine(c.from));
      has(pricingLine(c.to));
      for (const f of c.fields) has(PRICE_FIELD_NAMES[f] ?? f);
      return;
    case "usage_changed":
      has(c.model);
      has(fmtUsage(c.from));
      has(fmtUsage(c.to));
      return;
    case "capabilities_changed":
      has(c.model);
      if (c.from) has(fmtCaps(c.from));
      if (c.to) has(fmtCaps(c.to));
      return;
    case "privacy_changed":
      has(c.model);
      if (c.from) has(fmtPrivacy(c.from));
      if (c.to) has(fmtPrivacy(c.to));
      return;
    case "free_added":
      has(c.name ?? c.model);
      return;
    case "free_removed": {
      has(c.name ?? c.model);
      has(c.availableFrom);
      const days = Math.max(
        0,
        Math.round((Date.parse(c.until) - Date.parse(c.availableFrom)) / 86_400_000)
      );
      has(String(days));
      return;
    }
  }
}

test("CHANGELOG.json: Release-Text deckt jeden Change vollständig ab (release text == changelog entry)", () => {
  const changelog = JSON.parse(
    readFileSync(join(ROOT, "..", "CHANGELOG.json"), "utf8")
  );
  assert.ok(changelog.entries.length > 0, "Changelog darf nicht leer sein");
  for (const entry of changelog.entries) {
    const notes = renderReleaseNotesForEntry(entry);
    assert.ok(notes, `entry ${entry.id}: Release-Notes dürfen nicht null sein`);
    // Kein Change darf ins Default-Fallback (JSON-Dump) fallen.
    assert.doesNotMatch(notes, /- [a-z_]+: \{/, `entry ${entry.id}: unbekannter Change-Typ`);
    // Pro Change genau eine Bullet-Zeile (Kopf: Titel, Blank, Intro, Blank).
    const bullets = notes.split("\n").filter((l) => l.startsWith("- "));
    assert.equal(
      bullets.length,
      entry.changes.length,
      `entry ${entry.id}: Bullet-Anzahl ≠ Changes-Anzahl`
    );
    for (const c of entry.changes) assertCovered(notes, c);
  }
});

test("renderChange: jeder Schema-Change-Typ hat einen Handler (kein JSON-Dump-Fallback)", () => {
  const samples = [
    { type: "text", lang: { en: "Initial version", de: "Initialversion" } },
    { type: "model_added", model: "GLM-5.3-Flash", pricing: pricing() },
    { type: "model_removed", model: "Ox Alpha Free", days: 5, pricing: pricing() },
    {
      type: "price_changed",
      model: "DeepSeek V4 Pro",
      from: pricing(),
      to: pricing(),
      fields: ["input"],
    },
    { type: "usage_changed", model: "Grok 4.6", from: 15, to: null },
    {
      type: "capabilities_changed",
      model: "DeepSeek V4 Pro",
      from: null,
      to: { input: ["text"], output: ["text"], reasoning: true, toolCall: true },
    },
    { type: "privacy_changed", model: "x", from: { training: true, validUntil: null }, to: { training: false, retentionDays: true, validUntil: null } },
    { type: "free_added", model: "laguna-s-2.1-free", name: "Laguna S 2.1 Free" },
    { type: "free_removed", model: "laguna-s-2.1-free", name: "Laguna S 2.1 Free", availableFrom: "2026-08-05", until: "2026-08-28" },
  ];
  for (const c of samples) {
    const line = renderChange(c);
    assert.ok(
      !line.startsWith(`- ${c.type}: {`),
      `renderChange fällt für "${c.type}" in den JSON-Fallback zurück: ${line}`
    );
  }
});

test("fmtPrice/pricingLine: Nutzungsformatierung bleibt stabil", () => {
  assert.equal(fmtPrice(0.15), "$0.15");
  assert.equal(fmtPrice(0.5), "$0.5");
  assert.equal(fmtPrice(null), "–");
  assert.equal(
    pricingLine({ input: 0.15, output: 0.5, cachedRead: 0.03, cachedWrite: null, usage: 30 }),
    "$0.15 / $0.5 / $0.03 @ $30"
  );
  assert.equal(
    pricingLine({ input: 0, output: 0, cachedRead: 0, cachedWrite: 0, usage: null }),
    "$0 / $0 / $0 / $0 @ ∞ (unlimited)"
  );
});