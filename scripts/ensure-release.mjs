#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderReleaseNotesForEntry, loadPlans } from "./release-notes.mjs";
import { createReleaseWithRetry, ghExec } from "./gh.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function releaseInfo(tag) {
  try {
    return JSON.parse(await ghExec(["release", "view", tag, "--json", "name,body"]));
  } catch {
    return null;
  }
}

async function ensureRelease(tag, notes, { latest }) {
  const title = `Price Update ${tag}`;
  const existing = await releaseInfo(tag);
  if (existing) {
    if (existing.name === title && (existing.body ?? "").trimEnd() === notes.trimEnd()) {
      console.log(`release ${tag} is up to date, nothing to do`);
      return;
    }
    await ghExec(["release", "edit", tag, "--title", title, "--notes", notes]);
    console.log(`updated release ${tag}`);
    return;
  }
  const args = ["release", "create", tag, "--title", title, "--notes", notes];
  if (latest === false) args.push("--latest=false");
  const created = await createReleaseWithRetry(tag, args, { info: releaseInfo, create: (a) => ghExec(a) });
  if (created) {
    console.log(`created release ${tag}${latest === false ? " (not latest)" : ""}`);
  } else {
    console.log(`release ${tag} already exists, nothing to do`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes("--all");
  const dateIdx = argv.indexOf("--date");
  const date =
    (dateIdx !== -1 ? argv[dateIdx + 1] : null) ??
    (argv.find((a) => a.startsWith("--date="))?.slice("--date=".length) ?? null);

  const changelog = JSON.parse(readFileSync(join(ROOT, "CHANGELOG.json"), "utf8"));
  const plans = loadPlans();
  const entries = changelog?.entries ?? [];
  if (entries.length === 0) {
    console.log("no changelog entries, nothing to do");
    return;
  }

  let targets;
  if (all) {
    targets = entries;
  } else if (date) {
    const matched = entries.filter((e) => e.date === date);
    if (matched.length === 0) {
      console.error(`no changelog entry for date ${date}`);
      process.exit(1);
    }
    targets = matched;
  } else {
    targets = [entries[0]];
  }

  // Einträge sind neueste-zuerst (unshift); der erste ist der "latest"-Release.
  const newestId = entries[0].id;
  for (const entry of targets) {
    const notes = renderReleaseNotesForEntry(entry, plans);
    if (notes === null) {
      console.log(`entry ${entry.id}: no changes, skipping release`);
      continue;
    }
    await ensureRelease(entry.id, notes, { latest: entry.id === newestId });
  }
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
