#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as cheerio from "cheerio";
import { z } from "zod";
import { Models } from "@opencode-ai/models";
import {
  providers as snapshotProviders,
  models as snapshotModels,
} from "@opencode-ai/models/snapshot";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_URL = "https://opencode.ai/docs/de/go/";
const BONUS_URL = "https://opencode.ai/de/go";
const ZEN_URL = "https://opencode.ai/zen/v1/models";
const MODELS_DEV_URL = "https://models.dev";
const SOURCE_LANG = "de";
const MONTHLY_CREDIT = 60;
const FLOAT_TOLERANCE = 1e-9;
const USER_AGENT =
  "ocgo-price-tracker/0.1.0 (+https://github.com/reisi007/ocgo-price-tracker)";

class ScrapeError extends Error {}

/**
 * Lädt den models.dev-Katalog (Live-API) und fällt bei Fehlern auf den
 * gebündelten Snapshot zurück.
 */
async function loadModelsDev() {
  try {
    const catalog = await Models.make({
      baseUrl: MODELS_DEV_URL,
      headers: { "User-Agent": USER_AGENT },
    }).catalog({ signal: AbortSignal.timeout(10_000) });
    return { providers: catalog.providers, models: catalog.models, source: "live" };
  } catch (err) {
    console.error(
      `[scrape] Warnung: models.dev API nicht erreichbar (${err instanceof Error ? err.message : String(err)}); nutze den gebündelten Snapshot.`
    );
    return { providers: snapshotProviders, models: snapshotModels, source: "snapshot" };
  }
}

const CAPABILITY_VALUES = ["text", "audio", "image", "video", "pdf"];

/**
 * Baut aus einem models.dev-Modell das capabilities-Objekt. Liefert null,
 * wenn das Modell fehlt oder keine Input-Modalitäten hat. Modalitäten werden
 * auf die 5 gültigen Werte gefiltert.
 */
function toCapabilities(md) {
  if (!md || !Array.isArray(md.modalities?.input)) return null;
  const valid = (arr) => (Array.isArray(arr) ? arr.filter((v) => CAPABILITY_VALUES.includes(v)) : []);
  return {
    input: valid(md.modalities.input),
    output: valid(md.modalities.output),
    reasoning: md.reasoning === true,
    toolCall: md.tool_call === true,
  };
}

/**
 * Ausnahmen für die Fähigkeiten-Zuordnung (normalisierter Modellname →
 * kanonische models.dev-ID). Für künftige Edge Cases; aktuell leer.
 */
const CAPABILITY_OVERRIDES = {};

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

/**
 * Holt die temporären Nutzungs-Boni von der Go-Landingpage. Ein HTTP-Fehler
 * bricht rot ab, weil die Boni den Effektivpreis direkt verändern (verlässliche
 * Preise sind Pflicht); ein strukturierter Zustand ohne `[data-bonus]` liefert
 * einfach eine leere Map.
 */
async function fetchUsageBonuses() {
  const res = await fetch(BONUS_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new ScrapeError(`HTTP ${res.status} beim Abrufen von ${BONUS_URL}`);
  return parseUsageBonuses(cheerio.load(await res.text()));
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

  const model = {
    name,
    tier,
    input,
    output,
    cachedRead,
    cachedWrite,
    usage: parseUsage(at(colMap.usage)),
    pattern: null,
    capabilities: null,
  };
  recomputeUsageDerived(model);
  return model;
}

/**
 * Setzt `multiplier` und die `effective*`-Preise aus dem aktuellen `usage` neu.
 * Wird nach einer Bonus-Anpassung des Nutzungslimits erneut aufgerufen.
 */
function recomputeUsageDerived(model) {
  const multiplier = MONTHLY_CREDIT / model.usage;
  const effective = (price) => (price === null ? null : price * multiplier);
  model.multiplier = multiplier;
  model.effectiveInput = effective(model.input);
  model.effectiveOutput = effective(model.output);
  model.effectiveCachedRead = effective(model.cachedRead);
  model.effectiveCachedWrite = effective(model.cachedWrite);
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

/**
 * Liest temporäre Nutzungs-Boni aus der Go-Landingpage. Die Preistabelle zeigt
 * dort pro Modell ein `[data-item]`-Element mit `data-model` (Slug) und optional
 * einem verschachtelten `<span data-bonus>…x usage</span>`. Liefert eine Map
 * normalisierter Modellnamen → Faktor (z. B. 2 bei "2x usage").
 */
export function parseUsageBonuses($) {
  const bonuses = new Map();
  $("[data-item]").each((_, el) => {
    const model = $(el).attr("data-model");
    if (!model) return;
    const text = $(el)
      .find("[data-bonus]")
      .first()
      .text()
      .trim();
    const m = text.match(/^(\d+)x\b/i);
    const factor = m ? Number(m[1]) : null;
    if (factor && factor > 1) bonuses.set(normalizeName(model), factor);
  });
  return bonuses;
}

/**
 * Wendet Nutzungs-Boni (Map normalisierter Modellname → Faktor) auf die
 * gescrapten Modelle an: `usage` wird multipliziert, `multiplier` und die
 * `effective*`-Preise werden neu berechnet.
 */
export function applyUsageBonuses(models, bonuses) {
  if (!bonuses || bonuses.size === 0) return models;
  for (const m of models) {
    const factor = bonuses.get(normalizeName(m.name));
    if (!factor || factor <= 0) continue;
    m.usage = m.usage * factor;
    recomputeUsageDerived(m);
  }
  return models;
}

/**
 * Tiefen-Vergleich zweier capabilities-Werte; undefined und null werden
 * identisch behandelt (fehlendes Feld vs. explizites null).
 */
export const capabilitiesEqual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Baut die Lookups für die models.dev-Zuordnung auf: opencode-Provider
 * (normalisierte ID und Name) plus kanonische Metadaten (normalisierter Name,
 * bei Kollisionen exakter Normalized-ID-Treffer, sonst erste nach ID sortiert).
 * `resolve(id, name)` liefert das passende models.dev-Modell oder null.
 */
function buildModelsDevLookup(opencodeModels, metadataModels) {
  const opencodeById = new Map();
  const opencodeByName = new Map();
  for (const m of Object.values(opencodeModels)) {
    opencodeById.set(normalizeName(m.id), m);
    opencodeByName.set(normalizeName(m.name), m);
  }

  const canonByName = new Map();
  for (const meta of Object.values(metadataModels)) {
    const norm = normalizeName(meta.name);
    const list = canonByName.get(norm) ?? [];
    list.push(meta);
    canonByName.set(norm, list);
  }
  for (const list of canonByName.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  const resolveCanon = (name) => {
    const norm = normalizeName(name);
    const canonical = canonByName.get(norm);
    if (!canonical?.length) return null;
    return canonical.find((c) => normalizeName(c.id) === norm) ?? canonical[0];
  };

  const resolve = (id, name) => {
    const norm = normalizeName(id);
    return opencodeById.get(norm) ?? opencodeByName.get(norm) ?? (name ? resolveCanon(name) : null);
  };

  return { resolve };
}

/**
 * Reichert jedes Modell mit einem `capabilities`-Objekt aus den models.dev-Daten
 * an (opencode-Provider zuerst, dann kanonische Metadaten, sonst null).
 */
export function enrichCapabilities(models, opencodeModels, metadataModels) {
  const { resolve } = buildModelsDevLookup(opencodeModels, metadataModels);
  for (const m of models) {
    const norm = normalizeName(m.name);
    let md = null;

    if (CAPABILITY_OVERRIDES[norm]) {
      md = metadataModels[CAPABILITY_OVERRIDES[norm]] ?? resolve(CAPABILITY_OVERRIDES[norm]);
    }
    if (!md) md = resolve(m.name, m.name);

    m.capabilities = toCapabilities(md);
  }
  return models;
}

/**
 * Reichert die kostenlosen Zen-Modelle mit `capabilities` an. Zuordnung über die
 * models.dev-ID des opencode-Providers (normalisiert), Fallback auf die
 * kanonischen Metadaten über den normalisierten ID-Slug.
 */
export function enrichFreeModels(freeModels, opencodeModels, metadataModels) {
  const { resolve } = buildModelsDevLookup(opencodeModels, metadataModels);
  for (const f of freeModels) {
    f.capabilities = toCapabilities(resolve(f.id, f.id));
  }
  return freeModels;
}

/**
 * Vergleicht die capabilities von vorherigem und aktuellem Lauf und liefert
 * Diffs im Stil der Pricing-Änderungen (undefined und null gelten als gleich).
 */
export function computeCapabilityDiff(prevModels, nextModels) {
  const prev = new Map(prevModels.map((m) => [modelKey(m), m]));
  const diffs = [];
  for (const m of nextModels) {
    const before = prev.get(modelKey(m));
    if (!before) continue;
    if (!capabilitiesEqual(before.capabilities, m.capabilities)) {
      diffs.push({ key: modelKey(m), from: before.capabilities ?? null, to: m.capabilities ?? null });
    }
  }
  return diffs;
}

const near = (a, b) =>
  (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) < FLOAT_TOLERANCE);

const PRICE_FIELDS = ["input", "output", "cachedRead", "cachedWrite"];

/**
 * Zerlegt eine Pricing-Änderung in getrennte Events: `price_changed` (mit den
 * geänderten Preisfeldern in `fields`) und `usage_changed` (nur Nutzung).
 * Ändern sich Preis UND Nutzung, entstehen zwei Events.
 */
export function splitChange({ key, from, to }) {
  const fields = PRICE_FIELDS.filter((f) => !near(from[f], to[f]));
  const events = [];
  if (fields.length > 0) {
    events.push({ type: "price_changed", model: key, from, to, fields });
  }
  if (from.usage !== to.usage) {
    events.push({ type: "usage_changed", model: key, from: from.usage, to: to.usage });
  }
  return events;
}

export const pricingOf = (model) => ({
  input: model.input,
  output: model.output,
  cachedRead: model.cachedRead,
  cachedWrite: model.cachedWrite,
  usage: model.usage,
});

export function computeDiff(prevModels, nextModels) {
  const prev = new Map(prevModels.map((m) => [modelKey(m), m]));
  const next = new Map(nextModels.map((m) => [modelKey(m), m]));

  const added = [...next.keys()].filter((k) => !prev.has(k));
  const removed = [...prev.keys()].filter((k) => !next.has(k));

  const changed = [];
  for (const key of next.keys()) {
    const before = prev.get(key);
    if (!before) continue;
    const after = next.get(key);
    const from = pricingOf(before);
    const to = pricingOf(after);
    const same =
      near(from.input, to.input) &&
      near(from.output, to.output) &&
      near(from.cachedRead, to.cachedRead) &&
      near(from.cachedWrite, to.cachedWrite) &&
      from.usage === to.usage;
    if (!same) changed.push({ key, from, to });
  }

  return { added, removed, changed };
}

export function buildChanges(prevModels, nextModels, prevFree = [], nextFree = [], today = "", firstSeen = new Map()) {
  if (prevModels === null) return [];

  const { added, removed, changed } = computeDiff(prevModels, nextModels);
  const nextById = new Map(nextModels.map((m) => [modelKey(m), m]));
  const changes = [];

  for (const key of added) {
    const model = nextById.get(key);
    changes.push({ type: "model_added", model: key, pricing: model ? pricingOf(model) : null });
  }
  for (const key of removed) {
    const first = firstSeen.get(key);
    const days = first ? Math.max(0, Math.round((Date.parse(today) - Date.parse(first)) / 86_400_000)) : 0;
    changes.push({ type: "model_removed", model: key, days });
  }
  for (const { key, from, to } of changed) {
    changes.push(...splitChange({ key, from, to }));
  }

  for (const { key, from, to } of computeCapabilityDiff(prevModels, nextModels)) {
    changes.push({ type: "capabilities_changed", model: key, from, to });
  }

  const prevIds = prevFree.map((f) => f.id);
  const nextIds = nextFree.map((f) => f.id);
  for (const f of nextFree.filter((f) => !prevIds.includes(f.id))) {
    changes.push({ type: "free_added", model: f.id });
  }
  for (const f of prevFree.filter((f) => !nextIds.includes(f.id))) {
    changes.push({ type: "free_removed", model: f.id, availableFrom: f.availableFrom, until: today });
  }

  for (const f of nextFree) {
    const before = (Array.isArray(prevFree) ? prevFree : []).find((p) => p.id === f.id);
    if (!before) continue;
    if (!capabilitiesEqual(before.capabilities, f.capabilities)) {
      changes.push({
        type: "capabilities_changed",
        model: f.id,
        from: before.capabilities ?? null,
        to: f.capabilities ?? null,
      });
    }
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

/**
 * Mergt Events desselben Tages (2 Läufe/Tag): neu hinzukommende Events werden
 * angehängt, Events mit gleichem `type` + `model` werden durch das neueste
 * ersetzt (Dedupe, neuestes gewinnt). Für `text`-Events gilt `type` als Schlüssel.
 */
export function mergeChanges(existing, incoming) {
  const key = (c) => `${c.type}:${c.model ?? ""}`;
  const map = new Map();
  for (const c of [...existing, ...incoming]) {
    map.set(key(c), c);
  }
  return [...map.values()];
}

export function upsertChangelogJson(existing, date, changes) {
  const entries = Array.isArray(existing?.entries) ? existing.entries : [];
  const keep = entries.filter((e) => Array.isArray(e.changes) && e.changes.length > 0);
  const hasChanges = Array.isArray(changes) && changes.length > 0;
  if (!hasChanges) return { entries: keep };
  const rest = keep.filter((e) => e.date !== date);
  const sameDate = keep.find((e) => e.date === date);
  const merged = sameDate ? mergeChanges(sameDate.changes, changes) : changes;
  rest.unshift({ date, changes: merged });
  return { entries: rest };
}

const RequestPatternSchema = z.object({
  input: z.number(),
  cachedRead: z.number(),
  output: z.number(),
});

const CapabilitiesSchema = z.object({
  input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
  output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
  reasoning: z.boolean(),
  toolCall: z.boolean(),
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
  capabilities: CapabilitiesSchema.nullable(),
});

const FreeModelSchema = z.object({
  id: z.string().min(1),
  availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capabilities: CapabilitiesSchema.nullable(),
});

const SnapshotSchema = z.object({
  fetchedAt: z.string(),
  sourceUrl: z.string().url(),
  freeModelsSourceUrl: z.string().url(),
  capabilitiesSourceUrl: z.string().url(),
  sourceLang: z.string(),
  monthlyCredit: z.number(),
  models: z.array(ModelSchema).min(1),
  freeModels: z.array(FreeModelSchema),
});

const PricingTypeSchema = z.object({
  input: z.number().nullable(),
  output: z.number().nullable(),
  cachedRead: z.number().nullable(),
  cachedWrite: z.number().nullable(),
  usage: z.number().positive(),
});

const ChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    lang: z.object({ en: z.string().min(1), de: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("model_added"),
    model: z.string().min(1),
    pricing: PricingTypeSchema,
  }),
  z.object({
    type: z.literal("model_removed"),
    model: z.string().min(1),
    days: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("price_changed"),
    model: z.string().min(1),
    from: PricingTypeSchema,
    to: PricingTypeSchema,
    fields: z.array(z.enum(["input", "output", "cachedRead", "cachedWrite"])).min(1),
  }),
  z.object({
    type: z.literal("usage_changed"),
    model: z.string().min(1),
    from: z.number().positive(),
    to: z.number().positive(),
  }),
  z.object({
    type: z.literal("capabilities_changed"),
    model: z.string().min(1),
    from: CapabilitiesSchema.nullable(),
    to: CapabilitiesSchema.nullable(),
  }),
  z.object({ type: z.literal("free_added"), model: z.string().min(1) }),
  z.object({
    type: z.literal("free_removed"),
    model: z.string().min(1),
    availableFrom: z.string(),
    until: z.string(),
  }),
]);

const ChangelogSchema = z.object({
  entries: z.array(
    z.object({
      date: z.string(),
      changes: z.array(ChangeSchema).min(1),
    })
  ),
});

/**
 * Validiert den kompletten Changelog (zod). Leere Einträge (`changes: []`) und
 * unbekannte Event-Typen brechen den Lauf rot ab.
 */
export function validateChangelog(changelog) {
  return ChangelogSchema.parse(changelog);
}

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
    const usageBonuses = await fetchUsageBonuses();
    applyUsageBonuses(models, usageBonuses);
    const bonusLabels = [...usageBonuses.entries()].map(([n, f]) => `${n}×${f}`).join(", ");

    const { providers: mdProviders, models: mdModels, source: mdSource } = await loadModelsDev();
    enrichCapabilities(models, mdProviders.opencode?.models ?? {}, mdModels);

    const fetchedAt = new Date().toISOString();
    const date = fetchedAt.slice(0, 10);

    const prevPath = join(ROOT, "data", "latest.json");
    const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;
    const prevModels = prev && Array.isArray(prev.models) ? prev.models : null;
    const prevFree = prev && Array.isArray(prev.freeModels) ? prev.freeModels : [];
    const currentIds = await fetchZenFreeModels(prevFree.map((f) => f.id));
    const freeModels = enrichFreeModels(
      mergeFreeModels(prevFree, currentIds, date),
      mdProviders.opencode?.models ?? {},
      mdModels
    );

    const historyPath = join(ROOT, "data", "history.json");
    let history = { snapshots: [] };
    if (existsSync(historyPath)) {
      history = JSON.parse(readFileSync(historyPath, "utf8"));
      if (!history || !Array.isArray(history.snapshots)) history = { snapshots: [] };
    }

    const firstSeen = new Map();
    for (const snap of history.snapshots) {
      const day = snap?.fetchedAt?.slice(0, 10);
      if (!day) continue;
      for (const m of snap.models ?? []) {
        const key = modelKey(m);
        if (!firstSeen.has(key)) firstSeen.set(key, day);
      }
    }

    const latest = {
      fetchedAt,
      sourceUrl: SOURCE_URL,
      freeModelsSourceUrl: ZEN_URL,
      capabilitiesSourceUrl: MODELS_DEV_URL,
      sourceLang: SOURCE_LANG,
      monthlyCredit: MONTHLY_CREDIT,
      models,
      freeModels,
    };

    const changes = buildChanges(prevModels, models, prevFree, freeModels, date, firstSeen);

    validateSnapshot(latest);

    const changelogPath = join(ROOT, "CHANGELOG.json");
    const existingChangelog = existsSync(changelogPath) ? JSON.parse(readFileSync(changelogPath, "utf8")) : { entries: [] };
    const changelog = upsertChangelogJson(existingChangelog, date, changes);
    validateChangelog(changelog);
    const changelogJson = JSON.stringify(changelog) + "\n";
    writeFileSync(changelogPath, changelogJson);
    mkdirSync(join(ROOT, "src", "data"), { recursive: true });
    writeFileSync(join(ROOT, "src", "data", "changelog.json"), changelogJson);

    if (changes.length > 0) {
      history.snapshots.push(latest);
      writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
      writeFileSync(prevPath, JSON.stringify(latest, null, 2) + "\n");
    }

    const enriched = models.filter((m) => m.capabilities !== null).length;
    const enrichedFree = freeModels.filter((f) => f.capabilities !== null).length;
    console.log(`Gescrapt: ${models.length} Modelle, ${freeModels.length} kostenlose Modelle (Zen), ${changes.length} Änderungen (Snapshot ${date}); Nutzungs-Boni: ${bonusLabels || "keine"}; Fähigkeiten (models.dev: ${mdSource}) für ${enriched} Modelle + ${enrichedFree} Zen-Modelle.`);
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
