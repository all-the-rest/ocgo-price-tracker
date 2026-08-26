#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderReleaseNotesForEntry } from "./release-notes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Erkennung "unserer" Releases: Tag = Run-`id` (Zeitstempel) oder Vorschema-Datum.
const OUR_TAG = /^(\d{4}-\d{2}-\d{2}(T\d{2}-\d{2}-\d{2}Z)?)$/;

function releaseBody(tag) {
  try {
    return JSON.parse(gh(["release", "view", tag, "--json", "body"])).body;
  } catch {
    return null;
  }
}

function main() {
  const changelog = JSON.parse(readFileSync(join(ROOT, "CHANGELOG.json"), "utf8"));
  const entries = changelog?.entries ?? [];
  const errors = [];

  const seenTags = new Set();
  for (const entry of entries) {
    const tag = entry.id ?? entry.date;
    if (!tag) {
      errors.push(`changelog entry without id (date=${entry.date})`);
      continue;
    }
    seenTags.add(tag);
    const notes = renderReleaseNotesForEntry(entry);
    if (notes === null) continue; // keine Änderungen → kein Release erwartet
    const body = releaseBody(tag);
    if (body === null) {
      errors.push(`missing GitHub release for changelog entry ${tag}`);
      continue;
    }
    if (body.trimEnd() !== notes.trimEnd()) {
      errors.push(`release notes out of sync for ${tag}`);
    }
  }

  // Verwaiste Releases: Tag in unserem Format, aber kein passender Changelog-Eintrag.
  let releases = [];
  try {
    releases = JSON.parse(gh(["release", "list", "--json", "tagName", "--limit", "1000"]));
  } catch {
    console.error("could not list releases (gh auth?)");
    process.exit(1);
  }
  for (const r of releases) {
    const tag = r.tagName;
    if (OUR_TAG.test(tag) && !seenTags.has(tag)) {
      errors.push(`orphan release ${tag} has no matching changelog entry`);
    }
  }

  if (errors.length > 0) {
    console.error("changelog/release sync FAILED:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`changelog/release sync OK (${entries.length} entries checked)`);
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
