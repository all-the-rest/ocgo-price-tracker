#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const PRICE_FIELD_NAMES = {
  input: "Input",
  output: "Output",
  cachedRead: "Cached Read",
  cachedWrite: "Cached Write",
};

function fmtPrice(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  if (n >= 1) return `$${n.toFixed(2)}`;
  const s = n.toFixed(6);
  return `$${s.replace(/0+$/, "").replace(/\.$/, "")}`;
}

function pricingLine(p) {
  const parts = [fmtPrice(p.input), fmtPrice(p.output), fmtPrice(p.cachedRead)];
  if (p.cachedWrite !== null) parts.push(fmtPrice(p.cachedWrite));
  return `${parts.join(" / ")} @ ${p.usage === null ? "∞ (unlimited)" : `$${p.usage}`}`;
}

function fmtCaps(c) {
  if (!c) return "–";
  const inp = Array.isArray(c.input) && c.input.length ? c.input.join("+") : "–";
  const outp = Array.isArray(c.output) && c.output.length ? c.output.join("+") : "–";
  const flags = [c.reasoning ? "reasoning" : null, c.toolCall ? "tool" : null]
    .filter(Boolean)
    .join("+");
  return `in:${inp} out:${outp}${flags ? ` ${flags}` : ""}`;
}

function fmtPrivacy(p) {
  if (!p) return "–";
  const core = p.training
    ? "training"
    : (p.retentionDays ?? 0) > 0
      ? `${p.retentionDays} days retention`
      : "ZDR";
  return p.validUntil ? `${core} (valid until ${p.validUntil})` : core;
}

function renderChange(c) {
  switch (c.type) {
    case "text":
      return `- ${c.lang.en}`;
    case "model_added":
      return `- **${c.model}** — added (${pricingLine(c.pricing)})`;
    case "model_removed":
      return `- **${c.model}** — removed (${pricingLine(c.pricing)}, was available ${c.days} days)`;
    case "price_changed": {
      const fields = c.fields.map((f) => PRICE_FIELD_NAMES[f] ?? f).join(", ");
      return `- **${c.model}** — price change (${fields}): ${pricingLine(c.from)} → ${pricingLine(c.to)}`;
    }
    case "usage_changed": {
      const fmtU = (u) => (u === null ? "∞ (unlimited)" : `$${u}`);
      return `- **${c.model}** — usage: ${fmtU(c.from)} → ${fmtU(c.to)}`;
    }
    case "capabilities_changed":
      return `- **${c.model}** — capabilities: ${fmtCaps(c.from)} → ${fmtCaps(c.to)}`;
    case "privacy_changed":
      return `- **${c.model}** — privacy: ${fmtPrivacy(c.from)} → ${fmtPrivacy(c.to)}`;
    case "free_added":
      return `- **${c.name ?? c.model}** — new free model`;
    case "free_removed":
      return `- **${c.name ?? c.model}** — free model removed (since ${c.availableFrom})`;
    default:
      return `- ${c.type}: ${JSON.stringify(c)}`;
  }
}

export function renderReleaseNotesForEntry(entry) {
  if (!entry || !Array.isArray(entry.changes) || entry.changes.length === 0) return null;
  const lines = [
    `# Price Update ${entry.date}`,
    "",
    `Price changes for OpenCode Go on **${entry.date}**:`,
    "",
    ...entry.changes.flatMap((c) => renderChange(c).split("\n")),
  ];
  return lines.join("\n");
}

export function renderReleaseNotes(changelog) {
  return renderReleaseNotesForEntry(changelog?.entries?.[0]);
}

function main() {
  const changelog = JSON.parse(readFileSync(join(ROOT, "CHANGELOG.json"), "utf8"));
  const argv = process.argv.slice(2);
  const dateIdx = argv.indexOf("--date");
  const date =
    (dateIdx !== -1 ? argv[dateIdx + 1] : null) ??
    (argv.find((a) => a.startsWith("--date="))?.slice("--date=".length) ?? null);
  const entry = date
    ? changelog.entries.find((e) => e.date === date)
    : changelog?.entries?.[0];
  if (!entry) {
    console.error(`no changelog entry found${date ? ` for date ${date}` : ""}`);
    process.exit(1);
  }
  const notes = renderReleaseNotesForEntry(entry);
  if (notes !== null) process.stdout.write(notes + "\n");
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
