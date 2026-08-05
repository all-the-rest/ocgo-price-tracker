#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as cheerio from "cheerio";
import { z } from "zod";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_URL = "https://opencode.ai/docs/de/go/";
const ZEN_URL = "https://opencode.ai/zen/v1/models";
const SOURCE_LANG = "de";
const MONTHLY_CREDIT = 60;
const FLOAT_TOLERANCE = 1e-9;
const USER_AGENT =
  "ocgo-price-tracker/0.1.0 (+https://github.com/reisi007/ocgo-price-tracker)";

class ScrapeError extends Error {}

function parsePrice(text) {
  const t = (text ?? "").trim();
  if (t === "" || t === "-" || t === "—" || t === "–") return null;
  const cleaned = t.replace(/[\$,\s]/g, "");
  const value = parseFloat(cleaned);
  if (Number.isNaN(value)) throw new ScrapeError(`Preis unparsebar: "${text}"`);
  return value;
}

function parseUsage(text) {
  const t = (text ?? "").trim();
  const cleaned = t.replace(/[\$,\s]/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new ScrapeError(`Nutzung unparsebar: "${text}"`);
  return value;
}

function findPriceTable($) {
  const matches = [];
  $("main table").each((_, table) => {
    const headers = $(table)
      .find("thead th")
      .map((_, th) => $(th).text().trim().toLowerCase())
      .get();
    if (headers.some((h) => h.includes("input")) && headers.some((h) => h.includes("output"))) {
      matches.push(table);
    }
  });
  if (matches.length === 0) {
    throw new ScrapeError("keine Preistabelle gefunden (Header-Zellen mit 'input' UND 'output' fehlen)");
  }
  if (matches.length > 1) {
    console.error(`[scrape] Warnung: ${matches.length} Preistabellen gefunden, erste wird verwendet.`);
  }
  return matches[0];
}

function mapColumns($, table) {
  const headers = $(table)
    .find("thead th")
    .map((_, th) => $(th).text().trim().toLowerCase())
    .get();

  const find = (matcher, label) => {
    const idx = headers.findIndex(matcher);
    if (idx === -1) {
      throw new ScrapeError(
        `unerwartete Spaltenstruktur: Spalte "${label}" nicht gefunden (Header: ${JSON.stringify(headers)})`
      );
    }
    return idx;
  };

  return {
    name: find((h) => h === "model" || h === "modell", "Model/Modell"),
    input: find((h) => h.includes("input"), "Input"),
    output: find((h) => h.includes("output"), "Output"),
    cachedRead: find((h) => h.includes("cached read"), "Cached Read"),
    cachedWrite: find((h) => h.includes("cached write"), "Cached Write"),
    usage: find((h) => h.includes("nutzung") || h.includes("usage"), "Nutzung/Usage"),
  };
}

function splitTier(rawName) {
  const match = rawName.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (match) {
    return { name: match[1].trim(), tier: match[2].trim() };
  }
  return { name: rawName, tier: null };
}

const normalizeName = (s) => s.toLowerCase().replace(/[\s-]+/g, "");

/**
 * Fallback-Anfragemuster für Modelle, die in der Doku kein eigenes Muster
 * angeben, aber zur selben Modellfamilie gehören (normalisierte Namen).
 * Ohne ein Muster (eigenes oder Fallback) schlägt die zod-Validierung fehl.
 */
const PATTERN_FALLBACKS = {
  "minimaxm2.5": "minimaxm2.7",
};

/**
 * Filtert aus einer Liste von OpenCode-Zen-Modell-IDs die kostenlosen Modelle
 * ("free" im Namen) sowie "big-pickle" heraus, dedupliziert und sortiert.
 */
export function extractFreeModels(ids) {
  return [...new Set(ids.filter((id) => typeof id === "string" && (id.includes("free") || id === "big-pickle")))].sort();
}

async function fetchZenFreeModels(previousFree) {
  try {
    const res = await fetch(ZEN_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new ScrapeError(`HTTP ${res.status} bei ${ZEN_URL}`);
    const json = await res.json();
    const ids = Array.isArray(json?.data) ? json.data.map((d) => d?.id) : [];
    return extractFreeModels(ids);
  } catch (err) {
    console.error(
      `[scrape] Warnung: Zen-API nicht erreichbar (${err instanceof Error ? err.message : String(err)}); behalte ${previousFree.length} bisherige Einträge.`
    );
    return previousFree;
  }
}

function parsePatternNum(text) {
  const cleaned = (text ?? "").replace(/[\s$]/g, "").replace(/\./g, "").replace(/,/g, ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new ScrapeError(`Anfragemuster-Wert unparsebar: "${text}"`);
  return value;
}

/**
 * Zerlegt einen normalisierten Modellnamen in Familien-Präfix und Versionstokens,
 * z. B. "glm5.10" → { family: "glm", tokens: ["5", "10"] }, "5.1" → { family: "",
 * tokens: ["5", "1"] }, "2.7code" → { family: "", tokens: ["2", "7", "code"] }.
 */
function splitName(norm) {
  const i = norm.search(/\d/);
  if (i === -1) return { family: "", tokens: [] };
  return {
    family: norm.slice(0, i),
    tokens: norm.slice(i).split(/[^0-9]+/).filter(Boolean),
  };
}

/**
 * Härtet die Zuordnung eines Anfragemuster-Teils zu einem Modellkandidaten gegen
 * Kollisionen (z. B. darf "5.1" nicht auf "glm5.10" passen). Der Teil muss zur
 * Modellfamilie gehören (prefixFamily + Familien-Bindung) und die Versionstokens
 * müssen identisch oder ein strikter Präfix des Kandidaten sein ("2.7" → "2.7code").
 */
export function patternPartMatches(partNorm, candidateNorm, prefixFamily) {
  if (partNorm === candidateNorm) return true;
  const p = splitName(partNorm);
  const c = splitName(candidateNorm);
  const familyBound =
    candidateNorm.startsWith(prefixFamily) &&
    (p.family === "" || c.family === p.family || c.family.endsWith(p.family));
  if (!familyBound) return false;
  const eq = p.tokens.length === c.tokens.length && p.tokens.every((t, i) => t === c.tokens[i]);
  const prefix = p.tokens.length < c.tokens.length && p.tokens.every((t, i) => t === c.tokens[i]);
  return eq || prefix;
}

/**
 * Liest die dokumentierten Anfragemuster (Input/Cached/Output Tokens pro Anfrage)
 * aus der Doku-Seite und liefert eine Map normalisierter Modellnamen → Muster.
 * Kurzschreibweisen (z. B. "GLM-5.2/5.1", "Kimi K2.7/K2.6") werden gegen die
 * Basisnamen der Modelle aus der Preistabelle aufgelöst.
 */
export function parsePatterns($, models) {
  const modelNorms = new Set(models.map((m) => normalizeName(m.name)));
  const patterns = new Map();

  $("li").each((_, el) => {
    const text = $(el)
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const m = text.match(
      /^(.+?)\s*[—–-]\s*([\d.,]+)\s*Input[-,]{0,2}\s*([\d.,]+)\s*Cached[-,]{0,2}\s*([\d.,]+)\s*Output[-,]{0,2}\s*Tokens?\s*pro\s*Anfrage\s*$/i
    );
    if (!m) return;

    const pattern = {
      input: parsePatternNum(m[2]),
      cachedRead: parsePatternNum(m[3]),
      output: parsePatternNum(m[4]),
    };

    const parts = m[1]
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    const prefixFamily = splitName(normalizeName(parts[0])).family;

    const resolved = new Set();
    for (const part of parts) {
      const pNorm = normalizeName(part);
      if (modelNorms.has(pNorm)) {
        resolved.add(pNorm);
        continue;
      }
      for (const cand of modelNorms) {
        if (patternPartMatches(pNorm, cand, prefixFamily)) resolved.add(cand);
      }
    }
    for (const norm of resolved) patterns.set(norm, pattern);
  });

  return patterns;
}

function parseModel(cells, colMap) {
  const at = (idx) => {
    const cell = cells[idx];
    if (cell === undefined) throw new ScrapeError(`Zelle für Spaltenindex ${idx} fehlt`);
    return cell;
  };

  const { name, tier } = splitTier(at(colMap.name).trim());
  const input = parsePrice(at(colMap.input));
  const output = parsePrice(at(colMap.output));
  const cachedRead = parsePrice(at(colMap.cachedRead));
  const cachedWrite = parsePrice(at(colMap.cachedWrite));
  const usage = parseUsage(at(colMap.usage));

  const multiplier = MONTHLY_CREDIT / usage;
  const effective = (price) => (price === null ? null : price * multiplier);

  return {
    name,
    tier,
    input,
    output,
    cachedRead,
    cachedWrite,
    usage,
    multiplier,
    effectiveInput: effective(input),
    effectiveOutput: effective(output),
    effectiveCachedRead: effective(cachedRead),
    effectiveCachedWrite: effective(cachedWrite),
    pattern: null,
  };
}

function parseModels($, table, colMap) {
  const models = [];
  $(table)
    .find("tbody tr, > tr")
    .each((_, row) => {
      const cells = $(row)
        .find("th, td")
        .map((_, c) => $(c).text().trim())
        .get();
      const first = (cells[0] ?? "").trim().toLowerCase();
      if (first === "model" || first === "modell") return;
      models.push(parseModel(cells, colMap));
    });
  return models;
}

/**
 * Extrahiert die Modelle aus dem HTML einer OpenCode-Go-Dokumentationsseite.
 * Wirft ScrapeError bei strukturellen Parsing-Fehlern.
 */
export function parseHtml(html) {
  const $ = cheerio.load(html);
  const table = findPriceTable($);
  const colMap = mapColumns($, table);
  const models = parseModels($, table, colMap);
  const patternMap = parsePatterns($, models);
  for (const m of models) {
    const norm = normalizeName(m.name);
    let pattern = patternMap.get(norm);
    if (!pattern && PATTERN_FALLBACKS[norm]) {
      pattern = patternMap.get(PATTERN_FALLBACKS[norm]);
    }
    m.pattern = pattern ?? null;
  }
  if (models.length === 0) throw new ScrapeError("keine Modelle aus der Preistabelle extrahiert");
  return models;
}

export const modelKey = (model) => (model.tier ? `${model.name} (${model.tier})` : model.name);

const near = (a, b) =>
  (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) < FLOAT_TOLERANCE);

export function computeDiff(prevModels, nextModels) {
  const prev = new Map(prevModels.map((m) => [modelKey(m), m]));
  const next = new Map(nextModels.map((m) => [modelKey(m), m]));

  const added = [...next.keys()].filter((k) => !prev.has(k));
  const removed = [...prev.keys()].filter((k) => !next.has(k));

  const usageChanges = [];
  const priceChanges = [];

  for (const key of next.keys()) {
    const before = prev.get(key);
    if (!before) continue;
    const after = next.get(key);

    if (before.usage !== after.usage) {
      usageChanges.push({ key, from: before.usage, to: after.usage });
    }

    const changed = [];
    const fields = [
      ["Input", "input"],
      ["Output", "output"],
      ["Cached Read", "cachedRead"],
      ["Cached Write", "cachedWrite"],
    ];
    for (const [label, field] of fields) {
      if (!near(before[field], after[field])) {
        changed.push({ label, field, from: before[field], to: after[field] });
      }
    }
    if (changed.length > 0) {
      priceChanges.push({ key, fields: changed });
    }
  }

  return { added, removed, usageChanges, priceChanges };
}

export function buildChanges(prevModels, nextModels, prevFree = [], nextFree = [], today = "") {
  if (prevModels === null) {
    return [{ type: "baseline", modelCount: nextModels.length, freeModelCount: nextFree.length }];
  }

  const { added, removed, usageChanges, priceChanges } = computeDiff(prevModels, nextModels);
  const changes = [];

  for (const key of added) changes.push({ type: "model_added", model: key });
  for (const key of removed) changes.push({ type: "model_removed", model: key });

  for (const { key, from, to } of usageChanges) {
    changes.push({ type: "usage_changed", model: key, from, to });
  }

  for (const { key, fields } of priceChanges) {
    for (const f of fields) {
      changes.push({ type: "price_changed", model: key, field: f.field, from: f.from, to: f.to });
    }
  }

  const prevIds = prevFree.map((f) => f.id);
  const nextIds = nextFree.map((f) => f.id);
  for (const f of nextFree.filter((f) => !prevIds.includes(f.id))) {
    changes.push({ type: "free_added", model: f.id, availableFrom: f.availableFrom });
  }
  for (const f of prevFree.filter((f) => !nextIds.includes(f.id))) {
    changes.push({ type: "free_removed", model: f.id, availableFrom: f.availableFrom, until: today });
  }

  return changes;
}

/**
 * Übernimmt bekannte `availableFrom`-Daten aus dem vorherigen Lauf und setzt für
 * neue kostenlose Modelle das aktuelle Datum als Erstbeobachtung.
 */
export function mergeFreeModels(prevFree, currentIds, today) {
  const prev = new Map((Array.isArray(prevFree) ? prevFree : []).map((f) => [f.id, f.availableFrom]));
  return currentIds.map((id) => ({ id, availableFrom: prev.get(id) ?? today }));
}

export function upsertChangelogJson(existing, date, changes) {
  const entries = Array.isArray(existing?.entries) ? existing.entries : [];
  const filtered = entries.filter((e) => e.date !== date);
  filtered.unshift({ date, changes });
  return { entries: filtered };
}

const RequestPatternSchema = z.object({
  input: z.number(),
  cachedRead: z.number(),
  output: z.number(),
});

const ModelSchema = z.object({
  name: z.string().min(1),
  tier: z.string().nullable(),
  input: z.number().nullable(),
  output: z.number().nullable(),
  cachedRead: z.number().nullable(),
  cachedWrite: z.number().nullable(),
  usage: z.number().positive(),
  multiplier: z.number().positive(),
  effectiveInput: z.number().nullable(),
  effectiveOutput: z.number().nullable(),
  effectiveCachedRead: z.number().nullable(),
  effectiveCachedWrite: z.number().nullable(),
  pattern: RequestPatternSchema,
});

const FreeModelSchema = z.object({
  id: z.string().min(1),
  availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const SnapshotSchema = z.object({
  fetchedAt: z.string(),
  sourceUrl: z.string().url(),
  freeModelsSourceUrl: z.string().url(),
  sourceLang: z.string(),
  monthlyCredit: z.number(),
  models: z.array(ModelSchema).min(1),
  freeModels: z.array(FreeModelSchema),
});

/**
 * Validiert einen kompletten Snapshot (zod). Jedes Modell MUSS Token-Stats
 * (`pattern`) haben — ein fehlendes Muster bricht den Lauf rot ab.
 */
export function validateSnapshot(snapshot) {
  return SnapshotSchema.parse(snapshot);
}

async function main() {
  try {
    const response = await fetch(SOURCE_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
      },
    });
    if (!response.ok) throw new ScrapeError(`HTTP ${response.status} beim Abrufen von ${SOURCE_URL}`);
    const html = await response.text();
    const models = parseHtml(html);

    const fetchedAt = new Date().toISOString();
    const date = fetchedAt.slice(0, 10);

    const prevPath = join(ROOT, "data", "latest.json");
    const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;
    const prevModels = prev && Array.isArray(prev.models) ? prev.models : null;
    const prevFree = prev && Array.isArray(prev.freeModels) ? prev.freeModels : [];
    const currentIds = await fetchZenFreeModels(prevFree.map((f) => f.id));
    const freeModels = mergeFreeModels(prevFree, currentIds, date);

    const latest = {
      fetchedAt,
      sourceUrl: SOURCE_URL,
      freeModelsSourceUrl: ZEN_URL,
      sourceLang: SOURCE_LANG,
      monthlyCredit: MONTHLY_CREDIT,
      models,
      freeModels,
    };

    const changes = buildChanges(prevModels, models, prevFree, freeModels, date);

    validateSnapshot(latest);

    const changelogPath = join(ROOT, "CHANGELOG.json");
    const existingChangelog = existsSync(changelogPath) ? JSON.parse(readFileSync(changelogPath, "utf8")) : { entries: [] };
    const changelog = upsertChangelogJson(existingChangelog, date, changes);
    const changelogJson = JSON.stringify(changelog, null, 2) + "\n";
    writeFileSync(changelogPath, changelogJson);
    mkdirSync(join(ROOT, "src", "data"), { recursive: true });
    writeFileSync(join(ROOT, "src", "data", "changelog.json"), changelogJson);

    const historyPath = join(ROOT, "data", "history.json");
    let history = { snapshots: [] };
    if (existsSync(historyPath)) {
      history = JSON.parse(readFileSync(historyPath, "utf8"));
      if (!history || !Array.isArray(history.snapshots)) history = { snapshots: [] };
    }
    history.snapshots.push(latest);
    writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");

    writeFileSync(prevPath, JSON.stringify(latest, null, 2) + "\n");

    console.log(`Gescrapt: ${models.length} Modelle, ${freeModels.length} kostenlose Modelle (Zen), ${changes.length} Änderungen (Snapshot ${date}).`);
  } catch (err) {
    console.error(`[scrape] FEHLER: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main();
}
