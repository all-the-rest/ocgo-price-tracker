#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const PRICE_FIELD_NAMES = {
  input: "Input",
  output: "Output",
  cachedRead: "Cached Read",
  cachedWrite: "Cached Write",
};

export function fmtPrice(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  if (n >= 1) return `$${n.toFixed(2)}`;
  const s = n.toFixed(6);
  return `$${s.replace(/0+$/, "").replace(/\.$/, "")}`;
}

const isUsageMap = (u) => typeof u === "object" && u !== null;

function fmtUsage(u, bold = false) {
  const s = u === null || u === undefined ? "∞ (unlimited)" : `$${u}`;
  return bold ? `**${s}**` : s;
}

/**
 * Rendert eine Nutzungsangabe: alt (einzelner Wert, historische Changelog-
 * Einträge) bleibt unverändert, neu (Map Plan-Id → $) nennt die Plannamen
 * (`Go $60, Go Plus $240`; unbekannte Plan-Id fällt auf die Id zurück).
 * `boldUsage` fettet die Werte (bei Nutzungsänderung).
 */
function fmtUsageValue(usage, boldUsage, planNames) {
  if (!isUsageMap(usage)) return fmtUsage(usage, boldUsage);
  const entries = Object.entries(usage);
  if (entries.length === 0) return fmtUsage(null, boldUsage);
  return entries
    .map(([planId, value]) => `${planNames[planId] ?? planId} ${fmtUsage(value, boldUsage)}`)
    .join(", ");
}

export function pricingLine(p, fields = [], boldUsage = false, planNames = {}) {
  const order = ["input", "output", "cachedRead"];
  if (p.cachedWrite !== null) order.push("cachedWrite");
  const parts = order.map((f) => {
    const s = fmtPrice(p[f]);
    return fields.includes(f) ? `**${s}**` : s;
  });
  return `${parts.join(" / ")} @ ${fmtUsageValue(p.usage, boldUsage, planNames)}`;
}

/** Nutzung hat sich geändert (alt: Zahl/null, neu: Map) — für Fettung. */
function usageChanged(a, b) {
  if (isUsageMap(a) || isUsageMap(b)) return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  return a !== b;
}

export function fmtCaps(c) {
  if (!c) return "–";
  const inp = Array.isArray(c.input) && c.input.length ? c.input.join("+") : "–";
  const outp = Array.isArray(c.output) && c.output.length ? c.output.join("+") : "–";
  const flags = [c.reasoning ? "reasoning" : null, c.toolCall ? "tool" : null]
    .filter(Boolean)
    .join("+");
  return `in:${inp} out:${outp}${flags ? ` ${flags}` : ""}`;
}

/**
 * Formatiert eine Privacy-Stufe so, dass der Release-Text der Changelog-UI
 * entspricht (`privacyTier`): training / ZDR / N days retention / retention.
 * `retentionDays: true` = ZDR (0 Tage) — vorher fälschlich "true days retention".
 */
export function fmtPrivacy(p) {
  if (!p) return "–";
  let core;
  if (p.training) core = "training";
  else if (p.retentionDays === true) core = "ZDR";
  else if (p.retentionDays === false) core = "retention";
  else if (typeof p.retentionDays === "number")
    core = p.retentionDays > 0 ? `${p.retentionDays} days retention` : "ZDR";
  else core = "ZDR";
  return p.validUntil ? `${core} (valid until ${p.validUntil})` : core;
}

export function renderChange(c, planNames = {}) {
  switch (c.type) {
    case "text":
      return `- ${c.lang.en}`;
    case "model_added":
      return `- **${c.model}** — added (${pricingLine(c.pricing, [], false, planNames)})`;
    case "model_removed":
      return `- **${c.model}** — removed (${pricingLine(c.pricing, [], false, planNames)}, was available ${c.days} days)`;
    case "price_changed": {
      const fields = c.fields.map((f) => PRICE_FIELD_NAMES[f] ?? f).join(", ");
      const boldUsage = usageChanged(c.from.usage, c.to.usage);
      return `- **${c.model}** — price change (${fields}): ${pricingLine(c.from, c.fields, boldUsage, planNames)} → ${pricingLine(c.to, c.fields, boldUsage, planNames)}`;
    }
    case "usage_changed": {
      const fmtU = (u) => (u === null || u === undefined ? "∞ (unlimited)" : `$${u}`);
      // Neue Form: ein Event pro Modell, alle geänderten Pläne im `plans`-Array
      // (Plannamen aus data/latest.json; unbekannte Id fällt auf die Id zurück).
      if (Array.isArray(c.plans)) {
        const parts = c.plans.map(
          (p) => `${planNames[p.plan] ?? p.plan} ${fmtU(p.from)} → ${fmtU(p.to)}`
        );
        return `- **${c.model}** — usage: ${parts.join(", ")}`;
      }
      // Legacy: ein einzelner Plan (optional) oder ein skalarer Wert.
      if (c.plan) {
        const label = planNames[c.plan] ?? c.plan;
        return `- **${c.model}** — ${label} usage: **${fmtU(c.from)}** → **${fmtU(c.to)}**`;
      }
      return `- **${c.model}** — usage: **${fmtU(c.from)}** → **${fmtU(c.to)}**`;
    }
    case "capabilities_changed":
      return `- **${c.model}** — capabilities: **${fmtCaps(c.from)}** → **${fmtCaps(c.to)}**`;
    case "privacy_changed":
      return `- **${c.model}** — privacy: **${fmtPrivacy(c.from)}** → **${fmtPrivacy(c.to)}**`;
    case "free_added":
      return `- **${c.name ?? c.model}** — new free model`;
    case "plan_added":
      // Plan-Name bevorzugt aus data/latest.json (i18n-frei, rein englisch).
      return `- **${planNames[c.plan] ?? c.name}** — new plan: ${fmtUsage(c.priceMonthly)}/month, up to ${fmtUsage(c.creditsMonthly)} included usage per model`;
    case "free_removed": {
      const days = Math.max(
        0,
        Math.round((Date.parse(c.until) - Date.parse(c.availableFrom)) / 86_400_000)
      );
      return `- **${c.name ?? c.model}** — free model removed (was available ${days} days, since ${c.availableFrom})`;
    }
    default:
      return `- ${c.type}: ${JSON.stringify(c)}`;
  }
}

const planNamesOf = (plans) =>
  Object.fromEntries((Array.isArray(plans) ? plans : []).map((p) => [p.id, p.name]));

export function renderReleaseNotesForEntry(entry, plans = []) {
  if (!entry || !Array.isArray(entry.changes) || entry.changes.length === 0) return null;
  const planNames = planNamesOf(plans);
  const lines = [
    `# Price Update ${entry.date}`,
    "",
    `Price changes for OpenCode Go on **${entry.date}**:`,
    "",
    ...entry.changes.flatMap((c) => renderChange(c, planNames).split("\n")),
  ];
  return lines.join("\n");
}

export function renderReleaseNotes(changelog, plans = []) {
  return renderReleaseNotesForEntry(changelog?.entries?.[0], plans);
}

/** Liest die Plannamen aus data/latest.json (für `usage_changed`-Labels). */
export function loadPlans() {
  try {
    const data = JSON.parse(readFileSync(join(ROOT, "data", "latest.json"), "utf8"));
    return Array.isArray(data.plans) ? data.plans : [];
  } catch {
    return [];
  }
}

function main() {
  const changelog = JSON.parse(readFileSync(join(ROOT, "CHANGELOG.json"), "utf8"));
  const plans = loadPlans();
  const argv = process.argv.slice(2);
  const dateIdx = argv.indexOf("--date");
  const date =
    (dateIdx !== -1 ? argv[dateIdx + 1] : null) ??
    (argv.find((a) => a.startsWith("--date="))?.slice("--date=".length) ?? null);
  const entry = date
    ? changelog.entries.find((e) => e.id === date || e.date === date)
    : changelog?.entries?.[0];
  if (!entry) {
    console.error(`no changelog entry found${date ? ` for date ${date}` : ""}`);
    process.exit(1);
  }
  const notes = renderReleaseNotesForEntry(entry, plans);
  if (notes !== null) process.stdout.write(notes + "\n");
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
