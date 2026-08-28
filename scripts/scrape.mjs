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
// Quelle der kostenlosen Zen-Modelle: die Zen-Doku. Unter „Endpunkte“ stehen die
// Model-IDs, unter „Preise“ die kostenlosen („Free“) Zeilen — das ist die
// autoritative Liste der gratis Modelle (ersetzt die alte zen/v1/models-API).
const ZEN_DOCS_URL = "https://opencode.ai/docs/de/zen/";
const MODELS_DEV_URL = "https://models.dev";
const SOURCE_LANG = "de";
// Fallback-Werte: Monatsguthaben/-preis werden dynamisch aus der Go-Landingpage
// (`https://opencode.ai/de/go`, `[data-slot="cta-price-old"]`) und der Doku-Seite
// ("das Sechsfache dieses Betrags") gezogen; nur wenn die Extraktion fehlschlägt,
// greifen diese Konstanten (mit Warnung, kein Rot-Abbruch).
const DEFAULT_MONTHLY_CREDIT = 60;
const DEFAULT_MONTHLY_COST = 10;
const FLOAT_TOLERANCE = 1e-9;
const USER_AGENT =
  "ocgo-price-tracker/0.1.0 (+https://github.com/all-the-rest/ocgo-price-tracker)";

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
 * Kontextfenster (Tokens) aus den models.dev-Metadaten extrahiert
 * (`md.limit.context`). Fehlend/unbekannt → null.
 */
function toContextWindow(md) {
  return typeof md?.limit?.context === "number" ? md.limit.context : null;
}

/**
 * Anzeige-Name für Hersteller/Provider — angeglichen an cc-price-tracker
 * (großgeschrieben/branded). `Z.ai` für GLM-Modelle (statt Rohwert `zhipuai`).
 */
const PROVIDER_LABELS = {
  alibaba: "Alibaba",
  anthropic: "Anthropic",
  "big-pickle": "Big Pickle",
  deepseek: "DeepSeek",
  "deepseek-flash": "DeepSeek",
  "deepseek-thinking": "DeepSeek",
  glm: "Z.ai",
  "gpt-luna": "OpenAI",
  grok: "xAI",
  "hy3-free": "Tencent",
  "kimi-k2": "Moonshot AI",
  "kimi-k3": "Moonshot AI",
  meituan: "Meituan",
  meta: "Meta",
  "mimo-v2.5-free": "Xiaomi",
  minimax: "MiniMax",
  "muse-free": "Meta",
  "nemotron-free": "NVIDIA",
  nvidia: "NVIDIA",
  opencode: "OpenCode",
  openai: "OpenAI",
  qwen: "Alibaba",
  "qwen3.6": "Alibaba",
  tencent: "Tencent",
  xai: "xAI",
  xiaomi: "Xiaomi",
  zai: "Z.ai",
  zhipuai: "Z.ai",
  moonshotai: "Moonshot AI",
  google: "Google",
  sakana: "Sakana",
  stepfun: "StepFun",
  "thinking-machines": "Thinking Machines",
};

function formatProvider(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase();
  if (PROVIDER_LABELS[key]) return PROVIDER_LABELS[key];
  // Fallback: Titel-Schreibweise (z. B. "meituan" → "Meituan", "big-pickle" → "Big Pickle")
  return key
    .split("-")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

/**
 * Hersteller/Provider aus den models.dev-Metadaten ableiten. models.dev kodiert
 * den Provider im `id`-Prefix (`"anthropic/claude-…"` → "anthropic",
 * `"xai/grok-4.5"` → "xai"); bei `id` ohne Slash/Colon (z. B. interne
 * opencode-IDs) ist kein Provider ableitbar → null. `md.provider` ist bei
 * models.dev meist ein Objekt (npm/api) und `md.family` eine Modellfamilie,
 * daher nur als Fallback, wenn kein Prefix vorliegt. Rückgabe ist der
 * Anzeige-Name (z. B. "Z.ai" statt "zhipuai", "xAI" statt "xai").
 */
function toProvider(md) {
  if (!md) return null;
  let raw = null;
  if (typeof md.id === "string") {
    const slash = md.id.split("/")[0];
    if (slash && slash !== md.id) raw = slash;
    else {
      const colon = md.id.split(":")[0];
      if (colon && colon !== md.id) raw = colon;
    }
  }
  if (!raw && typeof md.provider === "string" && md.provider) raw = md.provider;
  if (!raw && typeof md.family === "string" && md.family) raw = md.family;
  return formatProvider(raw);
}

/**
 * Ausnahmen für die Fähigkeiten-Zuordnung (normalisierter Modellname →
 * kanonische models.dev-ID). Für künftige Edge Cases.
 * Muse Spark 1.2 Contributor: Der Contributor-Tier ist nicht im opencode-Provider
 * und nicht in den kanonischen models.dev-Metadaten gelistet (nur bei Drittanbietern
 * wie openrouter/vercel) → auf den Parent `meta/muse-spark-1.2` abbilden.
 */
const CAPABILITY_OVERRIDES = {
  "musespark1.2contributor": "meta/muse-spark-1.2",
};

function parsePrice(text) {
  const t = (text ?? "").trim();
  if (t === "" || t === "-" || t === "—" || t === "–") return null;
  const cleaned = t.replace(/[\$,\s]/g, "");
  const value = parseFloat(cleaned);
  if (Number.isNaN(value)) throw new ScrapeError(`Preis unparsebar: "${text}"`);
  return value;
}

/**
 * Parst die Nutzung-Spalte. "-" (kein Nutzungslimit, z. B. kostenlose Modelle
 * wie Ox Alpha Free) → null = unbegrenzte Nutzung; sonst `$15` → 15.
 */
function parseUsage(text) {
  const t = (text ?? "").trim();
  if (t === "" || t === "-" || t === "—" || t === "–") return null;
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
 * Fallback-Datenschutz für Modelle ohne eigene Zeile in der Datenschutz-Tabelle:
 * normalisierter Modellname → Familien-Modell, dessen privacy-Angabe übernommen
 * wird (z. B. MiniMax M2.5 → MiniMax M2.7). Übernommene Werte werden im
 * privacy-Objekt mit `fallback: true` markiert.
 */
const PRIVACY_FALLBACKS = {
  "minimaxm2.5": "minimaxm2.7",
};

/**
 * Manuelle Datenschutz-Angaben für einzelne kostenlose Zen-Modelle (models.dev
 * führt keine Datenschutz-Felder): x-preview-f-free ist Ox Alpha Free (laut
 * models.dev der Zen-Eintrag „Ox Alpha Free (Unlimited)“) und hat wie das
 * Doku-Modell ZDR. Eintrag kann entfallen, sobald die Quelle selbst listet.
 */
const FREE_MODEL_PRIVACY_OVERRIDES = {
  "xpreviewffree": { training: false, retentionDays: true, validUntil: null },
};

/**
 * Liefert die erste `<table>` nach der Überschrift mit der gegebenen `id`
 * (z. B. `#endpunkte` oder `#preise`), oder ein leeres Element.
 */
function tableAfterHeading($, headingId) {
  let el = $(`#${headingId}`).next();
  while (el.length && !el.is("table")) el = el.next();
  return el;
}

/**
 * Parst die „Endpunkte“-Tabelle der Zen-Doku und liefert eine Map von
 * normalisiertem Modellnamen → Model-ID (Spalten „Model“ / „Model ID“).
 */
export function parseZenEndpointIds(html) {
  const $ = cheerio.load(html);
  const map = new Map();
  const rows = tableAfterHeading($, "endpunkte").find("tbody tr");
  rows.each((_, tr) => {
    const cells = $(tr).find("td");
    const name = $(cells[0]).text().trim();
    const id = $(cells[1]).text().trim();
    if (name && id) map.set(normalizeName(name), id);
  });
  return map;
}

/**
 * Parst die Zen-Doku (`https://opencode.ai/docs/de/zen/`) und extrahiert die
 * kostenlosen Modelle. Die „Endpunkte“-Tabelle liefert die Model-IDs (per
 * normalisiertem Namen), die „Preise“-Tabelle markiert die gratis Zeilen
 * (Input-Spalte = „Free“). Beide werden über den Modellnamen korreliert.
 * Ergebnis: deduplizierte, sortierte Liste der kostenlosen Model-IDs.
 */
export function extractFreeModelsFromDocs(html) {
  const $ = cheerio.load(html);
  const idsByName = parseZenEndpointIds(html);
  const free = [];
  const rows = tableAfterHeading($, "preise").find("tbody tr");
  rows.each((_, tr) => {
    const cells = $(tr).find("td");
    const name = $(cells[0]).text().trim();
    const input = $(cells[1]).text().trim().toLowerCase();
    if (input === "free") {
      const id = idsByName.get(normalizeName(name));
      if (id) free.push(id);
    }
  });
  return [...new Set(free)].sort();
}

async function fetchZenFreeModels(previousFree) {
  try {
    const res = await fetch(ZEN_DOCS_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new ScrapeError(`HTTP ${res.status} bei ${ZEN_DOCS_URL}`);
    const html = await res.text();
    return extractFreeModelsFromDocs(html);
  } catch (err) {
    console.error(
      `[scrape] Warnung: Zen-Doku nicht erreichbar (${err instanceof Error ? err.message : String(err)}); behalte ${previousFree.length} bisherige Einträge.`
    );
    return previousFree;
  }
}

/**
 * Holt die Go-Landingpage (`https://opencode.ai/de/go`). Ein HTTP-Fehler bricht
 * rot ab, weil die Seite sowohl die temporären Nutzungs-Boni als auch den
 * laufenden Monatspreis liefert (verlässliche Preise sind Pflicht).
 */
async function fetchGoLanding() {
  const res = await fetch(BONUS_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new ScrapeError(`HTTP ${res.status} beim Abrufen von ${BONUS_URL}`);
  return cheerio.load(await res.text());
}

const CREDIT_FACTOR_WORDS = {
  ein: 1,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
};

/**
 * Parst den laufenden Monatspreis (`$10/Monat`) aus einer Seite. Bevorzugt das
 * semantische `[data-slot="cta-price-old"]`-Element der Go-Landingpage (der
 * reguläre Preis, falls wieder ein Einführungspreis als `cta-price-new`
 * danebensteht), sonst das CTA-Element selbst (`cta-price`), sonst die Prosa
 * `$N/Monat` (Doku-Seite). Existiert ein CTA-Kandidat, ist sein Text aber
 * unparsebar → ScrapeError; existiert gar keiner → null (Fallback).
 */
export function parseMonthlyCost($) {
  let cta = $("[data-slot='cta-price-old']").first();
  if (cta.length === 0) cta = $("[data-slot='cta-price']").first();
  if (cta.length > 0) {
    const text = cta.text().trim();
    const m = text.match(/\$(\d+(?:[.,]\d+)?)\s*\/\s*Monat/i);
    if (!m) throw new ScrapeError(`Monatspreis im CTA-Element unparsebar: "${text}"`);
    return Number(m[1].replace(",", "."));
  }
  const text = $("body").text().replace(/\s+/g, " ");
  const m = text.match(/\$(\d+(?:[.,]\d+)?)\s*\/\s*Monat/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/**
 * Parst den dokumentierten Guthaben-Faktor ("das Sechsfache dieses Betrags" =
 * 6, "das 6-fache dieses Betrags" = 6, "das 6× dieses Betrags" = 6) aus der
 * Doku-Seite. Das Monatsguthaben ergibt sich als Monatspreis × Faktor
 * ($10 × 6 = $60). Kein solcher Satz → null; Satz vorhanden, aber Faktor
 * unbekannt → ScrapeError.
 */
export function parseCreditFactor($) {
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const m = text.match(
    /\bdas\s+(?:([a-zäöüß]+)-?fache|(\d+(?:[.,]\d+)?)\s*(?:[x×]|-?fache))\s+dieses\s+Betrags\b/i
  );
  if (!m) return null;
  if (m[2] !== undefined) return Number(m[2].replace(",", "."));
  const factor = CREDIT_FACTOR_WORDS[m[1].toLowerCase()];
  if (factor === undefined) {
    throw new ScrapeError(`Guthaben-Faktor unparsebar: "${m[1]}"`);
  }
  return factor;
}

/**
 * Parst Monatspreis und Guthaben-Faktor aus einer Seite (Landingpage oder
 * Doku-Seite). Das Guthaben wird erst in main() aus Preis × Faktor berechnet,
 * damit beide Seiten kombiniert werden können (Landingpage liefert den Preis,
 * die Doku-Seite den Faktor).
 */
export function parseMonthlyPricing($) {
  return { monthlyCost: parseMonthlyCost($), creditFactor: parseCreditFactor($) };
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
 * Wird nach einer Bonus-Anpassung des Nutzungslimits und nach der Bestimmung des
 * (dynamisch gefetchten) Monatsguthabens erneut aufgerufen. Ohne expliziten
 * Wert wird das Fallback-Guthaben (`DEFAULT_MONTHLY_CREDIT`) verwendet.
 */
export function recomputeUsageDerived(model, monthlyCredit = DEFAULT_MONTHLY_CREDIT) {
  // usage = null (unbegrenzte Nutzung, kostenlose Modelle) → keine Multiplikator-
  // Rechnung. Kostenlose Zeilen ("-" in der Doku) bekommen Token-Preise 0 statt
  // null — gratis ist ein bekannter Preis, kein fehlender.
  if (model.usage === null) {
    model.multiplier = null;
    model.input ??= 0;
    model.output ??= 0;
    model.cachedRead ??= 0;
    model.cachedWrite ??= 0;
    model.effectiveInput = model.input;
    model.effectiveOutput = model.output;
    model.effectiveCachedRead = model.cachedRead;
    model.effectiveCachedWrite = model.cachedWrite;
    return;
  }
  const multiplier = monthlyCredit / model.usage;
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
 * Findet die Datenschutz-Tabelle (Modell / Modelltraining / Datenaufbewahrung)
 * über die Header-Zeile — NICHT über nth-child-Selektoren.
 */
function findPrivacyTable($) {
  const matches = [];
  $("main table").each((_, table) => {
    const headers = $(table)
      .find("thead th")
      .map((_, th) => $(th).text().trim().toLowerCase())
      .get();
    if (
      headers.some((h) => h.includes("modelltraining")) &&
      headers.some((h) => h.includes("datenaufbewahrung"))
    ) {
      matches.push(table);
    }
  });
  if (matches.length === 0) {
    throw new ScrapeError(
      "keine Datenschutz-Tabelle gefunden (Header-Zellen mit 'modelltraining' UND 'datenaufbewahrung' fehlen)"
    );
  }
  if (matches.length > 1) {
    console.error(`[scrape] Warnung: ${matches.length} Datenschutz-Tabellen gefunden, erste wird verwendet.`);
  }
  return matches[0];
}

/**
 * Parst die Spalte "Modelltraining". "Nicht verwendet"/"Nein" → false, alles
 * andere Nicht-leere (z. B. "Verwendet"/"Ja") → true.
 */
function parseTraining(text) {
  const t = (text ?? "").trim();
  if (t === "") throw new ScrapeError("Modelltraining unparsebar: leere Zelle");
  return !/nicht|kein|nein|no\b/i.test(t);
}

/**
 * Parst die Spalte "Datenaufbewahrung":
 * - "30 Tage" → 30 (bekannte Dauer in Tagen)
 * - "0 Tage" → true (ZDR = Zero Data Retention)
 * - "Kein ZDR" → false (keine ZDR-Vereinbarung: Daten werden aufbewahrt,
 *   Dauer unbekannt — z. B. Muse Spark 1.2, Meta-Contributor-Tier)
 * - "–"/"-" → undefined (unbekannt, Feld fehlt im JSON)
 */
function parseRetentionDays(text) {
  const t = (text ?? "").trim();
  if (t === "" || t === "-" || t === "—" || t === "–") return undefined;
  if (/^kein(?:e)?\s+zdr$/i.test(t)) return false;
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*Tage?$/i);
  if (!m) throw new ScrapeError(`Datenaufbewahrung unparsebar: "${text}"`);
  const days = Number(m[1].replace(",", "."));
  return days === 0 ? true : days;
}

const DE_MONTHS = {
  januar: "01",
  februar: "02",
  märz: "03",
  maerz: "03",
  april: "04",
  mai: "05",
  juni: "06",
  juli: "07",
  august: "08",
  september: "09",
  oktober: "10",
  november: "11",
  dezember: "12",
};

/**
 * Parst ein deutsches Datum ("31. August 2026") zu ISO ("2026-08-31").
 * Liefert null bei unbekanntem Format oder Monatsnamen.
 */
export function parseGermanDate(text) {
  const t = (text ?? "").trim().replace(/\.+$/, "");
  const m = t.match(/^(\d{1,2})\.\s+([A-Za-zäöüß]+)\s+(\d{4})$/);
  if (!m) return null;
  const month = DE_MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return `${m[3]}-${month}-${String(day).padStart(2, "0")}`;
}

/**
 * Parst die Datenschutz-Tabelle und liefert eine Map normalisierter Modellnamen
 * → { training, retentionDays }. Die Zuordnung erfolgt über den Modellnamen
 * (eine Tabellenzeile gilt für alle Tier-Varianten des Modells).
 */
export function parsePrivacyTable($, table) {
  const map = new Map();
  $(table)
    .find("tbody tr, > tr")
    .each((_, row) => {
      const cells = $(row)
        .find("th, td")
        .map((_, c) => $(c).text().trim())
        .get();
      const first = (cells[0] ?? "").trim().toLowerCase();
      if (first === "modell" || first === "model") return;
      if (cells.length < 3) return;
      map.set(normalizeName(cells[0]), {
        training: parseTraining(cells[1]),
        retentionDays: parseRetentionDays(cells[2]),
      });
    });
  return map;
}

/**
 * Parst die Notizen-Liste unter der Datenschutz-Tabelle (z. B. die monatliche
 * ZDR-Vereinbarung von DeepSeek V4 Flash: "gilt bis einschließlich 31. August
 * 2026") und liefert eine Map normalisierter Modellnamen → validUntil (ISO).
 */
export function parsePrivacyNotes($) {
  const map = new Map();
  $("main ul li").each((_, li) => {
    const $li = $(li);
    const label = $li
      .find("strong")
      .first()
      .text()
      .trim()
      .replace(/:$/, "")
      .trim();
    if (!label) return;
    const text = $li.text().replace(/\s+/g, " ").trim();
    const m = text.match(/(?:gilt|gültig)\s+bis(?:\s+einschließlich)?\s+(\d{1,2}\.\s+[A-Za-zäöüß]+\s+\d{4})/i);
    if (!m) return;
    const date = parseGermanDate(m[1]);
    if (date) map.set(normalizeName(label), date);
  });
  return map;
}

function isPeakTier(tier) {
  return /^(?:off[- ]?peak|peak)$/i.test(tier ?? "");
}

/**
 * "Off-Peak" ist die normale Nutzung eines Modells. Eine Off-Peak-Stufe wird
 * beim Modell-Diff wie das ungestufte (normale) Modell behandelt, damit die
 * Einführung von Peak-/Off-Peak-Stufen kein `model_added`/`model_removed`
 * auslöst, sondern als `price_changed` am (Off-Peak = Normal-Nutzung) Modell
 * erscheint.
 */
function isOffPeakTier(tier) {
  return /^(?:off[- ]?peak)$/i.test(tier ?? "");
}

function sharedModelPrefix(a, b) {
  const aWords = a.trim().split(/\s+/);
  const bWords = b.trim().split(/\s+/);
  let count = 0;
  while (
    count < aWords.length &&
    count < bWords.length &&
    normalizeName(aWords[count]) === normalizeName(bWords[count])
  ) {
    count += 1;
  }
  return count >= 2 ? normalizeName(aWords.slice(0, count).join(" ")) : "";
}

/**
 * Parst die UTC-Peak-Zeitfenster aus dem Hinweis unter der Preistabelle. Die
 * Modellnamen kommen aus den Peak-/Off-Peak-Zeilen, damit ein Hinweis wie
 * "DeepSeek V4 Flash / Pro" beide Modell-IDs zuverlässig abdeckt.
 */
export function parsePeakHours($, models = []) {
  const peakModels = [...new Set(models.filter((m) => isPeakTier(m.tier)).map((m) => m.name))];
  if (peakModels.length === 0) return {};

  const peakText = $("main p, main li")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .find((text) => /\bpeak\b|spitzenzeiten|stoßzeiten/i.test(text) && /UTC\b/i.test(text));
  if (!peakText) {
    throw new ScrapeError("Peak-/Off-Peak-Modelle gefunden, aber kein UTC-Zeitfenster im Dokument");
  }

  const ranges = [];
  const rangePattern = /(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/g;
  for (const match of peakText.matchAll(rangePattern)) {
    const startMinute = match[2] === undefined ? 0 : Number(match[2]);
    const endMinute = match[4] === undefined ? 0 : Number(match[4]);
    const start = Number(match[1]);
    const end = Number(match[3]);
    if (
      startMinute !== 0 ||
      endMinute !== 0 ||
      start < 0 ||
      start > 23 ||
      end < 1 ||
      end > 24 ||
      start >= end
    ) {
      throw new ScrapeError(`Peak-Zeitfenster unparsebar: "${match[0]}"`);
    }
    ranges.push([start, end]);
  }
  if (ranges.length === 0) {
    throw new ScrapeError(`Keine gültigen UTC-Peak-Zeitfenster gefunden: "${peakText}"`);
  }

  const subject = normalizeName(peakText.split(":", 1)[0]);
  const matched = peakModels.filter((name) => {
    const norm = normalizeName(name);
    if (subject.includes(norm)) return true;
    return peakModels.some((other) => {
      if (other === name) return false;
      const prefix = sharedModelPrefix(name, other);
      return prefix !== "" && subject.includes(prefix);
    });
  });
  if (matched.length === 0) {
    throw new ScrapeError(`Peak-Zeitfenster konnte keinem Modell zugeordnet werden: "${peakText}"`);
  }
  return Object.fromEntries(matched.map((name) => [normalizeName(name), ranges]));
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

  const privacyTable = findPrivacyTable($);
  const privacyMap = parsePrivacyTable($, privacyTable);
  const validUntilMap = parsePrivacyNotes($);
  for (const m of models) {
    const norm = normalizeName(m.name);
    const own = privacyMap.get(norm);
    const base = own ?? privacyMap.get(PRIVACY_FALLBACKS[norm] ?? "");
    if (!base) {
      m.privacy = null;
      continue;
    }
    const fallback = !own;
    m.privacy = {
      ...base,
      validUntil: validUntilMap.get(norm) ?? null,
      ...(fallback ? { fallback: true } : {}),
    };
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
 * `effective*`-Preise werden neu berechnet (mit dem übergebenen Monatsguthaben).
 */
export function applyUsageBonuses(models, bonuses, monthlyCredit = DEFAULT_MONTHLY_CREDIT) {
  if (!bonuses || bonuses.size === 0) return models;
  for (const m of models) {
    const factor = bonuses.get(normalizeName(m.name));
    if (!factor || factor <= 0) continue;
    if (m.usage === null) continue; // unbegrenzte Nutzung — kein Bonus anwendbar
    m.usage = m.usage * factor;
    recomputeUsageDerived(m, monthlyCredit);
  }
  return models;
}

/**
 * Tiefen-Vergleich zweier capabilities-Werte; undefined und null werden
 * identisch behandelt (fehlendes Feld vs. explizites null).
 */
export const capabilitiesEqual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Tiefen-Vergleich zweier privacy-Werte; undefined und null werden identisch
 * behandelt (fehlendes Feld vs. explizites null).
 */
export const privacyEqual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Vergleich der Datenschutz-*Stufe* ohne `validUntil`: reine Verlängerung oder
 * Änderung des ZDR-Datums ist kein Status-Wechsel (z. B. ZDR → ZDR mit neuem
 * Datum) → kein Changelog-Event, nur stilles Daten-Update.
 */
export const privacyStatusEqual = (a, b) => {
  const strip = (p) => {
    if (p == null) return null;
    const { validUntil, ...status } = p;
    return status;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
};

/**
 * Baut die Lookups für die models.dev-Zuordnung auf: opencode-Provider
 * (normalisierte ID und Name), kanonische Metadaten (normalisierter Name,
 * bei Kollisionen exakter Normalized-ID-Treffer, sonst erste nach ID sortiert),
 * danach opencode-go als Lückenfüller (nur Treffer, die weder im Zen-Provider
 * noch kanonisch existieren — dessen Einträge sind teils weniger gepflegt).
 * `resolve(id, name)` liefert das passende models.dev-Modell oder null.
 */
function buildModelsDevLookup(opencodeModels, metadataModels, goModels = {}) {
  const opencodeById = new Map();
  const opencodeByName = new Map();
  for (const m of Object.values(opencodeModels)) {
    opencodeById.set(normalizeName(m.id), m);
    opencodeByName.set(normalizeName(m.name), m);
  }
  const goById = new Map();
  const goByName = new Map();
  for (const m of Object.values(goModels)) {
    goById.set(normalizeName(m.id), m);
    goByName.set(normalizeName(m.name), m);
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
    return (
      opencodeById.get(norm) ??
      opencodeByName.get(norm) ??
      (name ? resolveCanon(name) : null) ??
      goById.get(norm) ??
      (name ? goByName.get(normalizeName(name)) ?? null : null)
    );
  };

  /**
   * Liefert die OpenCode-Modell-ID als kopierbare `provider/id`-Zeichenkette:
   *  - bevorzugt den `opencode-go`-Provider (die bezahlten Go-Modelle)
   *    → `opencode-go/<id>`
   *  - sonst der `opencode`-Provider (Zen/free sowie überschneidende Go-Modelle)
   *    → `opencode/<id>`
   *  - null, wenn in keinem der beiden Provider gelistet.
   */
  const resolveOpencodeId = (id, name) => {
    const norm = normalizeName(id);
    const go = goById.get(norm)?.id ?? goByName.get(norm)?.id;
    if (go) return `opencode-go/${go}`;
    const oc = opencodeById.get(norm)?.id ?? opencodeByName.get(norm)?.id;
    if (oc) return `opencode/${oc}`;
    return null;
  };

  return { resolve, resolveOpencodeId };
}

/**
 * Reichert jedes Modell mit einem `capabilities`-Objekt aus den models.dev-Daten
 * an (opencode-Provider zuerst, dann kanonische Metadaten, sonst null).
 */
export function enrichCapabilities(models, opencodeModels, metadataModels, goModels = {}) {
  const { resolve, resolveOpencodeId } = buildModelsDevLookup(opencodeModels, metadataModels, goModels);
  for (const m of models) {
    const norm = normalizeName(m.name);
    let md = null;

    if (CAPABILITY_OVERRIDES[norm]) {
      md = metadataModels[CAPABILITY_OVERRIDES[norm]] ?? resolve(CAPABILITY_OVERRIDES[norm]);
    }
    if (!md) md = resolve(m.name, m.name);

    m.capabilities = toCapabilities(md);
    // Kontextfenster (Tokens) aus models.dev; null wenn nicht gelistet.
    m.contextWindow = toContextWindow(md);
    // Hersteller/Provider aus models.dev (id-Prefix); null wenn nicht ableitbar.
    m.provider = toProvider(md);
    // Modell-ID für OpenCode (`opencode/<id>`), null wenn nicht im
    // opencode-Provider gelistet → UI zeigt die Zeile ohne ID an.
    m.id = resolveOpencodeId(m.name, m.name);
  }
  return models;
}

/**
 * Reichert die kostenlose Zen-Modelle mit `name` (öffentlicher Name aus
 * models.dev, Klammer-Zusätze wie „(Unlimited)“ werden entfernt — nur
 * informativ, Namensänderungen erzeugen keine Changelog-Events), `capabilities`
 * (models.dev: opencode-go zuerst, Fallback opencode-zen, dann kanonische
 * Metadaten) und `privacy` an.
 *
 * Standard-privacy: „fürs Training genutzt“ (keine explizite Angabe in der Doku
 * — Zen-Seite nennt lediglich das Feedback zur Modellverbesserung;
 * Aufbewahrung unbekannt → `retentionDays` bleibt weg). Ausnahmen siehe
 * FREE_MODEL_PRIVACY_OVERRIDES.
 */
export function enrichFreeModels(freeModels, providerModels, metadataModels, goModels = {}) {
  const { resolve } = buildModelsDevLookup(providerModels, metadataModels, goModels);
  for (const f of freeModels) {
    const md = resolve(f.id, f.id);
    f.capabilities = toCapabilities(md);
    f.contextWindow = toContextWindow(md);
    f.provider = toProvider(md);
    const publicName = md?.name?.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (publicName) f.name = publicName;
    f.privacy = FREE_MODEL_PRIVACY_OVERRIDES[normalizeName(f.id)] ?? { training: true, validUntil: null };
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

/**
 * Vergleicht die Datenschutz-Infos von vorherigem und aktuellem Lauf. Modelle,
 * deren Vorgänger noch kein `privacy` hatte (`undefined`/`null` — Feld fehlt
 * oder Modell nicht gelistet), werden übersprungen: die Erst-Befüllung (auch
 * Familien-Fallback) erzeugt keinen Changelog-Event. Reine `validUntil`-Änderungen
 * (Stufe unverändert, z. B. ZDR-Verlängerung) erzeugen ebenfalls keinen Event.
 */
export function computePrivacyDiff(prevModels, nextModels) {
  const prev = new Map(prevModels.map((m) => [modelKey(m), m]));
  const diffs = [];
  for (const m of nextModels) {
    const before = prev.get(modelKey(m));
    if (!before || before.privacy == null) continue;
    if (!privacyStatusEqual(before.privacy, m.privacy)) {
      diffs.push({ key: modelKey(m), from: before.privacy ?? null, to: m.privacy ?? null });
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

/**
 * Vergleichs-Key für das Modell-Diff: eine "Off-Peak"-Stufe kollabiert auf den
 * reinen Modellnamen (die normale Nutzung), sodass sie mit dem bisherigen
 * ungestuften Modell desselben Namens verschmilzt.
 */
const diffKey = (m) => (isOffPeakTier(m.tier) ? m.name : modelKey(m));

export function computeDiff(prevModels, nextModels) {
  const prev = new Map(prevModels.map((m) => [diffKey(m), m]));
  const next = new Map(nextModels.map((m) => [diffKey(m), m]));

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
    if (!same) changed.push({ key, from, to, offPeak: isOffPeakTier(after.tier) });
  }

  return { added, removed, changed };
}

export function buildChanges(prevModels, nextModels, prevFree = [], nextFree = [], today = "", firstSeen = new Map()) {
  if (prevModels === null) return [];

  const { added, removed, changed } = computeDiff(prevModels, nextModels);
  const nextById = new Map(nextModels.map((m) => [diffKey(m), m]));
  const prevById = new Map((prevModels ?? []).map((m) => [diffKey(m), m]));
  const changes = [];

  for (const key of added) {
    const model = nextById.get(key);
    changes.push({ type: "model_added", model: key, pricing: model ? pricingOf(model) : null });
  }
  for (const key of removed) {
    const first = firstSeen.get(key);
    const days = first ? Math.max(0, Math.round((Date.parse(today) - Date.parse(first)) / 86_400_000)) : 0;
    const prevModel = prevById.get(key);
    changes.push({
      type: "model_removed",
      model: key,
      days,
      pricing: prevModel ? pricingOf(prevModel) : null,
    });
  }
  for (const { key, from, to, offPeak } of changed) {
    // Off-Peak ist die normale Nutzung: eine gleichzeitige Preis- UND
    // Nutzungsänderung am (Off-Peak = Normal-)Modell wird als ein einziges
    // `price_changed` gemeldet, nicht als zusätzliches `usage_changed`.
    if (offPeak && from.usage !== to.usage) {
      const events = splitChange({ key, from, to });
      // Preis- UND Nutzungsänderung: ein einziges `price_changed` (usage steckt
      // im to-Pricing, in der UI fett). Reine Nutzungsänderung (Preise gleich):
      // kein `price_changed` vorhanden → stattdessen das `usage_changed` melden,
      // sonst verlöre die Off-Peak-Zeile ihr Event.
      changes.push(events.find((e) => e.type === "price_changed") ?? events.find((e) => e.type === "usage_changed"));
    } else {
      changes.push(...splitChange({ key, from, to }));
    }
  }

  // Fähigkeiten-Änderungen werden unterdrückt, wenn das Modell selbst erst
  // innerhalb der letzten 24h hinzugefügt wurde (model_added/free_added): Bei
  // neuen Modellen werden die Fähigkeiten oft verzögert (models.dev)
  // nachgeliefert — das ist keine echte Quelländerung, sondern Erstbefüllung.
  // Analog zur stillen privacy-Erstbefüllung wird hier KEIN Event erzeugt.
  const todayMs = Number.isNaN(Date.parse(today)) ? null : Date.parse(today);
  const addedWithin24h = (key) => {
    if (todayMs == null) return false;
    const fs = firstSeen.get(key);
    if (fs == null) return false;
    const diffDays = Math.round((todayMs - Date.parse(fs)) / 86_400_000);
    return diffDays >= 0 && diffDays <= 1;
  };

  for (const { key, from, to } of computeCapabilityDiff(prevModels, nextModels)) {
    if (addedWithin24h(key)) continue;
    changes.push({ type: "capabilities_changed", model: key, from, to });
  }

  for (const { key, from, to } of computePrivacyDiff(prevModels, nextModels)) {
    changes.push({ type: "privacy_changed", model: key, from, to });
  }

  const prevIds = prevFree.map((f) => f.id);
  const nextIds = nextFree.map((f) => f.id);
  for (const f of nextFree.filter((f) => !prevIds.includes(f.id))) {
    // Optionaler Anzeigename (models.dev, z. B. x-preview-f-free → „Ox Alpha
    // Free") — die rohe Zen-ID bleibt als `model` erhalten (Diff/Referenz).
    changes.push({ type: "free_added", model: f.id, ...(f.name ? { name: f.name } : {}) });
  }
  for (const f of prevFree.filter((f) => !nextIds.includes(f.id))) {
    changes.push({
      type: "free_removed",
      model: f.id,
      ...(f.name ? { name: f.name } : {}),
      availableFrom: f.availableFrom,
      until: today,
    });
  }

  for (const f of nextFree) {
    const before = (Array.isArray(prevFree) ? prevFree : []).find((p) => p.id === f.id);
    if (!before) continue;
    if (!capabilitiesEqual(before.capabilities, f.capabilities)) {
      // Erstbefüllung eines erst kürzlich hinzugefügten kostenlosen Modells:
      // kein capabilities_changed-Event (siehe addedWithin24h oben).
      if (addedWithin24h(f.id)) continue;
      changes.push({
        type: "capabilities_changed",
        model: f.id,
        from: before.capabilities ?? null,
        to: f.capabilities ?? null,
      });
    }
  }

  for (const f of nextFree) {
    const before = (Array.isArray(prevFree) ? prevFree : []).find((p) => p.id === f.id);
    if (!before || before.privacy == null) continue;
    if (!privacyStatusEqual(before.privacy, f.privacy)) {
      changes.push({
        type: "privacy_changed",
        model: f.id,
        from: before.privacy ?? null,
        to: f.privacy ?? null,
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
 * Dedupet Events innerhalb EINES Run-Eintrags (gleiche `type`+`model` → neuestes
 * gewinnt). Seit der Umstellung auf Per-Run-Einträge wird das nur noch für
 * idempotente Wiederholungen desselben Run-`id` genutzt — mehrere Läufe pro Tag
 * erzeugen jeweils EIGENE Einträge (kein Day-Merge mehr).
 */
export function mergeChanges(existing, incoming) {
  const key = (c) => `${c.type}:${c.model ?? ""}`;
  const map = new Map();
  for (const c of [...existing, ...incoming]) {
    map.set(key(c), c);
  }
  return [...map.values()];
}

/**
 * Fügt pro Run einen EIGENEN Changelog-Eintrag ein (Schlüssel = eindeutiges
 * `id`, abgeleitet von `fetchedAt`). Mehrere Läufe/Tag → mehrere Einträge (kein
 * Merge über den Tag hinweg). Ein Eintrag mit demselben `id` wird ersetzt
 * (idempotent bei CI-Wiederholungen). `date` (`YYYY-MM-DD`) dient nur noch der
 * Anzeige/Groupierung.
 */
export function upsertChangelogJson(existing, id, date, changes) {
  const entries = Array.isArray(existing?.entries) ? existing.entries : [];
  const keep = entries.filter((e) => Array.isArray(e.changes) && e.changes.length > 0);
  const hasChanges = Array.isArray(changes) && changes.length > 0;
  if (!hasChanges) return { entries: keep };
  const rest = keep.filter((e) => e.id !== id);
  const sameId = keep.find((e) => e.id === id);
  const merged = sameId ? mergeChanges(sameId.changes, changes) : changes;
  rest.unshift({ id, date, changes: merged });
  return { entries: rest };
}

/**
 * Migration des Vorschemas (ein Eintrag pro Tag, kein `id`): weist fehlenden
 * Einträgen `id = date` zu, damit bestehende GitHub-Releases (Tag = Datum)
 * weiterhin zum Changelog passen. Neue Einträge bekommen ein `id` aus dem
 * Run-Zeitstempel.
 */
export function normalizeChangelogIds(changelog) {
  const entries = Array.isArray(changelog?.entries) ? changelog.entries : [];
  return { entries: entries.map((e) => (e && e.id ? e : { ...e, id: e?.date })) };
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

const PrivacySchema = z.object({
  training: z.boolean(),
  // true = ZDR (0 Tage), false = kein ZDR (Daten aufbewahrt, Dauer unbekannt),
  // number = N Tage Aufbewahrung, undefined/fehlend = unbekannt
  retentionDays: z.union([z.boolean(), z.number()]).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  fallback: z.boolean().optional(),
});

const ModelSchema = z
  .object({
    name: z.string().min(1),
    tier: z.string().nullable(),
    // Modell-ID für OpenCode (`opencode/<id>`), null wenn nicht im
    // opencode-Provider (models.dev) gelistet
    id: z.string().min(1).nullable().optional(),
    input: z.number().nullable(),
    output: z.number().nullable(),
    cachedRead: z.number().nullable(),
    cachedWrite: z.number().nullable(),
    // null = unbegrenzte Nutzung (kostenlose Modelle, "-" in der Doku)
    usage: z.number().positive().nullable(),
    multiplier: z.number().positive().nullable(),
    effectiveInput: z.number().nullable(),
    effectiveOutput: z.number().nullable(),
    effectiveCachedRead: z.number().nullable(),
    effectiveCachedWrite: z.number().nullable(),
    pattern: RequestPatternSchema.nullable(),
    capabilities: CapabilitiesSchema.nullable(),
    // Kontextfenster in Tokens (aus models.dev); null = unbekannt.
    contextWindow: z.number().nullable(),
    // Hersteller/Provider (aus models.dev); null = unbekannt.
    provider: z.string().nullable().default(null),
    privacy: PrivacySchema.nullable(),
  })
  .superRefine((m, ctx) => {
    // Modelle MIT Preisen/Nutzung müssen ein Anfragemuster haben; kostenlose
    // Zeilen ("-" → Preise 0, Nutzung null) dürfen ohne Muster durchgehen.
    const hasPricing =
      m.usage !== null || [m.input, m.output, m.cachedRead].some((v) => v !== null && v > 0);
    if (hasPricing && m.pattern === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pattern"], message: "pattern fehlt (Preise vorhanden)" });
    }
  });

const FreeModelSchema = z.object({
  id: z.string().min(1),
  // optionaler Anzeigename (bei Alias-IDs wie x-preview-f-free = Ox Alpha Free)
  name: z.string().min(1).optional(),
  availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capabilities: CapabilitiesSchema.nullable(),
  contextWindow: z.number().nullable(),
  provider: z.string().nullable().default(null),
  privacy: PrivacySchema,
});

const SnapshotSchema = z.object({
  fetchedAt: z.string(),
  sourceUrl: z.string().url(),
  freeModelsSourceUrl: z.string().url(),
  capabilitiesSourceUrl: z.string().url(),
  sourceLang: z.string(),
  monthlyCredit: z.number().positive(),
  monthlyCost: z.number().positive(),
  peakHours: z.record(
    z.string().min(1),
    z.array(
      z
        .tuple([
          z.number().int().min(0).max(23),
          z.number().int().min(1).max(24),
        ])
        .refine(([start, end]) => start < end)
    ).min(1)
  ),
  models: z.array(ModelSchema).min(1),
  freeModels: z.array(FreeModelSchema),
});

const PricingTypeSchema = z.object({
  input: z.number().nullable(),
  output: z.number().nullable(),
  cachedRead: z.number().nullable(),
  cachedWrite: z.number().nullable(),
  usage: z.number().positive().nullable(),
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
    pricing: PricingTypeSchema,
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
    from: z.number().positive().nullable(),
    to: z.number().positive().nullable(),
  }),
  z.object({
    type: z.literal("capabilities_changed"),
    model: z.string().min(1),
    from: CapabilitiesSchema.nullable(),
    to: CapabilitiesSchema.nullable(),
  }),
  z.object({
    type: z.literal("privacy_changed"),
    model: z.string().min(1),
    from: PrivacySchema.nullable(),
    to: PrivacySchema.nullable(),
  }),
  z.object({ type: z.literal("free_added"), model: z.string().min(1), name: z.string().min(1).optional() }),
  z.object({
    type: z.literal("free_removed"),
    model: z.string().min(1),
    name: z.string().min(1).optional(),
    availableFrom: z.string(),
    until: z.string(),
  }),
]);

const ChangelogSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string().min(1),
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
 * Validiert einen kompletten Snapshot (zod). Modelle MIT Preisen/Nutzung müssen
 * Token-Stats (`pattern`) haben — ein fehlendes Muster bricht den Lauf rot ab.
 * Ausnahme: vollständig kostenlose Zeilen (alle Preise "-", Nutzung "-").
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
    const docs$ = cheerio.load(html);
    const models = parseHtml(html);
    const peakHours = parsePeakHours(docs$, models);
    const landing$ = await fetchGoLanding();
    const usageBonuses = parseUsageBonuses(landing$);
    applyUsageBonuses(models, usageBonuses);
    const bonusLabels = [...usageBonuses.entries()].map(([n, f]) => `${n}×${f}`).join(", ");

    // Monatsguthaben/-preis dynamisch: Monatspreis von der Landingpage
    // (`[data-slot="cta-price-old"]` → "$10/Monat"), Guthaben-Faktor von der
    // Doku-Seite ("das Sechsfache dieses Betrags" → 6). Guthaben = Preis ×
    // Faktor. Fehlt eine der beiden Quellen → Fallback-Konstanten (Warnung,
    // kein Rot-Abbruch, damit ein Layout-Wechsel die Pipeline nicht bricht).
    const landingPricing = parseMonthlyPricing(landing$);
    const docsPricing = parseMonthlyPricing(docs$);
    const monthlyCost = landingPricing.monthlyCost ?? docsPricing.monthlyCost;
    const creditFactor = docsPricing.creditFactor ?? landingPricing.creditFactor;
    const pricingFallback = monthlyCost === null || creditFactor === null;
    let monthlyCredit;
    let monthlyCostFinal;
    if (pricingFallback) {
      console.error(
        `[scrape] Warnung: Monatsguthaben/-preis nicht extrahierbar (Monatspreis=${monthlyCost}, Faktor=${creditFactor}); nutze Konstanten ${DEFAULT_MONTHLY_CREDIT}/${DEFAULT_MONTHLY_COST}.`
      );
      monthlyCredit = DEFAULT_MONTHLY_CREDIT;
      monthlyCostFinal = DEFAULT_MONTHLY_COST;
    } else {
      monthlyCredit = monthlyCost * creditFactor;
      monthlyCostFinal = monthlyCost;
    }
    // Effektivpreise auf Basis des (möglicherweise geänderten) Monatsguthabens
    // neu berechnen — nutzt die bereits bonus-bereinigten usage-Werte.
    for (const m of models) recomputeUsageDerived(m, monthlyCredit);

    const { providers: mdProviders, models: mdModels, source: mdSource } = await loadModelsDev();
    // Reihenfolge: opencode (Zen) → kanonische Metadaten → opencode-go (nur
    // Lückenfüller; die Go-Einträge sind teils weniger gepflegt, z. B. fehlende
    // Modalitäten bei qwen3.8-max/mimo-v2-omni).
    const zenModels = mdProviders.opencode?.models ?? {};
    const goModels = mdProviders["opencode-go"]?.models ?? {};
    enrichCapabilities(models, zenModels, mdModels, goModels);

    const fetchedAt = new Date().toISOString();
    const date = fetchedAt.slice(0, 10);
    // git-tag-sicheres `id` (kein `:`), z.B. 2026-08-19T06-00-00Z
    const runId = fetchedAt.replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");

    const prevPath = join(ROOT, "data", "latest.json");
    const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;
    const prevModels = prev && Array.isArray(prev.models) ? prev.models : null;
    const prevFree = prev && Array.isArray(prev.freeModels) ? prev.freeModels : [];
    const currentIds = await fetchZenFreeModels(prevFree.map((f) => f.id));
    const freeModels = enrichFreeModels(
      mergeFreeModels(prevFree, currentIds, date),
      zenModels,
      mdModels,
      goModels
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
      // Auch kostenlose Modelle erfassen: deren Fähigkeiten werden oft
      // verzögert (models.dev) nachgeliefert — für die 24h-Unterdrückung der
      // capabilities_changed-Events muss das Erstbeobachtungsdatum herhalten.
      for (const f of snap.freeModels ?? []) {
        if (!firstSeen.has(f.id)) firstSeen.set(f.id, day);
      }
    }

    const latest = {
      fetchedAt,
      sourceUrl: SOURCE_URL,
      freeModelsSourceUrl: ZEN_DOCS_URL,
      capabilitiesSourceUrl: MODELS_DEV_URL,
      sourceLang: SOURCE_LANG,
      monthlyCredit,
      monthlyCost: monthlyCostFinal,
      peakHours,
      models,
      freeModels,
    };

    const changes = buildChanges(prevModels, models, prevFree, freeModels, date, firstSeen);

    // Stille, strukturelle privacy-Änderungen (Feld erstmals befüllt oder
    // Familien-Fallback): Daten-Dateien schreiben, aber KEINE Changelog-Events.
    const prevPrivacy = new Map([
      ...(prev?.models ?? []).map((m) => [modelKey(m), m.privacy]),
      ...(Array.isArray(prev?.freeModels) ? prev.freeModels : []).map((f) => [f.id, f.privacy]),
    ]);
    const privacyPopulated =
      prev !== null &&
      [...models.map((m) => [modelKey(m), m.privacy]), ...freeModels.map((f) => [f.id, f.privacy])].some(
        ([key, p]) => p !== null && prevPrivacy.get(key) == null
      );

    // Reine validUntil-Änderung (Stufe unverändert, z. B. ZDR-Verlängerung):
    // Daten-Dateien schreiben, aber KEINE Changelog-Events.
    const privacySilentUpdate =
      prev !== null &&
      [...models.map((m) => [modelKey(m), m.privacy]), ...freeModels.map((f) => [f.id, f.privacy])].some(
        ([key, p]) => {
          const before = prevPrivacy.get(key);
          return p !== null && before != null && privacyStatusEqual(before, p) && !privacyEqual(before, p);
        }
      );

    // Monatsguthaben/-preis haben sich geändert (dynamisch gefetchte Werte):
    // Daten-Dateien schreiben, aber KEINE Changelog-Events — die Werte sind die
    // globale Preisbasis (kein Modell-Event), die UI liest sie aus latest.json.
    const monthlyPricingChanged =
      prev !== null && (prev.monthlyCredit !== monthlyCredit || prev.monthlyCost !== monthlyCostFinal);

    // Modell-IDs befüllt/geändert (`opencode(-go)/<id>` für die UI):
    // Daten-Dateien schreiben, aber KEINE Changelog-Events — reine Anreicherung.
    const prevIds = new Map((prev?.models ?? []).map((m) => [modelKey(m), m.id ?? null]));
    const modelIdsPopulated =
      prev !== null &&
      models.some((m) => {
        const before = prevIds.get(modelKey(m)) ?? null;
        return (m.id ?? null) !== before; // null↔Wert oder Wert↔Wert (Präfix-Änderung)
      });

    // Kontextfenster (contextWindow) befüllt/geändert: Daten-Dateien schreiben,
    // aber KEINE Changelog-Events — reine Anreicherung. Erstbefüllung (vorheriger
    // Lauf hatte null/fehlend, jetzt ein Wert) zählt als Änderung.
    const prevCtx = new Map([
      ...(prev?.models ?? []).map((m) => [modelKey(m), m.contextWindow ?? null]),
      ...(Array.isArray(prev?.freeModels) ? prev.freeModels : []).map((f) => [f.id, f.contextWindow ?? null]),
    ]);
    const contextWindowPopulated =
      prev !== null &&
      [...models.map((m) => [modelKey(m), m.contextWindow ?? null]), ...freeModels.map((f) => [f.id, f.contextWindow ?? null])].some(
        ([key, cw]) => cw !== (prevCtx.get(key) ?? null)
      );

    // Hersteller/Provider (provider) befüllt/geändert: Daten-Dateien schreiben,
    // aber KEINE Changelog-Events — reine Anreicherung. Erstbefüllung (vorheriger
    // Lauf hatte null/fehlend, jetzt ein Wert) zählt als Änderung.
    const prevProv = new Map([
      ...(prev?.models ?? []).map((m) => [modelKey(m), m.provider ?? null]),
      ...(Array.isArray(prev?.freeModels) ? prev.freeModels : []).map((f) => [f.id, f.provider ?? null]),
    ]);
    const providerPopulated =
      prev !== null &&
      [...models.map((m) => [modelKey(m), m.provider ?? null]), ...freeModels.map((f) => [f.id, f.provider ?? null])].some(
        ([key, p]) => p !== (prevProv.get(key) ?? null)
      );

    validateSnapshot(latest);

    const changelogPath = join(ROOT, "CHANGELOG.json");
    const existingChangelog = existsSync(changelogPath)
      ? normalizeChangelogIds(JSON.parse(readFileSync(changelogPath, "utf8")))
      : { entries: [] };
    const changelog = upsertChangelogJson(existingChangelog, runId, date, changes);
    validateChangelog(changelog);
    const changelogJson = JSON.stringify(changelog) + "\n";
    writeFileSync(changelogPath, changelogJson);
    mkdirSync(join(ROOT, "src", "data"), { recursive: true });
    writeFileSync(join(ROOT, "src", "data", "changelog.json"), changelogJson);

    if (changes.length > 0 || privacyPopulated || privacySilentUpdate || monthlyPricingChanged || modelIdsPopulated || contextWindowPopulated || providerPopulated) {
      history.snapshots.push(latest);
      writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
      writeFileSync(prevPath, JSON.stringify(latest, null, 2) + "\n");
    }

    const enriched = models.filter((m) => m.capabilities !== null).length;
    const enrichedFree = freeModels.filter((f) => f.capabilities !== null).length;
    const privacyCovered = models.filter((m) => m.privacy !== null).length;
    console.log(`Gescrapt: ${models.length} Modelle, ${freeModels.length} kostenlose Modelle (Zen), ${changes.length} Änderungen (Snapshot ${date}); Monatsguthaben $${monthlyCredit} / Monatspreis $${monthlyCostFinal} (${pricingFallback ? "Fallback 60/10" : "dynamisch"})${monthlyPricingChanged ? " (still aktualisiert)" : ""}; Nutzungs-Boni: ${bonusLabels || "keine"}; Fähigkeiten (models.dev: ${mdSource}) für ${enriched} Modelle + ${enrichedFree} Zen-Modelle; Datenschutz für ${privacyCovered}/${models.length} Modelle${privacyPopulated ? " (privacy still befüllt, keine Events)" : ""}${privacySilentUpdate ? " (validUntil still aktualisiert, keine Events)" : ""}${modelIdsPopulated ? " (Modell-IDs still befüllt, keine Events)" : ""}${contextWindowPopulated ? " (Kontextfenster still befüllt, keine Events)" : ""}${providerPopulated ? " (Hersteller still befüllt, keine Events)" : ""}.`);
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
