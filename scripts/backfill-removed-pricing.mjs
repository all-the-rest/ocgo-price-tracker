#!/usr/bin/env node
// Einmaliges Backfill: ergänzt fehlende `pricing`-Felder in `model_removed`-
// Changelog-Events aus data/history.json (letzter Snapshot vor dem Event-Datum,
// dessen Modellname zum entfernten Modell passt).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[()]/g, "").trim();
const stripTier = (s) => String(s ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();

function loadJson(p) {
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

function findPricing(history, modelKey, entryDate) {
  const target = norm(stripTier(modelKey));
  let best = null;
  for (const snap of history.snapshots ?? []) {
    const day = (snap.fetchedAt ?? "").slice(0, 10);
    if (!day || day > entryDate) continue;
    for (const m of snap.models ?? []) {
      if (norm(stripTier(m.name)) !== target) continue;
      const pricing = {
        input: m.input,
        output: m.output,
        cachedRead: m.cachedRead,
        cachedWrite: m.cachedWrite,
        usage: m.usage,
      };
      if (!best || day > best.day) best = { day, pricing };
    }
  }
  return best ? best.pricing : null;
}

function backfill(path, history) {
  const changelog = loadJson(path);
  if (!changelog?.entries) return false;
  let changed = false;
  for (const entry of changelog.entries) {
    for (const c of entry.changes ?? []) {
      if (c.type === "model_removed" && c.pricing === undefined) {
        const pricing = findPricing(history, c.model, entry.date);
        if (pricing) {
          c.pricing = pricing;
          changed = true;
        }
      }
    }
  }
  if (changed) writeFileSync(path, JSON.stringify(changelog) + "\n");
  return changed;
}

const history = loadJson(join(ROOT, "data", "history.json"));
if (!history) {
  console.error("history.json nicht gefunden");
  process.exit(1);
}

const a = backfill(join(ROOT, "CHANGELOG.json"), history);
const b = backfill(join(ROOT, "src", "data", "changelog.json"), history);
console.log(`Backfill: CHANGELOG.json ${a ? "geändert" : "unverändert"}, src/data/changelog.json ${b ? "geändert" : "unverändert"}`);
