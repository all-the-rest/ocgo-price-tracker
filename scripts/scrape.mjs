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
// Quelle der kostenlosen Zen-Modelle: die Zen-Doku. Unter „Endpunkte“ stehen die
// Model-IDs, unter „Preise“ die kostenlosen („Free“) Zeilen — das ist die
// autoritative Liste der gratis Modelle (ersetzt die alte zen/v1/models-API).
const ZEN_DOCS_URL = "https://opencode.ai/docs/de/zen/";
const MODELS_DEV_URL = "https://models.dev";
const SOURCE_LANG = "de";
const FLOAT_TOLERANCE = 1e-9;
const USER_AGENT =
  "ocgo-price-tracker/0.1.0 (+https://github.com/all-the-rest/ocgo-price-tracker)";

export class ScrapeError extends Error {}

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
  "glm-flash": "Z.ai",
  "gpt-luna": "OpenAI",
  grok: "xAI",
  "hy3-free": "Tencent",
  "kimi-k2": "Moonshot AI",
  "kimi-k3": "Moonshot AI",
  // models.dev kennt die LongCat-Modelle nur unter der Familie/Provider-ID
  // "longcat"; der Hersteller ist Meituan (vgl. `longcat` in der
  // Hersteller-Zuordnung von opencode-usage). Ohne diesen Eintrag landet
  // "Longcat" (Titel-Schreibweise) statt "Meituan" in der Anzeige.
  longcat: "Meituan",
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
  muse: "Meta",
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
 * Stealth-Modelle (OpenCode-eigene Tarn-IDs, Lab unbekannt) — analog
 * STEALTH_MANUFACTURER ("OpenCode Stealth") in opencode-usage
 * (src/lib/manual-manufacturers.ts). Bare opencode-IDs (ohne
 * `opencode(-go)/`-Prefix); greifen in enrichCapabilities/enrichFreeModels mit
 * VORRANG vor der models.dev-Ableitung. Bei enthüllter Identität (vgl.
 * ox-alpha → Z.ai) hier austragen, dann greift wieder models.dev.
 */
const STEALTH_PROVIDER = "OpenCode Stealth";
const STEALTH_IDS = new Set([
  "big-pickle", // Stealth-Modell, Lab unbekannt
  // Die Zen-Doku nennt Space Bunny Free ausdrücklich „ein Stealth-Modell, das
  // für begrenzte Zeit kostenlos auf OpenCode verfügbar ist"; models.dev führt
  // es ohne Hersteller, daher wäre die Ableitung `null`.
  "space-bunny-free",
  "union-alpha", // Stealth-Modell, Lab unbekannt
]);

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
  // Englisch „Free“ / deutsch „Kostenlos“ → gratis ist ein bekannter Preis (0).
  const lower = t.toLowerCase();
  if (lower === "free" || lower === "kostenlos") return 0;
  const cleaned = t.replace(/[\$,\s]/g, "");
  const value = parseFloat(cleaned);
  if (Number.isNaN(value)) throw new ScrapeError(`Preis unparsebar: "${text}"`);
  return value;
}

/**
 * Parst die Nutzung-Spalte. "-", "Unbegrenzt" oder "Unlimited" (kein
 * Nutzungslimit bei kostenlosen Modellen) → null; sonst `$15` → 15.
 *
 * Seit 2026-09 zeigt die Doku Boni inline in der Zelle:
 * `<del>$15</del> <strong>$60</strong><br><small>4x · Endet am 20. Sept.</small>`
 * (durchgestrichener Basiswert + aktueller Wert + Bonus-Notiz). Daher wird die
 * Bonus-Notiz (`Nx · Endet …`) vor dem Parsen entfernt und bei mehreren
 * $-Beträgen der letzte (= aktuelle Wert) genommen.
 */
function parseUsage(text) {
  const t = (text ?? "").trim();
  if (t === "" || t === "-" || t === "—" || t === "–") return null;
  if (/^(unbegrenzt|unlimited)$/i.test(t)) return null;
  const withoutNote = t
    .replace(/\d+\s*[x×]\s*·.*$/, "")
    .trim();
  const amounts = [...withoutNote.matchAll(/\$(\d+(?:[.,]\d+)?)/g)];
  if (amounts.length > 0) {
    const value = Number(amounts[amounts.length - 1][1].replace(",", "."));
    if (Number.isFinite(value)) return value;
  }
  const cleaned = withoutNote.replace(/[\$,\s]/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new ScrapeError(`Nutzung unparsebar: "${text}"`);
  return value;
}

/**
 * Parst eine Nutzungs-Tabellenzelle anhand ihres HTML: ein `<strong>`-Wert
 * (aktueller Wert bei durchgestrichenem Basiswert in `<del>`) gewinnt, sonst
 * wird der Text ohne `<small>`-Bonus-Notiz geparst.
 */
function parseUsageCell($cell) {
  if (!$cell || $cell.length === 0) throw new ScrapeError("Nutzungs-Zelle fehlt");
  const strong = $cell.find("strong").first();
  if (strong.length > 0) return parseUsage(strong.text());
  const clone = $cell.clone();
  clone.find("small").remove();
  return parseUsage(clone.text());
}

/**
 * Header-Zellen einer Tabelle (klein geschrieben, getrimmt).
 */
function tableHeaders($, table) {
  return $(table)
    .find("thead th")
    .map((_, th) => $(th).text().trim().toLowerCase())
    .get();
}

// Spalten-Aliase (Deutsch UND Englisch): die Doku ist teilweise übersetzt, die
// englische Seite https://opencode.ai/docs/go/ hat dieselbe Struktur.
const HEADER_ALIASES = {
  name: ["model", "modell"],
  input: ["input", "eingabe"],
  output: ["output", "ausgabe"],
  cachedRead: ["cached read", "cache-lesevorgang", "cache lesevorgang"],
  cachedWrite: ["cached write", "cache-schreibvorgang", "cache schreibvorgang"],
  usage: ["nutzung", "usage", "monatliches limit", "monthly limit", "limit"],
};

const headerMatches = (header, aliases) => aliases.some((a) => header.includes(a));
const isNameHeader = (header) => HEADER_ALIASES.name.includes(header);

/**
 * Erkennt eine Preistabelle über die Header-Zeile (Input/Eingabe UND
 * Output/Ausgabe) — NICHT über nth-child-Selektoren. Rate-Limit-Tabellen
 * („Anfragen pro …“) matchen so nicht.
 */
function isPriceTable($, table) {
  const headers = tableHeaders($, table);
  return (
    headers.some((h) => headerMatches(h, HEADER_ALIASES.input)) &&
    headers.some((h) => headerMatches(h, HEADER_ALIASES.output))
  );
}

function findPriceTables($) {
  const matches = [];
  $("main table").each((_, table) => {
    if (isPriceTable($, table)) matches.push(table);
  });
  return matches;
}

function findPriceTable($) {
  const matches = findPriceTables($);
  if (matches.length === 0) {
    throw new ScrapeError(
      "keine Preistabelle gefunden (Header-Zellen mit 'Input/Eingabe' UND 'Output/Ausgabe' fehlen)"
    );
  }
  return matches[0];
}

function mapColumns($, table) {
  const headers = tableHeaders($, table);

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
    name: find(isNameHeader, "Model/Modell"),
    input: find((h) => headerMatches(h, HEADER_ALIASES.input), "Input/Eingabe"),
    output: find((h) => headerMatches(h, HEADER_ALIASES.output), "Output/Ausgabe"),
    cachedRead: find((h) => headerMatches(h, HEADER_ALIASES.cachedRead), "Cached Read/Cache-Lesevorgang"),
    cachedWrite: find((h) => headerMatches(h, HEADER_ALIASES.cachedWrite), "Cached Write/Cache-Schreibvorgang"),
    usage: find((h) => headerMatches(h, HEADER_ALIASES.usage), "Nutzung/Usage/Limit/Monatliches Limit"),
  };
}

/** Normalisiert ein Tab-Label (Plan-Anzeigename) zur Plan-Id. */
export function planIdFromLabel(label) {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/**
 * Erkennt die Plan-Tabelle (Abonnement/Plan + Preis/Price) und liefert die
 * Pläne in Dokument-Reihenfolge. `creditsMonthly` wird später aus der
 * höchsten endlichen Nutzung des jeweiligen Plans befüllt.
 */
export function parsePlanTable($) {
  const tables = [];
  $("main table").each((_, table) => {
    const headers = tableHeaders($, table);
    if (
      headers.some((h) => h === "abonnement" || h === "plan") &&
      headers.some((h) => h === "preis" || h === "price")
    ) {
      tables.push(table);
    }
  });
  if (tables.length === 0) {
    throw new ScrapeError(
      "keine Plan-Tabelle gefunden (Header-Zellen mit 'Abonnement/Plan' UND 'Preis/Price' fehlen)"
    );
  }
  if (tables.length > 1) {
    throw new ScrapeError(`${tables.length} Plan-Tabellen gefunden, erwartet wird genau eine`);
  }
  const table = tables[0];
  const headers = tableHeaders($, table);
  const nameIdx = headers.findIndex((h) => h === "abonnement" || h === "plan");
  const priceIdx = headers.findIndex((h) => h === "preis" || h === "price");

  const plans = [];
  $(table)
    .find("tbody tr, > tr")
    .each((_, row) => {
      const cells = $(row)
        .find("th, td")
        .map((_, c) => $(c).text().trim())
        .get();
      const first = (cells[0] ?? "").trim().toLowerCase();
      if (first === "abonnement" || first === "plan") return;
      if (cells.length === 0 || !cells[nameIdx]) return;
      const name = cells[nameIdx];
      plans.push({
        id: planIdFromLabel(name),
        name,
        priceMonthly: parsePlanPrice(cells[priceIdx]),
      });
    });
  if (plans.length === 0) throw new ScrapeError("Plan-Tabelle ohne Zeilen");
  return plans;
}

/** Parst einen Planpreis aus der Plan-Tabelle (`$10/Monat` → 10). */
export function parsePlanPrice(text) {
  const t = (text ?? "").trim();
  const m = t.match(/(?:\$\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:\$|€|USD))/i);
  if (!m) throw new ScrapeError(`Planpreis unparsebar: "${text}"`);
  return Number((m[1] ?? m[2]).replace(",", "."));
}

/**
 * Ordnet jedem Plan seine Preistabelle zu — über ARIA (Tab-Panel `aria-labelledby`
 * → Tab `id` innerhalb desselben `starlight-tabs`), NICHT über Position.
 * Panels ohne Preistabelle (z. B. Rate-Limit-Tabellen eines zweiten
 * `starlight-tabs`) werden übersprungen. Jede Verletzung der Panel-/Tab-/Plan-
 * Struktur bricht den Lauf rot ab (lieber CI rot als falsche Anzeige).
 */
export function extractPlanTableMap($, plans) {
  const known = new Map(plans.map((p) => [p.id, p]));
  const planTables = new Map();
  const panels = $("[role=tabpanel]");

  panels.each((_, panel) => {
    const $panel = $(panel);
    const tables = $panel.find("table").filter((_, t) => isPriceTable($, t));
    if (tables.length === 0) return; // kein Preis-Panel (z. B. Rate-Limits)
    if (tables.length > 1) {
      throw new ScrapeError("mehr als eine Preistabelle in einem Tab-Panel");
    }
    const labelledBy = $panel.attr("aria-labelledby");
    if (!labelledBy) {
      throw new ScrapeError("Preis-Tab-Panel ohne aria-labelledby (Plan-Label fehlt)");
    }
    const scope = $panel.closest("starlight-tabs");
    const searchRoot = scope.length ? scope : $panel.parent();
    const tab = searchRoot
      .find('[role="tab"]')
      .filter((_, t) => $(t).attr("id") === labelledBy)
      .first();
    if (tab.length === 0) {
      throw new ScrapeError(`Preis-Tab-Panel "${labelledBy}" hat keinen passenden Tab`);
    }
    const label = tab.text().trim();
    const planId = planIdFromLabel(label);
    if (!known.has(planId)) {
      throw new ScrapeError(
        `Tab-Label "${label}" lässt sich keinem Plan aus der Plan-Tabelle zuordnen (erwartet: ${[...known.keys()].join(", ")})`
      );
    }
    if (planTables.has(planId)) {
      throw new ScrapeError(`zwei Preistabellen für denselben Plan "${planId}"`);
    }
    planTables.set(planId, tables[0]);

    // Kein Tab ohne Panel: jeder Tab desselben Blocks muss ein Panel haben.
    const tabIds = searchRoot
      .find('[role="tab"]')
      .map((_, t) => $(t).attr("id"))
      .get();
    for (const id of tabIds) {
      if (!id) throw new ScrapeError("Tab ohne id im Preis-Tab-Block");
      const hasPanel = searchRoot
        .find('[role="tabpanel"]')
        .filter((_, p) => $(p).attr("aria-labelledby") === id).length > 0;
      if (!hasPanel) throw new ScrapeError(`Tab "${id}" hat kein zugehöriges Panel`);
    }
  });

  if (planTables.size !== plans.length) {
    throw new ScrapeError(
      `Anzahl Preistabellen (${planTables.size}) ≠ Anzahl Pläne (${plans.length})`
    );
  }
  return planTables;
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
 * Kanonische Anzeige-Schreibweisen für Modelle, deren Name in der Doku
 * zwischen Varianten schwankt (z. B. "MiMo-V2.5" mit Bindestrich vs.
 * "MiMo V2.5" mit Leerzeichen). Schlüssel: normalisierter Name, Wert: die in
 * `data/latest.json` und im Changelog verwendete Schreibweise. Neue Varianten
 * hier ergänzen — das Diff matcht zusätzlich normalisiert (computeDiff), sodass
 * eine reine Umbenennung niemals als model_added/model_removed gebucht wird.
 */
const MODEL_NAME_ALIASES = {
  "mimov2.5": "MiMo V2.5",
  "mimov2.5pro": "MiMo V2.5 Pro",
  "mimov2.6flash": "MiMo V2.6 Flash",
  "mimov2.6pro": "MiMo V2.6 Pro",
};

/**
 * Normalisiert die Schreibweise eines Modellnamens auf die kanonische Form
 * (MODEL_NAME_ALIASES); unbekannte Namen bleiben unverändert.
 */
export function canonicalModelName(name) {
  return MODEL_NAME_ALIASES[normalizeName(name)] ?? name;
}

/**
 * Normalisiert einen kostenlosen Zen-Anzeigenamen ("MiMo-V2.6-Flash Free" →
 * "MiMo V2.6 Flash Free"); das " Free"-Suffix bleibt erhalten.
 */
export function canonicalFreeName(name) {
  const m = /^(.*?)\s+free$/i.exec((name ?? "").trim());
  if (!m) return canonicalModelName(name);
  return `${canonicalModelName(m[1])} Free`;
}

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
 * führt keine Datenschutz-Felder) — haben Vorrang vor der geparsten Quelle:
 * x-preview-f-free ist Ox Alpha Free (laut models.dev der Zen-Eintrag „Ox Alpha
 * Free (Unlimited)“) und hat wie das Doku-Modell ZDR.
 *
 * Die reguläre Quelle ist die Fußnoten-Liste „Die kostenlosen Modelle:“ der
 * Zen-Doku (`parseZenFreeModelPrivacy`); `training: true` ist nur der Fallback
 * für Modelle ganz ohne Datenschutz-Aussage in dieser Liste.
 */
const FREE_MODEL_PRIVACY_OVERRIDES = {
  "xpreviewffree": { training: false, retentionDays: true, validUntil: null },
};

/**
 * Liefert das nächste Geschwister-Element vom Typ `tagName` nach `start`
 * (z. B. die erste `<table>` nach einer Überschrift oder die `<ul>` nach einem
 * Absatz). Robust gegen dazwischenliegende Elemente; kein Treffer → leeres
 * Element.
 */
function elementAfter(start, tagName) {
  let el = start.next();
  while (el.length && !el.is(tagName)) el = el.next();
  return el;
}

/**
 * Liefert die erste `<table>` nach der Überschrift mit der gegebenen `id`
 * (z. B. `#endpunkte` oder `#preise`), oder ein leeres Element.
 */
function tableAfterHeading($, headingId) {
  return elementAfter($(`#${headingId}`), "table");
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
 * (Input-Spalte = „Free“ oder deutsch „Kostenlos“). Beide werden über den Modellnamen korreliert.
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
    if (input === "free" || input === "kostenlos") {
      const id = idsByName.get(normalizeName(name));
      if (id) free.push(id);
    }
  });
  return [...new Set(free)].sort();
}

/**
 * Parst die Datenschutz-Fußnoten der kostenlosen Zen-Modelle aus der Zen-Doku.
 * Maßgeblich ist die `<ul>` direkt nach dem Absatz „Die kostenlosen Modelle:“
 * im Preise-Abschnitt — NICHT die Go-Datenschutz-Tabelle (die Go-Doku kann für
 * ein Free-Modell abweichen). Pro `<li>` steht der Modellname am Satzanfang
 * („<Name> ist …“), der Rest ist die Aussage:
 *  - ZDR: „Zero-Retention“ + „nicht zum Trainieren“ →
 *    `{ training: false, retentionDays: true, validUntil: null }`
 *  - Modelltraining: „Feedback“/„zu verbessern“/„Verbesserung des Modells“/
 *    „zum Trainieren“/„Training“ → `{ training: true, validUntil: null }`
 *  - keine Datenschutz-Aussage → KEIN Eintrag (es gilt der Default „unbekannt“)
 * Namen werden über `normalizeName` gegen `idsByName` (aus
 * `parseZenEndpointIds`) aufgelöst; nur auflösbare Namen werden übernommen.
 * Fehlt der Absatz oder die Liste, ist das Ergebnis leer (kein Fehler — die
 * Zen-Seite darf umgebaut werden); eine nicht auflösbare Zeile bricht den Lauf
 * nicht ab, wird aber als Warnung geloggt.
 */
export function parseZenFreeModelPrivacy($, idsByName) {
  const privacyById = new Map();
  let list = null;
  $("p").each((_, p) => {
    if (list) return;
    if (/die kostenlosen modelle/i.test($(p).text())) list = elementAfter($(p), "ul");
  });
  if (!list || list.length === 0) return privacyById;

  list.find("li").each((_, li) => {
    const text = $(li)
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const sep = text.indexOf(" ist ");
    if (sep === -1) {
      console.error(`[scrape] Warnung: Zen-Fußnote ohne „ist“-Trenner (übersprungen): "${text}"`);
      return;
    }
    const name = text.slice(0, sep).trim();
    const statement = text.slice(sep + 5).trim();
    const id = idsByName.get(normalizeName(name));
    if (!id) {
      console.error(`[scrape] Warnung: Zen-Fußnote für unbekanntes Modell ignoriert: "${name}"`);
      return;
    }
    if (/zero[-\s]?retention/i.test(statement) && /nicht zum trainieren|nicht zum training/i.test(statement)) {
      privacyById.set(id, { training: false, retentionDays: true, validUntil: null });
    } else if (
      /feedback|zu verbessern|verbesserung des modells|zum trainieren|\btraining\b/i.test(statement)
    ) {
      privacyById.set(id, { training: true, validUntil: null });
    }
    // Ohne Datenschutz-Aussage: kein Eintrag (Default „unbekannt“).
  });

  return privacyById;
}

async function fetchZenFreeModels(previousFree) {
  try {
    const res = await fetch(ZEN_DOCS_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new ScrapeError(`HTTP ${res.status} bei ${ZEN_DOCS_URL}`);
    const html = await res.text();
    const idsByName = parseZenEndpointIds(html);
    return {
      ids: extractFreeModelsFromDocs(html),
      privacyById: parseZenFreeModelPrivacy(cheerio.load(html), idsByName),
    };
  } catch (err) {
    console.error(
      `[scrape] Warnung: Zen-Doku nicht erreichbar (${err instanceof Error ? err.message : String(err)}); behalte ${previousFree.length} bisherige Einträge.`
    );
    return { ids: previousFree, privacyById: new Map() };
  }
}

export function parsePatternNum(text) {
  const cleaned = (text ?? "").replace(/[\s$]/g, "");
  if (cleaned === "") throw new ScrapeError(`Anfragemuster-Wert unparsebar: "${text}"`);
  // Tausendertrennzeichen: die Doku schreibt Token-Zahlen in 3er-Gruppen, jetzt
  // mit Komma (`32,500` → 32500), früher mit Punkt (`1.100` → 1100). Ein echtes
  // Dezimaltrennzeichen (nicht 3-stelliger Nachkommateil) bleibt erhalten.
  const thousands = /^\d{1,3}(?:[.,]\d{3})+$/.test(cleaned);
  const normalized = thousands ? cleaned.replace(/[.,]/g, "") : cleaned.replace(/,/g, ".");
  const value = Number(normalized);
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
      /^(.+?)\s*[—–-]\s*([\d.,]+)\s*(?:Eingabe|Input)[-,]{0,2}\s*([\d.,]+)\s*(?:Cache|Cached)[-,]{0,2}\s*([\d.,]+)\s*(?:Ausgabe|Output)[-,]{0,2}\s*Tokens?\s*pro\s*Anfrage\s*$/i
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

function parseModel(cells, colMap, $usageCell = null) {
  const at = (idx) => {
    const cell = cells[idx];
    if (cell === undefined) throw new ScrapeError(`Zelle für Spaltenindex ${idx} fehlt`);
    return cell;
  };

  const { name: rawName, tier } = splitTier(at(colMap.name).trim());
  // Schreibweisen normalisieren ("MiMo-V2.5" → "MiMo V2.5"): reine
  // Bindestrich-/Leerzeichen-Varianten dürfen nie als add/remove diffen.
  const name = canonicalModelName(rawName);
  return {
    name,
    tier,
    input: parsePrice(at(colMap.input)),
    output: parsePrice(at(colMap.output)),
    cachedRead: parsePrice(at(colMap.cachedRead)),
    cachedWrite: parsePrice(at(colMap.cachedWrite)),
    usage: $usageCell ? parseUsageCell($usageCell) : parseUsage(at(colMap.usage)),
  };
}

function parseModels($, table, colMap) {
  const models = [];
  $(table)
    .find("tbody tr, > tr")
    .each((_, row) => {
      const $cells = $(row).find("th, td");
      const cells = $cells
        .map((_, c) => $(c).text().trim())
        .get();
      const first = (cells[0] ?? "").trim().toLowerCase();
      if (first === "model" || first === "modell") return;
      models.push(parseModel(cells, colMap, $cells.eq(colMap.usage)));
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
  // Fußnoten-Marker (z. B. „0 Tage*“) vor dem Parsen entfernen.
  const t = (text ?? "").trim().replace(/[*†‡¹²³]+$/u, "").trim();
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
 * ZDR-Vereinbarung der Modellfamilie DeepSeek: "gilt bis einschließlich
 * 31. August 2026") und liefert eine Map normalisierter Notiz-Labels →
 * validUntil (ISO).
 *
 * Das Label ist die Modellfamilie (z. B. `DeepSeek`) oder modellspezifisch
 * (z. B. `DeepSeek V4 Flash`); die Zuordnung auf die Modelle übernimmt
 * `validUntilFor`. Die Original-Labels hängen als `labels`-Map (normalisiert →
 * Anzeigeform) an der Rückgabe, damit `parseHtml` ungenutzte Notizen lesbar
 * melden kann.
 */
export function parsePrivacyNotes($) {
  const map = new Map();
  const labels = new Map();
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
    if (date) {
      const key = normalizeName(label);
      map.set(key, date);
      labels.set(key, label);
    }
  });
  map.labels = labels;
  return map;
}

/**
 * Prüft, ob ein Notiz-Label (normalisierter Key) auf einen Modell-Namen passt:
 * Exakt-Match (modellspezifisch) oder echter Familien-Präfix (das Label ist ein
 * kürzerer Präfix des Modell-Namens, z. B. Familie `DeepSeek` → `DeepSeek V4
 * Pro`).
 */
function validUntilKeyMatches(norm, key) {
  return norm === key || (key.length > 0 && key.length < norm.length && norm.startsWith(key));
}

/**
 * Ordnet einem Modell (normalisierter Name) das `validUntil`-Datum aus der
 * Notizen-Map zu:
 *  1. Exakt-Match (modellspezifisches Label, z. B. `DeepSeek V4 Flash`) gewinnt
 *     immer.
 *  2. Sonst Familien-Fallback: ein Notiz-Label, das ein echter Präfix des
 *     Modell-Namens ist (z. B. Familie `DeepSeek` → `DeepSeek V4 Pro`). Bei
 *     mehreren Treffern gewinnt der längste (spezifischste) Key.
 *  3. Kein Treffer → `null`.
 */
export function validUntilFor(norm, validUntilMap) {
  let best = null;
  let bestLen = -1;
  for (const [key, date] of validUntilMap) {
    if (!validUntilKeyMatches(norm, key)) continue;
    if (key.length > bestLen) {
      best = date;
      bestLen = key.length;
    }
  }
  return best;
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
 * Wochentags-Namen (deutsch + englisch, Lang- und Kurzform) → ISO-Wochentag
 * (1 = Montag … 7 = Sonntag). Nur auf `main p/li`-Notizen angewandt, daher
 * unkritisch gegenüber englischen Allerweltswörtern (Kurzformen matchen nur im
 * `X bis Y`-Bereich, nie allein).
 */
const WEEKDAY_LOOKUP = new Map(
  Object.entries({
    montag: 1, montags: 1, monday: 1, mondays: 1, mo: 1, mon: 1,
    dienstag: 2, dienstags: 2, tuesday: 2, tuesdays: 2, di: 2, tue: 2, tues: 2,
    mittwoch: 3, mittwochs: 3, wednesday: 3, wednesdays: 3, mi: 3, wed: 3,
    donnerstag: 4, donnerstags: 4, thursday: 4, thursdays: 4, do: 4, thu: 4, thur: 4,
    freitag: 5, freitags: 5, friday: 5, fridays: 5, fr: 5, fri: 5,
    samstag: 6, samstags: 6, saturday: 6, saturdays: 6, sa: 6, sat: 6,
    sonntag: 7, sonntags: 7, sunday: 7, sundays: 7, so: 7, sun: 7,
  })
);

const MONTH_LOOKUP = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  januar: 1, februar: 2, märz: 3, maerz: 3, mai: 5, juni: 6, juli: 7,
  oktober: 10, dezember: 12,
};

/**
 * Wochentags-Scope der Peak-Regel (Spezifikation §3). Liefert die ISO-Tage
 * (1..7) oder `null`, wenn die Notiz keinen Scope nennt — der Aufrufer bricht
 * dann rot ab (kein stiller Fallback).
 */
export function parseWeekdayScope(text) {
  // Zuerst die bündigen Begriffe: sie sind eindeutiger als ein Bereich.
  if (/\bwerktags\b|\bwochentags\b|\bweekdays?\b|\bbusiness days?\b/.test(text)) return [1, 2, 3, 4, 5];
  if (/\btäglich\b|\bdaily\b|\bevery day\b/.test(text)) return [1, 2, 3, 4, 5, 6, 7];
  const t = text.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
  const rangePattern = /([a-zäöü]+)\s*(?:bis|to|through|thru|-|\/)\s*([a-zäöü]+)/g;
  for (const match of t.matchAll(rangePattern)) {
    const start = WEEKDAY_LOOKUP.get(match[1]);
    const end = WEEKDAY_LOOKUP.get(match[2]);
    if (start && end && start <= end) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
  }
  return null;
}

/**
 * Wochenend-Auszug (ganztägig Off-Peak) aus der Notiz → ISO-Tage oder `null`.
 * Die Tage sind eine Teilmenge des Off-Peak-Komplements von `peak.days`; der
 * Aufrufer prüft den Widerspruch.
 */
export function parseWeekendScope(text) {
  const t = text.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
  if (/\bwochenenden?\b|\bweekends?\b/.test(t)) return [6, 7];
  if (/\bsa\s*(?:-|\/|und|and|,)\s*so\b/.test(t)) return [6, 7];
  if (/\bsat\s*(?:-|\/|and|,)\s*sun\b/.test(t)) return [6, 7];
  if (/samstag\s*(?:und|and|,|-|\/)\s*sonntag/.test(t)) return [6, 7];
  if (/saturday\s*(?:and|,|-|\/)\s*sunday/.test(t)) return [6, 7];
  return null;
}

/**
 * Feiertags-Auszug aus der Notiz. Nennt die Quelle ein bestimmbares Land
 * (chinesische Feiertage) → `{ policy: "off-peak", calendar: "china" }`.
 * Eine allgemeine Feiertags-Aussage ohne Land → `ScrapeError` (nicht raten).
 * Keine Feiertags-Aussage → `null` (Feld wird weggelassen, §3).
 */
export function parseHolidays(text) {
  const t = text.toLowerCase();
  if (/chinesische[n]?\s+feiertag|chinese\s+(?:public\s+)?holiday/.test(t)) {
    return { policy: "off-peak", calendar: "china" };
  }
  if (/\bfeiertag|public\s+holiday|\bholiday/.test(t)) {
    throw new ScrapeError(`Feiertags-Aussage ohne bestimmbares Land: "${text}"`);
  }
  return null;
}

/** Offset (Minuten) der Zone `timeZone` zum Zeitpunkt `ts`. */
function zoneOffsetMinutes(ts, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map = {};
  for (const part of formatter.formatToParts(new Date(ts))) map[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second)
  );
  return Math.round((asUtc - ts) / 60_000);
}

/** ISO-8601 (mit Offset) für lokale Datum-/Zeitangaben in `timeZone`. */
function zonedDateTimeIso(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = zoneOffsetMinutes(guess - zoneOffsetMinutes(guess, timeZone) * 60_000, timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const p2 = (n) => String(n).padStart(2, "0");
  const p4 = (n) => String(n).padStart(4, "0");
  return `${p4(year)}-${p2(month)}-${p2(day)}T${p2(hour)}:${p2(minute)}:00${sign}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`;
}

/**
 * Optionales `effectiveFrom` aus der Notiz (Spezifikation §1). Nur wenn die
 * Quelle ein effektives Datum nennt — sonst wird das Feld weggelassen (nicht
 * erfunden). Unterstützt die englische DeepSeek-Formulierung
 * („Effective 00:00 (Beijing Time) on Sunday, August 23, 2026") und eine
 * deutsche Entsprechung.
 */
export function parseEffectiveFrom(text, timeZone) {
  const en = /effective\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(?:\(([^)]+)\))?\s*on\s+(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
  if (en) {
    const month = MONTH_LOOKUP[en[4].toLowerCase()];
    if (month) return zonedDateTimeIso(Number(en[6]), month, Number(en[5]), Number(en[1]), Number(en[2]), timeZone);
  }
  const de = /(\d{1,2}):(\d{2})\s*(?:Uhr\s*)?(?:\([^)]*\)\s*)?(?:ab dem|gültig ab(?: dem)?)\s+(\d{1,2})\.\s*([A-Za-zä]+)\s+(\d{4})/i.exec(text);
  if (de) {
    const month = MONTH_LOOKUP[de[5].toLowerCase()];
    if (month) return zonedDateTimeIso(Number(de[6]), month, Number(de[4]), Number(de[1]), Number(de[2]), timeZone);
  }
  return undefined;
}

/**
 * Wochentags-Zeitraum (IANA-Zone), in der ein Peak-Modell seine Regel
 * formuliert. Die OpenCode-Doku nennt die Zone nicht; DeepSeek formuliert sie
 * in Peking-Zeit (Spezifikation §1). Unbekannte Familien → `ScrapeError`
 * (lieber rot als eine geratene Zone).
 */
const PEAK_TIMEZONE_BY_FAMILY = { deepseek: "Asia/Shanghai" };

export function peakTimezoneFor(name) {
  const norm = normalizeName(name);
  for (const [family, timeZone] of Object.entries(PEAK_TIMEZONE_BY_FAMILY)) {
    if (norm.includes(family)) return timeZone;
  }
  throw new ScrapeError(`Kein Wochentags-Zeitraum (timezone) für Peak-Modell "${name}" bekannt`);
}

/**
 * Baut aus einer Peak-Notiz die komplette Regel (`peakRules`-Wert).
 * Pflicht-`ScrapeError`: fehlender Wochentags-Scope, widersprüchliche
 * Wochenend-Angabe, Feiertags-Aussage ohne Land, unparsebares Fenster.
 */
export function peakRuleFromNote(note, timeZone) {
  const windowsUtc = parsePeakRanges(note);
  const peakDays = parseWeekdayScope(note);
  if (!peakDays) throw new ScrapeError(`Peak-Notiz ohne Wochentags-Scope: "${note}"`);
  const offPeakDays = [1, 2, 3, 4, 5, 6, 7].filter((day) => !peakDays.includes(day));
  const weekendDays = parseWeekendScope(note);
  if (weekendDays && !weekendDays.every((day) => offPeakDays.includes(day))) {
    throw new ScrapeError(`Wochenend-Angabe widerspricht dem Peak-Wochentags-Scope: "${note}"`);
  }
  const rule = {
    timezone: timeZone,
    peak: { days: peakDays, windowsUtc },
    offPeak: { days: offPeakDays, allDay: true },
  };
  const effectiveFrom = parseEffectiveFrom(note, timeZone);
  if (effectiveFrom) rule.effectiveFrom = effectiveFrom;
  const holidays = parseHolidays(note);
  if (holidays) rule.holidays = holidays;
  return rule;
}

/**
 * Parst die datengetriebenen Peak-Regeln (`peakRules`) aus den Hinweisen unter
 * der Preistabelle. Es werden **alle** `main p`/`main li`-Notizen gesammelt, die
 * `peak`/`spitzenzeiten`/`stoßzeiten` UND `UTC` nennen. Jede Notiz muss einen
 * Wochentags-Scope nennen und mindestens ein Peak-Modell treffen; **jedes**
 * Peak-Modell braucht eine Regel — sonst `ScrapeError`.
 */
export function parsePeakRules($, models = []) {
  const peakModels = [...new Set(models.filter((m) => isPeakTier(m.tier)).map((m) => m.name))];
  if (peakModels.length === 0) return {};

  const peakNotes = $("main p, main li")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((text) => /\bpeak\b|spitzenzeiten|stoßzeiten/i.test(text) && /UTC\b/i.test(text));
  if (peakNotes.length === 0) {
    throw new ScrapeError("Peak-/Off-Peak-Modelle gefunden, aber kein UTC-Zeitfenster im Dokument");
  }

  const rules = new Map();
  for (const note of peakNotes) {
    const subject = normalizeName(note.split(":", 1)[0]);
    // Zuordnung bewusst konservativ: exakter Name im Subject ODER gemeinsamer
    // Modell-Präfix (z. B. "DeepSeek V4 Flash / Pro" → beide DeepSeek-Modelle).
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
      throw new ScrapeError(`Peak-Zeitfenster konnte keinem Modell zugeordnet werden: "${note}"`);
    }
    const timezones = new Set(matched.map((name) => peakTimezoneFor(name)));
    if (timezones.size > 1) {
      throw new ScrapeError(`Peak-Notiz betrifft mehrere Wochentags-Zeiträume: "${note}"`);
    }
    const rule = peakRuleFromNote(note, [...timezones][0]);
    for (const name of matched) {
      const norm = normalizeName(name);
      const existing = rules.get(norm);
      if (existing && JSON.stringify(existing) !== JSON.stringify(rule)) {
        throw new ScrapeError(`Widersprüchliche Peak-Regeln für "${name}"`);
      }
      rules.set(norm, rule);
    }
  }

  // Kern-Guard: kein Peak-Modell darf ohne dokumentierte Regel durchrutschen
  // (sonst würde es still als „immer Off-Peak" ohne Countdown angezeigt).
  const missing = peakModels.filter((name) => !rules.has(normalizeName(name)));
  if (missing.length > 0) {
    throw new ScrapeError(`Peak-Modelle ohne UTC-Zeitfenster: ${missing.join(", ")}`);
  }
  return Object.fromEntries(rules);
}

/**
 * Extrahiert die Uhrzeit-Fenster aus einem Peak-Notiz-Text. Ein unparsebares
 * Fenster (z. B. `99:00-04:00`) oder ein Text ganz ohne Fenster → `ScrapeError`.
 */
export function parsePeakRanges(text) {
  const ranges = [];
  const rangePattern = /(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/g;
  for (const match of text.matchAll(rangePattern)) {
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
    throw new ScrapeError(`Keine gültigen UTC-Peak-Zeitfenster gefunden: "${text}"`);
  }
  return ranges;
}

/**
 * Parst Pläne + Modelle aus einer OpenCode-Go-Dokumentationsseite. Die
 * Tokenpreise sind laut Doku in allen Plänen identisch: die Preise des ersten
 * Plans sind die Datenquelle, alle weiteren Tabellen werden dagegen geprüft
 * (Abweichung → ScrapeError). Pro Modell entsteht eine `usage`-Map Plan-Id →
 * Nutzung in $ (`null` = unbegrenzt). `creditsMonthly` je Plan = höchste
 * endliche Nutzung dieses Plans (das „volle Monatsguthaben“).
 */
function parsePageData($) {
  const plans = parsePlanTable($);
  const planTables = extractPlanTableMap($, plans);

  const rowsByPlan = new Map();
  for (const plan of plans) {
    const table = planTables.get(plan.id);
    rowsByPlan.set(plan.id, parseModels($, table, mapColumns($, table)));
  }

  const firstPlan = plans[0];
  const firstRows = rowsByPlan.get(firstPlan.id);
  if (firstRows.length === 0) throw new ScrapeError("keine Modelle aus der Preistabelle extrahiert");

  const keyOfModel = (m) => normalizeName(modelKey(m));
  const firstKeys = firstRows.map(keyOfModel);
  if (new Set(firstKeys).size !== firstKeys.length) {
    throw new ScrapeError(`doppelte Modellzeilen im ersten Plan "${firstPlan.id}"`);
  }

  // Kreuzprüfung: identische Modellmengen (inkl. Reihenfolge) und Tokenpreise
  // über alle Pläne hinweg.
  for (const plan of plans.slice(1)) {
    const rows = rowsByPlan.get(plan.id);
    const keys = rows.map(keyOfModel);
    const sameOrder = keys.length === firstKeys.length && keys.every((k, i) => k === firstKeys[i]);
    if (!sameOrder) {
      const missing = firstKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !firstKeys.includes(k));
      throw new ScrapeError(
        `Plan "${plan.id}" hat abweichende Modellzeilen zum ersten Plan` +
          (missing.length ? ` (fehlt: ${missing.join(", ")})` : "") +
          (extra.length ? ` (zusätzlich: ${extra.join(", ")})` : "") +
          (missing.length + extra.length === 0 ? " (Reihenfolge weicht ab)" : "")
      );
    }
    for (let i = 0; i < firstRows.length; i++) {
      for (const f of PRICE_FIELDS) {
        if (!near(firstRows[i][f], rows[i][f])) {
          throw new ScrapeError(
            `Tokenpreise weichen zwischen den Plänen ab: "${firstRows[i].name}" ${f} ` +
              `(${firstPlan.id}: ${firstRows[i][f]} vs. ${plan.id}: ${rows[i][f]})`
          );
        }
      }
    }
  }

  const models = firstRows.map((base, i) => {
    const usage = {};
    for (const plan of plans) usage[plan.id] = rowsByPlan.get(plan.id)[i].usage;
    const unlimited = Object.values(usage).every((u) => u === null);
    const m = {
      name: base.name,
      tier: base.tier,
      input: base.input,
      output: base.output,
      cachedRead: base.cachedRead,
      cachedWrite: base.cachedWrite,
      usage,
      pattern: null,
      capabilities: null,
    };
    // Kostenlose Zeile (Nutzung in keinem Plan limitiert): gratis ist ein
    // bekannter Preis → fehlende Preisangaben als 0 erfassen.
    if (unlimited) {
      m.input ??= 0;
      m.output ??= 0;
      m.cachedRead ??= 0;
      m.cachedWrite ??= 0;
    }
    return m;
  });

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
      validUntil: validUntilFor(norm, validUntilMap),
      ...(fallback ? { fallback: true } : {}),
    };
  }

  // Jede ZDR-Notiz muss auf mindestens ein Modell abbildbar sein (exakt oder
  // als Familien-Präfix). Eine Notiz ohne Modell ist entweder ein
  // Quell-Layoutwechsel oder ein neues Modell ohne Tabellenzeile — beides darf
  // nicht still untergehen.
  const modelNorms = models.map((m) => normalizeName(m.name));
  for (const key of validUntilMap.keys()) {
    if (!modelNorms.some((norm) => validUntilKeyMatches(norm, key))) {
      const label = validUntilMap.labels?.get(key) ?? key;
      throw new ScrapeError(
        `Datenschutz-Notiz "${label}" konnte keinem Modell zugeordnet werden (weder exakt noch als Familien-Präfix)`
      );
    }
  }

  // creditsMonthly = höchste endliche Nutzung des Plans (volles Monatsguthaben).
  for (const plan of plans) {
    const values = models.map((m) => m.usage[plan.id]).filter((v) => typeof v === "number");
    if (values.length === 0) {
      throw new ScrapeError(`Plan "${plan.id}" hat keine endliche Nutzung — creditsMonthly nicht bestimmbar`);
    }
    plan.creditsMonthly = Math.max(...values);
    plan.sourceUrl = SOURCE_URL;
  }

  return { plans, models };
}

/**
 * Extrahiert die Modelle aus dem HTML einer OpenCode-Go-Dokumentationsseite.
 * Wirft ScrapeError bei strukturellen Parsing-Fehlern.
 */
export function parseHtml(html) {
  const $ = cheerio.load(html);
  return parsePageData($).models;
}

/**
 * Extrahiert die Pläne (inkl. `creditsMonthly` = höchste endliche Nutzung des
 * Plans) aus dem HTML einer OpenCode-Go-Dokumentationsseite.
 */
export function parsePlans(html) {
  const $ = cheerio.load(html);
  return parsePageData($).plans;
}

export const modelKey = (model) => (model.tier ? `${model.name} (${model.tier})` : model.name);

/**
 * Normalisierter Modell-Key für stille Anreicherungs-Vergleiche in main():
 * reine Schreibvarianten ("MiMo-V2.5" vs. "MiMo V2.5") matchen, damit kein
 * Phantom-Update die Daten-Dateien schreibt (Changelog-Events verhindert
 * ohnehin der normalisierte Diff).
 */
export const normModelKey = (m) => normalizeName(modelKey(m));

/**
 * Liest die in der Doku-Tabelle eingepreisten Nutzungs-Boni (seit 2026-09 zeigt
 * die Nutzungs-Zelle `<del>$15</del> <strong>$60</strong><br>
 * <small>4x · Endet am 20. Sept.</small>`). Liefert eine Map normalisierter
 * Modellnamen → Doku-Bonus-Faktor. Reine Reporting-Hilfe (Bonus-Labels im
 * Run-Log) — die `usage`-Werte selbst liest parseHtml bereits als aktuelle
 * Werte, es wird nichts multipliziert.
 */
export function parseDocsUsageBonuses($) {
  const bonuses = new Map();
  for (const table of findPriceTables($)) {
    const colMap = mapColumns($, table);
    $(table)
      .find("tbody tr, > tr")
      .each((_, row) => {
        const $cells = $(row).find("th, td");
        if ($cells.length === 0) return;
        const first = ($cells.eq(colMap.name).text() ?? "").trim().toLowerCase();
        if (first === "model" || first === "modell") return;
        const $usage = $cells.eq(colMap.usage);
        if ($usage.length === 0) return;
        const smallText = $usage.find("small").text() ?? "";
        const m = smallText.match(/(\d+)\s*[x×]/);
        const factor = m ? Number(m[1]) : null;
        const hasBonusStructure = $usage.find("del").length > 0 && $usage.find("strong").length > 0;
        if (factor && factor > 1) {
          const { name } = splitTier($cells.eq(colMap.name).text().trim());
          if (name) bonuses.set(normalizeName(name), factor);
        } else if (hasBonusStructure) {
          const { name } = splitTier($cells.eq(colMap.name).text().trim());
          if (name) bonuses.set(normalizeName(name), 1);
        }
      });
  }
  return bonuses;
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
 * Prüft ob eine ZDR-Vereinbarung abgelaufen ist: `validUntil` (ISO
 * YYYY-MM-DD) < `today` (YYYY-MM-DD). "gilt bis einschließlich" → erst
 * `>` ist abgelaufen.
 */
export function isPrivacyExpired(validUntil, today) {
  if (!validUntil) return false;
  const vu = Date.parse(validUntil);
  const td = Date.parse(today);
  if (Number.isNaN(vu) || Number.isNaN(td)) return false;
  return td > vu;
}

/**
 * Wendet das Worst-Case-Szenario auf abgelaufene ZDR-Vereinbarungen an:
 * `training: true, retentionDays: false` (kein ZDR, Modelltraining).
 * `validUntil` bleibt aus Audit-Gründen erhalten.
 * Betrifft z. B. DeepSeek: monatlich erneuert, gilt bis 31. Aug →
 * am 1. Sept ohne neues Datum wird Worst-Case visualisiert und ein
 * `privacy_changed`-Event erzeugt.
 */
export function applyPrivacyExpiry(models, today) {
  if (!today) return models;
  for (const m of models) {
    if (!m.privacy || !m.privacy.validUntil) continue;
    if (!isPrivacyExpired(m.privacy.validUntil, today)) continue;
    const { fallback } = m.privacy;
    m.privacy = {
      training: true,
      retentionDays: false,
      validUntil: m.privacy.validUntil,
      ...(fallback ? { fallback: true } : {}),
    };
  }
  return models;
}

/**
 * Löscht transiente Expiry-Einträge automatisch, wenn die Vereinbarung
 * innerhalb von 2 Tagen nachgereicht wird.
 *
 * Szenario: 1. Sept Worst-Case (`good → worst` als privacy_changed),
 * 2./3. Sept Erneuerung (`worst → good`). Dann wird der Expiry-Eintrag
 * vom 1. Sept gelöscht und das Revert-Event unterdrückt — als wäre nie
 * etwas passiert (keine künstliche Volatilität im Changelog).
 *
 * Heuristik pro Modell: `prev: good→worst` status-invertiert zu `cur:
 * worst→good` (ohne validUntil verglichen) und Datum-Diff 1–2 Tage.
 * Betroffene `privacy_changed`-Events werden aus dem alten Eintrag und
 * aus `changes` entfernt; leere Einträge verschwinden ganz.
 */
export function pruneTransientExpiry(existing, changes, today) {
  if (!existing?.entries?.length || !changes?.length) return { existing, changes };
  const todayMs = Date.parse(today);
  if (Number.isNaN(todayMs)) return { existing, changes };
  // shallow copy
  let newEntries = existing.entries.map((e) => ({ ...e, changes: [...e.changes] }));
  let newChanges = [...changes];
  const curToRemove = new Set();
  const entryIdxToChangeIdxs = new Map();

  for (let ci = 0; ci < newChanges.length; ci++) {
    const cur = newChanges[ci];
    if (cur.type !== "privacy_changed") continue;
    for (let ei = 0; ei < newEntries.length; ei++) {
      const ent = newEntries[ei];
      const diffDays = Math.round((todayMs - Date.parse(ent.date)) / 86400000);
      if (!Number.isFinite(diffDays) || diffDays < 0 || diffDays > 2) continue;
      for (let pi = 0; pi < ent.changes.length; pi++) {
        const prev = ent.changes[pi];
        if (prev.type !== "privacy_changed" || prev.model !== cur.model) continue;
        if (privacyStatusEqual(prev.from, cur.to) && privacyStatusEqual(prev.to, cur.from)) {
          curToRemove.add(ci);
          if (!entryIdxToChangeIdxs.has(ei)) entryIdxToChangeIdxs.set(ei, new Set());
          entryIdxToChangeIdxs.get(ei).add(pi);
          break;
        }
      }
      if (curToRemove.has(ci)) break;
    }
  }

  if (entryIdxToChangeIdxs.size > 0) {
    const toDeleteEntries = new Set();
    for (const [ei, idxSet] of entryIdxToChangeIdxs.entries()) {
      const ent = newEntries[ei];
      const filtered = ent.changes.filter((_, i) => !idxSet.has(i));
      if (filtered.length === 0) toDeleteEntries.add(ei);
      else newEntries[ei] = { ...ent, changes: filtered };
    }
    newEntries = newEntries.filter((_, i) => !toDeleteEntries.has(i));
  }
  newChanges = newChanges.filter((_, i) => !curToRemove.has(i));
  return { existing: { entries: newEntries }, changes: newChanges };
}

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
    // Modell-ID für OpenCode (`opencode/<id>`), null wenn nicht im
    // opencode-Provider gelistet → UI zeigt die Zeile ohne ID an.
    m.id = resolveOpencodeId(m.name, m.name);
    // Hersteller/Provider aus models.dev (id-Prefix); Stealth-IDs mit Vorrang
    // ("OpenCode Stealth"), sonst null wenn nicht ableitbar.
    const bare = typeof m.id === "string" ? m.id.split("/").pop() : null;
    m.provider = bare && STEALTH_IDS.has(bare) ? STEALTH_PROVIDER : toProvider(md);
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
 * Standard-privacy: „unbekannt“ ⇒ Worst-Case `training: true` (die Zen-Doku
 * nennt für diese Modelle keine Datenschutz-Aussage; `retentionDays` bleibt
 * weg). Die reguläre Quelle ist die Fußnoten-Liste „Die kostenlosen Modelle:“
 * der Zen-Doku (über `parseZenFreeModelPrivacy` / `privacyById`) — sowohl ZDR
 * als auch Modelltraining werden von dort übernommen. Manuelle
 * `FREE_MODEL_PRIVACY_OVERRIDES` haben Vorrang.
 */
export function enrichFreeModels(
  freeModels,
  providerModels,
  metadataModels,
  goModels = {},
  privacyById = new Map()
) {
  const { resolve, resolveOpencodeId } = buildModelsDevLookup(providerModels, metadataModels, goModels);
  for (const f of freeModels) {
    const md = resolve(f.id, f.id);
    f.capabilities = toCapabilities(md);
    f.contextWindow = toContextWindow(md);
    // Stealth-IDs ("OpenCode Stealth") mit Vorrang vor models.dev.
    f.provider = STEALTH_IDS.has(f.id) ? STEALTH_PROVIDER : toProvider(md);
    // Volle Kopier-ID wie in der UI (`opencode/<id>`, ggf. `opencode-go/…`);
    // `id` bleibt der stabile Schlüssel (Merge, Changelog, Zen-Endpunkte).
    f.fullId = resolveOpencodeId(f.id, f.id) ?? `opencode/${f.id}`;
    const publicName = md?.name?.replace(/\s*\([^)]*\)\s*$/, "").trim();
    // Schreibweise normalisieren ("MiMo-V2.6-Flash Free" → "MiMo V2.6 Flash
    // Free"); Namensänderungen erzeugen ohnehin keine Changelog-Events.
    if (publicName) f.name = canonicalFreeName(publicName);
    // Priorität: manueller Override > geparste Zen-Fußnote (quelle ist die
    // „Die kostenlosen Modelle:“-Liste) > Default „unbekannt“ (Modelltraining).
    f.privacy =
      FREE_MODEL_PRIVACY_OVERRIDES[normalizeName(f.id)] ??
      privacyById.get(f.id) ??
      { training: true, validUntil: null };
  }
  return freeModels;
}

/**
 * Vergleicht die capabilities von vorherigem und aktuellem Lauf und liefert
 * Diffs im Stil der Pricing-Änderungen (undefined und null gelten als gleich).
 */
export function computeCapabilityDiff(prevModels, nextModels) {
  // Matching auf normalisiertem Key: reine Schreibvarianten ("MiMo-V2.5" vs.
  // "MiMo V2.5") matchen, statt als add/remove zu diffen. Event-Key ist die
  // bisherige Schreibweise (stabil).
  const prev = new Map(prevModels.map((m) => [normalizeName(modelKey(m)), m]));
  const diffs = [];
  for (const m of nextModels) {
    const before = prev.get(normalizeName(modelKey(m)));
    if (!before) continue;
    if (!capabilitiesEqual(before.capabilities, m.capabilities)) {
      diffs.push({ key: modelKey(before), from: before.capabilities ?? null, to: m.capabilities ?? null });
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
  // Matching auf normalisiertem Key (siehe computeCapabilityDiff).
  const prev = new Map(prevModels.map((m) => [normalizeName(modelKey(m)), m]));
  const diffs = [];
  for (const m of nextModels) {
    const before = prev.get(normalizeName(modelKey(m)));
    if (!before || before.privacy == null) continue;
    if (!privacyStatusEqual(before.privacy, m.privacy)) {
      diffs.push({ key: modelKey(before), from: before.privacy ?? null, to: m.privacy ?? null });
    }
  }
  return diffs;
}

const near = (a, b) =>
  (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) < FLOAT_TOLERANCE);

const PRICE_FIELDS = ["input", "output", "cachedRead", "cachedWrite"];

/**
 * Tiefen-Vergleich zweier `usage`-Maps (Plan-Id → Nutzung in $, `null` =
 * unbegrenzt). Gleiche Schlüsselmenge und gleiche Werte → gleich.
 */
export const usageMapsEqual = (a, b) => {
  const keysA = Object.keys(a ?? {});
  const keysB = Object.keys(b ?? {});
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.prototype.hasOwnProperty.call(b ?? {}, k) && a[k] === b[k]);
};

/**
 * Zerlegt eine Pricing-Änderung in getrennte Events: `price_changed` (mit den
 * geänderten Preisfeldern in `fields`) und EIN `usage_changed` pro Modell (nur
 * Nutzung) mit den tatsächlich geänderten Plänen im `plans`-Array
 * (`[{ plan, from, to }]`, Muster analog `allowance_changed` im
 * cc-price-tracker). Leeres `plans`-Array → kein Event. Preis- UND
 * Nutzungsänderung ergeben so getrennte Events; eine reine Nutzungsänderung
 * feuert NIE ein `price_changed`.
 */
export function splitChange({ key, from, to }) {
  const fields = PRICE_FIELDS.filter((f) => !near(from[f], to[f]));
  const events = [];
  if (fields.length > 0) {
    events.push({ type: "price_changed", model: key, from, to, fields });
  }
  const planIds = [...new Set([...Object.keys(from.usage ?? {}), ...Object.keys(to.usage ?? {})])];
  const plans = [];
  for (const plan of planIds) {
    const before = from.usage?.[plan] ?? null;
    const after = to.usage?.[plan] ?? null;
    if (before !== after) {
      plans.push({ plan, from: before, to: after });
    }
  }
  if (plans.length > 0) {
    events.push({ type: "usage_changed", model: key, plans });
  }
  return events;
}

const isUsageMap = (u) => typeof u === "object" && u !== null;

export const pricingOf = (model) => ({
  input: model.input,
  output: model.output,
  cachedRead: model.cachedRead,
  cachedWrite: model.cachedWrite,
  // Legacy-Snapshots trugen einen einzelnen Nutzungswert (vor der Plan-Map):
  // diesen als „go“-Nutzung behandeln, damit der Übergang keine Phantom-Events
  // (go: null → Wert) für unveränderte Modelle erzeugt.
  usage: isUsageMap(model.usage) ? { ...model.usage } : { go: model.usage ?? null },
});

/**
 * Vergleichs-Key für das Modell-Diff: eine "Off-Peak"-Stufe kollabiert auf den
 * reinen Modellnamen (die normale Nutzung), sodass sie mit dem bisherigen
 * ungestuften Modell desselben Namens verschmilzt.
 */
const diffKey = (m) => (isOffPeakTier(m.tier) ? m.name : modelKey(m));

/**
 * Normalisierter Vergleichs-Key: Bindestrich-/Leerzeichen-Varianten desselben
 * Modellnamens ("MiMo-V2.5" vs. "MiMo V2.5") matchen — eine reine Umbenennung
 * wird nie als model_added/model_removed gebucht.
 */
const normDiffKey = (m) => normalizeName(diffKey(m));

export function computeDiff(prevModels, nextModels) {
  const prev = new Map(prevModels.map((m) => [normDiffKey(m), m]));
  const next = new Map(nextModels.map((m) => [normDiffKey(m), m]));

  // Anzeige-Key für Events: bei Treffern die bisherige Schreibweise (stabil),
  // bei echten Neuzugängen/Abgängen die eigene.
  const displayKey = (k) => (prev.has(k) ? diffKey(prev.get(k)) : diffKey(next.get(k)));

  const added = [...next.keys()].filter((k) => !prev.has(k)).map(displayKey);
  const removed = [...prev.keys()].filter((k) => !next.has(k)).map(displayKey);

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
      usageMapsEqual(from.usage, to.usage);
    if (!same) changed.push({ key: displayKey(key), from, to });
  }

  return { added, removed, changed };
}

export function buildChanges(
  prevModels,
  nextModels,
  prevFree = [],
  nextFree = [],
  today = "",
  firstSeen = new Map(),
  // Pläne, die im vorherigen Snapshot noch fehlten (volle Plan-Objekte, damit
  // das `plan_added`-Event Name/Preis/Guthaben tragen kann). Leer = kein neuer
  // Plan in diesem Lauf.
  newPlans = []
) {
  // Nutzungsänderungen neuer Pläne werden unterdrückt: vor dem Plan gab es
  // nichts, was sich geändert haben könnte (ein `plan_added`-Event ist die
  // einzige Aussage). Änderungen bestehender Pläne im selben Lauf bleiben.
  const newPlanIds = new Set((Array.isArray(newPlans) ? newPlans : []).map((p) => p.id));
  const changes = [];

  // Neue Pläne stehen am Anfang: je Plan genau ein `plan_added` — die
  // Schlagzeile des Laufs. Das gilt auch für den allerersten Lauf (dann sind
  // alle Pläne neu); die Modell-Diffs darunter brauchen dagegen einen Vorgänger.
  // Die (informationsleeren) Nutzungsänderungen des neuen Plans werden im
  // `changed`-Loop weiter unten entfernt.
  for (const plan of Array.isArray(newPlans) ? newPlans : []) {
    changes.push({
      type: "plan_added",
      plan: plan.id,
      name: plan.name,
      priceMonthly: plan.priceMonthly,
      creditsMonthly: plan.creditsMonthly,
    });
  }

  if (prevModels === null) return changes;

  const { added, removed, changed } = computeDiff(prevModels, nextModels);
  // Lookup auf normalisiertem Key: der Event-Key ist die stabile
  // Anzeige-Schreibweise und kann von der jeweils anderen Seite abweichen.
  const nextById = new Map(nextModels.map((m) => [normalizeName(diffKey(m)), m]));
  const prevById = new Map((prevModels ?? []).map((m) => [normalizeName(diffKey(m)), m]));
  // firstSeen ist nach Anzeige-Namen geschlüsselt (Historie) — zusätzlich
  // normalisiert nachschlagen, damit ein Schreibwechsel weder `days` noch die
  // 72h-Unterdrückung verfälscht. Nicht-String-Keys (Legacy) überspringen.
  const firstSeenNorm = new Map(
    [...firstSeen].filter(([k]) => typeof k === "string").map(([k, v]) => [normalizeName(k), v])
  );
  const seenSince = (key) => firstSeen.get(key) ?? firstSeenNorm.get(normalizeName(key));

  for (const key of added) {
    const model = nextById.get(normalizeName(key));
    changes.push({ type: "model_added", model: key, pricing: model ? pricingOf(model) : null });
  }
  for (const key of removed) {
    const first = seenSince(key);
    const days = first ? Math.max(0, Math.round((Date.parse(today) - Date.parse(first)) / 86_400_000)) : 0;
    const prevModel = prevById.get(normalizeName(key));
    changes.push({
      type: "model_removed",
      model: key,
      days,
      pricing: prevModel ? pricingOf(prevModel) : null,
    });
  }
  for (const { key, from, to } of changed) {
    // Preis- und Nutzungsänderungen laufen getrennt: `price_changed` (Felder)
    // und EIN `usage_changed` mit dem `plans`-Array der geänderten Pläne.
    for (const event of splitChange({ key, from, to })) {
      if (event.type === "usage_changed" && newPlanIds.size > 0) {
        // Nur die Änderungen bestehender Pläne behalten; die eines neuen Plans
        // sind informationsleer (siehe oben). Bleibt nichts übrig, entfällt das
        // Event ganz.
        const plans = event.plans.filter((p) => !newPlanIds.has(p.plan));
        if (plans.length === 0) continue;
        changes.push(plans.length === event.plans.length ? event : { ...event, plans });
        continue;
      }
      changes.push(event);
    }
  }

  // Fähigkeiten-Änderungen werden unterdrückt, wenn das Modell selbst erst
  // innerhalb der letzten 72h hinzugefügt wurde (model_added/free_added): Bei
  // neuen Modellen werden die Fähigkeiten oft verzögert (models.dev)
  // nachgeliefert (teils erst ~30h später) — das ist keine echte
  // Quelländerung, sondern Erstbefüllung.
  // Analog zur stillen privacy-Erstbefüllung wird hier KEIN Event erzeugt.
  const todayMs = Number.isNaN(Date.parse(today)) ? null : Date.parse(today);
  const addedWithin72h = (key) => {
    if (todayMs == null) return false;
    const fs = seenSince(key);
    if (fs == null) return false;
    const diffDays = Math.round((todayMs - Date.parse(fs)) / 86_400_000);
    return diffDays >= 0 && diffDays <= 3;
  };

  for (const { key, from, to } of computeCapabilityDiff(prevModels, nextModels)) {
    if (addedWithin72h(key)) continue;
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
      // kein capabilities_changed-Event (siehe addedWithin72h oben).
      if (addedWithin72h(f.id)) continue;
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

// Plan-Id → Nutzung in $ (`null` = unbegrenzt / kostenlose Zeile).
const UsageMapSchema = z.record(z.string().min(1), z.number().positive().nullable());

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
    // Nutzung je Plan (Plan-Id → $, null = unbegrenzt/kostenlos)
    usage: UsageMapSchema,
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
    // Zeilen (Nutzung in jedem Plan null, Preise 0) dürfen ohne Muster durchgehen.
    const hasUsage = Object.values(m.usage).some((v) => v !== null);
    const hasPricing = hasUsage || [m.input, m.output, m.cachedRead].some((v) => v !== null && v > 0);
    if (hasPricing && m.pattern === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pattern"], message: "pattern fehlt (Preise vorhanden)" });
    }
  });

const FreeModelSchema = z
  .object({
    id: z.string().min(1),
    // volle Kopier-ID wie in der UI (`opencode/<id>` bzw. `opencode-go/…`)
    fullId: z.string().min(1),
    // optionaler Anzeigename (bei Alias-IDs wie x-preview-f-free = Ox Alpha Free)
    name: z.string().min(1).optional(),
    availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    capabilities: CapabilitiesSchema.nullable(),
    contextWindow: z.number().nullable(),
    provider: z.string().nullable().default(null),
    privacy: PrivacySchema,
  })
  // Invariante: Free-Modelle sind in ALLEN Plänen nutzbar und tragen KEINE
  // Plan-Dimension. Ein versehentlich ergänztes `usage`/`plan`/`allowances`
  // bricht den Lauf rot ab (strenges Objekt), statt still durchzurutschen.
  .strict();

const PlanSchema = z.object({
  // Plan-Id aus dem Tab-Label normalisiert ("Go" → "go", "Go Plus" → "go-plus")
  id: z.string().min(1),
  name: z.string().min(1),
  priceMonthly: z.number().positive(),
  creditsMonthly: z.number().positive(),
  sourceUrl: z.string().url(),
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IANA_TIMEZONES = new Set(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []
);

// ISO-Wochentage (1 = Montag … 7 = Sonntag), nicht leer.
const WeekdayListSchema = z.array(z.number().int().min(1).max(7)).min(1);

// UTC-Fenster: 0 ≤ start < end ≤ 24, aufsteigend, nicht überlappend, ≥ 1.
const PeakWindowsSchema = z
  .array(
    z
      .tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)])
      .refine(([start, end]) => start < end, "windowsUtc: start < end verletzt")
  )
  .min(1)
  .superRefine((windows, ctx) => {
    for (let i = 1; i < windows.length; i++) {
      if (windows[i][0] < windows[i - 1][1]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "windowsUtc: nicht aufsteigend oder überlappend",
        });
      }
    }
  });

/**
 * Peak-Regel (Spezifikation §1). Invarianten: `peak.days`/`offPeak.days`
 * nicht leer, keine Duplikate, disjunkt, zusammen {1..7}; `timezone` ein
 * gültiger IANA-Name. Die Kalender-Existenz (`holidays.calendar`) prüft der
 * Snapshot (er kennt `holidayCalendars`).
 */
const PeakRuleSchema = z
  .object({
    timezone: z
      .string()
      .min(1)
      .refine((tz) => IANA_TIMEZONES.has(tz) || tz === "UTC", "kein gültiger IANA-Zeitzonenname"),
    effectiveFrom: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "effectiveFrom ist kein gültiges ISO-Datum")
      .optional(),
    peak: z.object({ days: WeekdayListSchema, windowsUtc: PeakWindowsSchema }),
    offPeak: z.object({ days: WeekdayListSchema, allDay: z.literal(true) }),
    holidays: z.object({ policy: z.literal("off-peak"), calendar: z.string().min(1) }).optional(),
  })
  .superRefine((rule, ctx) => {
    const peakDays = rule.peak.days;
    const offDays = rule.offPeak.days;
    if (new Set(peakDays).size !== peakDays.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["peak", "days"], message: "peak.days enthält Duplikate" });
    }
    if (new Set(offDays).size !== offDays.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["offPeak", "days"], message: "offPeak.days enthält Duplikate" });
    }
    if (new Set([...peakDays, ...offDays]).size !== 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offPeak", "days"],
        message: "peak.days ∪ offPeak.days ≠ {1..7}",
      });
    }
    if (peakDays.some((day) => offDays.includes(day))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["offPeak", "days"], message: "peak.days ∩ offPeak.days ≠ ∅" });
    }
  });

// Feiertagskalender: streng aufsteigende ISO-Daten, alle ≤ coveredThrough.
const HolidayCalendarSchema = z
  .object({
    dates: z.array(z.string().regex(ISO_DATE_RE)).min(1),
    coveredThrough: z.string().regex(ISO_DATE_RE),
  })
  .superRefine((cal, ctx) => {
    for (let i = 0; i < cal.dates.length; i++) {
      if (i > 0 && cal.dates[i] <= cal.dates[i - 1]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dates", i], message: "dates muss streng aufsteigend sein" });
      }
      if (cal.dates[i] > cal.coveredThrough) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dates", i], message: "date liegt nach coveredThrough" });
      }
    }
  });

const SnapshotSchema = z
  .object({
    fetchedAt: z.string(),
    sourceUrl: z.string().url(),
    freeModelsSourceUrl: z.string().url(),
    capabilitiesSourceUrl: z.string().url(),
    sourceLang: z.string(),
    plans: z.array(PlanSchema).min(1),
    peakRules: z.record(z.string().min(1), PeakRuleSchema),
    // Optional: die OpenCode-Doku nennt keine Feiertage, deshalb wird der
    // Kalender bewusst NICHT befüllt (kein `chinese-days` im Datenpfad). Das
    // Feld bleibt im Schema, damit die Datenform die Quelle nicht verengt und
    // der Consumer tolerant bleibt.
    holidayCalendars: z.record(z.string().min(1), HolidayCalendarSchema).optional(),
    models: z.array(ModelSchema).min(1),
    freeModels: z.array(FreeModelSchema),
  })
  .superRefine((snapshot, ctx) => {
    // Invariante: Die `usage`-Map jedes Modells trägt die Nutzung für JEDEN
    // Plan — Schlüsselmenge == Plan-Ids. So kann kein Modell planlos werden
    // und kein Plan stillschweigend fehlen (die Datenquelle liefert für alle
    // Pläne identische Modellzeilen; parsePageData garantiert das bereits).
    const planIds = new Set(snapshot.plans.map((p) => p.id));
    snapshot.models.forEach((m, i) => {
      const keys = Object.keys(m.usage);
      const exact =
        keys.length === planIds.size && keys.every((k) => planIds.has(k));
      if (!exact) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["models", i, "usage"],
          message: `usage-Schlüssel (${keys.join(", ")}) ≠ Plan-Ids (${[...planIds].join(", ")})`,
        });
      }
    });
    // Invariante: holidays.calendar jeder Regel MUSS in holidayCalendars stehen.
    const calendarKeys = new Set(Object.keys(snapshot.holidayCalendars ?? {}));
    for (const [model, rule] of Object.entries(snapshot.peakRules)) {
      if (rule.holidays && !calendarKeys.has(rule.holidays.calendar)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["peakRules", model, "holidays", "calendar"],
          message: `Kalender "${rule.holidays.calendar}" fehlt in holidayCalendars`,
        });
      }
    }
  });

const PricingTypeSchema = z.object({
  input: z.number().nullable(),
  output: z.number().nullable(),
  cachedRead: z.number().nullable(),
  cachedWrite: z.number().nullable(),
  // Map Plan-Id → Nutzung (immer alle Pläne).
  usage: UsageMapSchema,
});

// Ein geänderter Plan innerhalb eines `usage_changed`-Events.
const UsagePlanChangeSchema = z.object({
  plan: z.string().min(1),
  from: z.number().positive().nullable(),
  to: z.number().positive().nullable(),
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
  z
    .object({
      type: z.literal("usage_changed"),
      model: z.string().min(1),
      // Ein Event pro Modell: alle tatsächlich geänderten Pläne in einem Array
      // (Muster wie `allowance_changed` im cc-price-tracker). `.strict()`:
      // die frühere Legacy-Form (plan/from/to) wird abgelehnt statt still
      // verschluckt.
      plans: z.array(UsagePlanChangeSchema).min(1),
    })
    .strict(),
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
  // Ein Abonnement ist neu hinzugekommen (Plan-Id, Anzeigename, Monatspreis,
  // enthaltene Nutzung). Genau EIN Event pro neuem Plan — die Schlagzeile des
  // Laufs; die Nutzung des neuen Plans wird nicht zusätzlich als
  // `usage_changed` gebucht (vor dem Plan gab es nichts, was sich geändert
  // haben könnte).
  z.object({
    type: z.literal("plan_added"),
    plan: z.string().min(1),
    name: z.string().min(1),
    priceMonthly: z.number().positive(),
    creditsMonthly: z.number().positive(),
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

/**
 * Strukturelle Abdeckungs-Invariante: die drei Kataloge, die diese Seite speist,
 * müssen nach einem Lauf befüllt sein. KEINE festen Zahlen — der Katalog wächst
 * und schrumpft an der Quelle, ein Pin wäre bei jeder legitimen Änderung rot.
 * Der Fehlerfall, den ein Pin sonst abfing, ist der stille Parser-Ausfall: eine
 * umgebaute Doku (Tabelle umbenannt, Überschrift entfernt) liefert 0 Zeilen, und
 * ohne diese Prüfung würde der Lauf einen leeren, schema-validen Snapshot
 * committen und die Seite leeren. Leere Kataloge sind nie korrekt.
 */
export function assertNonEmptyCatalog({ plans, models, freeModels }) {
  if (!Array.isArray(plans) || plans.length === 0) {
    throw new ScrapeError("Keine Pläne extrahiert — Doku umgebaut?");
  }
  if (!Array.isArray(models) || models.length === 0) {
    throw new ScrapeError("Keine Modelle extrahiert — Doku umgebaut?");
  }
  if (!Array.isArray(freeModels) || freeModels.length === 0) {
    throw new ScrapeError("Keine kostenlosen Zen-Modelle extrahiert — Doku umgebaut?");
  }
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
    // Pläne + Modelle: Tokenpreise aus dem ersten Plan, Nutzung je Plan als Map.
    const { plans, models } = parsePageData(docs$);
    const peakRules = parsePeakRules(docs$, models);
    const docsBonuses = parseDocsUsageBonuses(docs$);
    const bonusLabels = [...docsBonuses.entries()].map(([n, f]) => `${n}×${f}`).join(", ");

    const { providers: mdProviders, models: mdModels, source: mdSource } = await loadModelsDev();
    // Reihenfolge: opencode (Zen) → kanonische Metadaten → opencode-go (nur
    // Lückenfüller; die Go-Einträge sind teils weniger gepflegt, z. B. fehlende
    // Modalitäten bei qwen3.8-max/mimo-v2-omni).
    const zenModels = mdProviders.opencode?.models ?? {};
    const goModels = mdProviders["opencode-go"]?.models ?? {};
    enrichCapabilities(models, zenModels, mdModels, goModels);

    const fetchedAt = new Date().toISOString();
    const date = fetchedAt.slice(0, 10);
    // Kein Feiertagskalender: die OpenCode-Doku nennt keine Feiertage, und wir
    // erfinden keine (strikt quellenbindend) → `holidayCalendars` bleibt leer.
    // git-tag-sicheres `id` (kein `:`), z.B. 2026-08-19T06-00-00Z
    const runId = fetchedAt.replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");

    const prevPath = join(ROOT, "data", "latest.json");
    const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;
    const prevModels = prev && Array.isArray(prev.models) ? prev.models : null;
    const prevFree = prev && Array.isArray(prev.freeModels) ? prev.freeModels : [];
    const { ids: currentIds, privacyById } = await fetchZenFreeModels(prevFree.map((f) => f.id));
    const freeModels = enrichFreeModels(
      mergeFreeModels(prevFree, currentIds, date),
      zenModels,
      mdModels,
      goModels,
      privacyById
    );
    // Abdeckung, nicht Pin: leere Kataloge bedeuten einen stillen Parser-Ausfall.
    assertNonEmptyCatalog({ plans, models, freeModels });

    // Abgelaufene ZDR-Vereinbarungen → Worst-Case visualisieren.
    // DeepSeek: monatlich erneuert, gilt bis 31. Aug → am 1. Sept ohne
    // neues Datum wird training:true / Kein ZDR gezeigt und ein privacy_changed
    // erzeugt.
    applyPrivacyExpiry(models, date);
    applyPrivacyExpiry(freeModels, date);

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
      // verzögert (models.dev) nachgeliefert — für die 72h-Unterdrückung der
      // capabilities_changed-Events muss das Erstbeobachtungsdatum herhalten.
      // Legacy-Snapshots führen freie IDs als reine Strings (ohne Objekt).
      for (const f of snap.freeModels ?? []) {
        const fid = typeof f === "string" ? f : f?.id;
        if (fid && !firstSeen.has(fid)) firstSeen.set(fid, day);
      }
    }

    const latest = {
      fetchedAt,
      sourceUrl: SOURCE_URL,
      freeModelsSourceUrl: ZEN_DOCS_URL,
      capabilitiesSourceUrl: MODELS_DEV_URL,
      sourceLang: SOURCE_LANG,
      plans,
      peakRules,
      models,
      freeModels,
    };

    // Pläne, die im vorherigen Snapshot fehlten: allererster Lauf (prev null)
    // → alle Pläne neu; Alt-Snapshots ohne `plans` ebenfalls. Daraus entsteht
    // je Plan genau ein `plan_added`-Event (Schlagzeile), und die
    // Nutzungsänderungen des neuen Plans werden unterdrückt.
    const prevPlanIds = new Set((Array.isArray(prev?.plans) ? prev.plans : []).map((p) => p.id));
    const newPlans = plans.filter((p) => !prevPlanIds.has(p.id));

    const changes = buildChanges(prevModels, models, prevFree, freeModels, date, firstSeen, newPlans);

    // Stille, strukturelle privacy-Änderungen (Feld erstmals befüllt oder
    // Familien-Fallback): Daten-Dateien schreiben, aber KEINE Changelog-Events.
    const prevPrivacy = new Map([
      ...(prev?.models ?? []).map((m) => [normModelKey(m), m.privacy]),
      ...(Array.isArray(prev?.freeModels) ? prev.freeModels : []).map((f) => [f.id, f.privacy]),
    ]);
    const privacyPopulated =
      prev !== null &&
      [...models.map((m) => [normModelKey(m), m.privacy]), ...freeModels.map((f) => [f.id, f.privacy])].some(
        ([key, p]) => p !== null && prevPrivacy.get(key) == null
      );

    // Reine validUntil-Änderung (Stufe unverändert, z. B. ZDR-Verlängerung):
    // Daten-Dateien schreiben, aber KEINE Changelog-Events.
    const privacySilentUpdate =
      prev !== null &&
      [...models.map((m) => [normModelKey(m), m.privacy]), ...freeModels.map((f) => [f.id, f.privacy])].some(
        ([key, p]) => {
          const before = prevPrivacy.get(key);
          return p !== null && before != null && privacyStatusEqual(before, p) && !privacyEqual(before, p);
        }
      );

    // Die komplette `plans`-Liste (inkl. Reihenfolge) hat sich geändert:
    // Daten-Dateien schreiben, aber KEINE Changelog-Events — die Pläne sind die
    // globale Preisbasis (kein Modell-Event), die UI liest sie aus latest.json.
    const plansChanged = prev !== null && JSON.stringify(prev.plans ?? null) !== JSON.stringify(plans);

    // Peak-Regeln haben sich geändert (inkl. der einmaligen Schema-Migration
    // peakHours → peakRules): Daten-Dateien schreiben, aber KEINE
    // Changelog-Events/Releases — die Quelle (OpenCode-Doku) hat sich nicht
    // geändert, nur unsere Repräsentation.
    const peakRulesChanged =
      prev !== null &&
      (JSON.stringify(prev.peakRules ?? null) !== JSON.stringify(peakRules) ||
        // Wir schreiben keinen Feiertagskalender mehr; ein früherer Stand mit
        // `holidayCalendars` stößt die Bereinigung an.
        JSON.stringify(prev.holidayCalendars ?? null) !== "null");

    // Modell-IDs befüllt/geändert (`opencode(-go)/<id>` für die UI):
    // Daten-Dateien schreiben, aber KEINE Changelog-Events — reine Anreicherung.
    const prevIds = new Map((prev?.models ?? []).map((m) => [normModelKey(m), m.id ?? null]));
    const modelIdsPopulated =
      prev !== null &&
      models.some((m) => {
        const before = prevIds.get(normModelKey(m)) ?? null;
        return (m.id ?? null) !== before; // null↔Wert oder Wert↔Wert (Präfix-Änderung)
      });

    // Kontextfenster (contextWindow) befüllt/geändert: Daten-Dateien schreiben,
    // aber KEINE Changelog-Events — reine Anreicherung. Erstbefüllung (vorheriger
    // Lauf hatte null/fehlend, jetzt ein Wert) zählt als Änderung.
    const prevCtx = new Map([
      ...(prev?.models ?? []).map((m) => [normModelKey(m), m.contextWindow ?? null]),
      ...(Array.isArray(prev?.freeModels) ? prev.freeModels : []).map((f) => [f.id, f.contextWindow ?? null]),
    ]);
    const contextWindowPopulated =
      prev !== null &&
      [...models.map((m) => [normModelKey(m), m.contextWindow ?? null]), ...freeModels.map((f) => [f.id, f.contextWindow ?? null])].some(
        ([key, cw]) => cw !== (prevCtx.get(key) ?? null)
      );

    // Hersteller/Provider (provider) befüllt/geändert: Daten-Dateien schreiben,
    // aber KEINE Changelog-Events — reine Anreicherung. Erstbefüllung (vorheriger
    // Lauf hatte null/fehlend, jetzt ein Wert) zählt als Änderung.
    const prevProv = new Map([
      ...(prev?.models ?? []).map((m) => [normModelKey(m), m.provider ?? null]),
      ...(Array.isArray(prev?.freeModels) ? prev.freeModels : []).map((f) => [f.id, f.provider ?? null]),
    ]);
    const providerPopulated =
      prev !== null &&
      [...models.map((m) => [normModelKey(m), m.provider ?? null]), ...freeModels.map((f) => [f.id, f.provider ?? null])].some(
        ([key, p]) => p !== (prevProv.get(key) ?? null)
      );

    // Volle Kopier-ID der Free-Modelle (fullId, `opencode(-go)/<id>` für die
    // UI) befüllt/geändert: Daten-Dateien schreiben, aber KEINE
    // Changelog-Events — reine Anreicherung.
    const prevFullIds = new Map(
      (Array.isArray(prev?.freeModels) ? prev.freeModels : []).map((f) => [f.id, f.fullId ?? null])
    );
    const fullIdsPopulated =
      prev !== null && freeModels.some((f) => (f.fullId ?? null) !== (prevFullIds.get(f.id) ?? null));

    validateSnapshot(latest);

    const changelogPath = join(ROOT, "CHANGELOG.json");
    const existingChangelogRaw = existsSync(changelogPath)
      ? normalizeChangelogIds(JSON.parse(readFileSync(changelogPath, "utf8")))
      : { entries: [] };
    // Transiente Expiry-Einträge (Worst-Case am 1. Tag, Renewal 1–2 Tage später)
    // automatisch löschen — als wäre nie etwas passiert.
    const pruned = pruneTransientExpiry(existingChangelogRaw, changes, date);
    const existingChangelog = pruned.existing;
    const effectiveChanges = pruned.changes;
    const changelog = upsertChangelogJson(existingChangelog, runId, date, effectiveChanges);
    validateChangelog(changelog);
    const changelogJson = JSON.stringify(changelog) + "\n";
    writeFileSync(changelogPath, changelogJson);
    mkdirSync(join(ROOT, "src", "data"), { recursive: true });
    writeFileSync(join(ROOT, "src", "data", "changelog.json"), changelogJson);

    if (changes.length > 0 || privacyPopulated || privacySilentUpdate || plansChanged || peakRulesChanged || modelIdsPopulated || contextWindowPopulated || providerPopulated || fullIdsPopulated) {
      history.snapshots.push(latest);
      writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
      writeFileSync(prevPath, JSON.stringify(latest, null, 2) + "\n");
    }

    const enriched = models.filter((m) => m.capabilities !== null).length;
    const enrichedFree = freeModels.filter((f) => f.capabilities !== null).length;
    const privacyCovered = models.filter((m) => m.privacy !== null).length;
    const planLabel = plans.map((p) => `${p.name} $${p.priceMonthly}/${p.creditsMonthly}`).join(", ");
    console.log(`Gescrapt: ${models.length} Modelle, ${freeModels.length} kostenlose Modelle (Zen), ${changes.length} Änderungen (Snapshot ${date}); Pläne: ${planLabel}${plansChanged ? " (still aktualisiert)" : ""}${peakRulesChanged ? " (Peak-Regeln still, keine Events)" : ""}; Nutzungs-Boni: ${bonusLabels || "keine"}; Fähigkeiten (models.dev: ${mdSource}) für ${enriched} Modelle + ${enrichedFree} Zen-Modelle; Datenschutz für ${privacyCovered}/${models.length} Modelle${privacyPopulated ? " (privacy still befüllt, keine Events)" : ""}${privacySilentUpdate ? " (validUntil still aktualisiert, keine Events)" : ""}${modelIdsPopulated ? " (Modell-IDs still befüllt, keine Events)" : ""}${contextWindowPopulated ? " (Kontextfenster still befüllt, keine Events)" : ""}${providerPopulated ? " (Hersteller still befüllt, keine Events)" : ""}${fullIdsPopulated ? " (Full-IDs still befüllt, keine Events)" : ""}.`);
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
