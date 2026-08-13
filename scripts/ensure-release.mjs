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

function releaseInfo(tag) {
  try {
    return JSON.parse(gh(["release", "view", tag, "--json", "name,body"]));
  } catch {
    return null;
  }
}

function ensureRelease(tag, notes, { latest }) {
  const title = `Price Update ${tag}`;
  const existing = releaseInfo(tag);
  if (existing) {
    if (existing.name === title && existing.body.trimEnd() === notes.trimEnd()) {
      console.log(`release ${tag} is up to date, nothing to do`);
      return;
    }
    gh(["release", "edit", tag, "--title", title, "--notes", notes]);
    console.log(`updated release ${tag}`);
    return;
  }
  const args = ["release", "create", tag, "--title", title, "--notes", notes];
  if (latest === false) args.push("--latest=false");
  gh(args);
  console.log(`created release ${tag}${latest === false ? " (not latest)" : ""}`);
}

function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes("--all");
  const dateIdx = argv.indexOf("--date");
  const date =
    (dateIdx !== -1 ? argv[dateIdx + 1] : null) ??
    (argv.find((a) => a.startsWith("--date="))?.slice("--date=".length) ?? null);

  const changelog = JSON.parse(readFileSync(join(ROOT, "CHANGELOG.json"), "utf8"));
  const entries = changelog?.entries ?? [];
  if (entries.length === 0) {
    console.log("no changelog entries, nothing to do");
    return;
  }

  let targets;
  if (all) {
    targets = entries;
  } else if (date) {
    const entry = entries.find((e) => e.date === date);
    if (!entry) {
      console.error(`no changelog entry for date ${date}`);
      process.exit(1);
    }
    targets = [entry];
  } else {
    targets = [entries[0]];
  }

  const newestDate = entries[0].date;
  for (const entry of targets) {
    const notes = renderReleaseNotesForEntry(entry);
    if (notes === null) {
      console.log(`entry ${entry.date}: no changes, skipping release`);
      continue;
    }
    ensureRelease(entry.date, notes, { latest: entry.date === newestDate });
  }
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
