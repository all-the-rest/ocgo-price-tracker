#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const GH_TIMEOUT_MS = 60000;

export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ein frisch angelegtes Release ist auf GitHub kurz unsichtbar (Replikation).
export const REPLICATION_ATTEMPTS = 4;
export const REPLICATION_DELAY_MS = 500;

/**
 * `lookup(tag)` so oft wiederholen, bis ein Treffer vorliegt (oder alle
 * Versuche aufgebraucht sind). Wird sowohl vom Sync-Check als auch vom
 * Idempotenz-Check von `createReleaseWithRetry` genutzt.
 */
export async function findReleaseWithRetry(
  lookup,
  tag,
  { attempts = REPLICATION_ATTEMPTS, delayMs = REPLICATION_DELAY_MS, sleep = defaultSleep } = {}
) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const info = await lookup(tag);
    if (info) return info;
    if (attempt < attempts) await sleep(delayMs * 2 ** (attempt - 1));
  }
  return null;
}

/**
 * `fn` bis zu `attempts` Mal ausführen, bei Fehlern mit exponentiellem Backoff.
 * `fn` bekommt den 1-basierten Versuch übergeben; nach dem letzten Versuch wird
 * der Fehler geworfen. `sleep` ist injizierbar, damit Tests nicht warten.
 */
export async function withRetry(
  fn,
  { attempts = 3, delayMs = 500, sleep = defaultSleep, shouldRetry = () => true } = {}
) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("withRetry: attempts muss >= 1 sein");
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !shouldRetry(err)) throw err;
      await sleep(delayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

const TRANSIENT_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

/** Nur vorübergehende gh-Fehler (Timeout, 5xx, Rate-Limit, Netzwerk) retryen. */
export function isTransientGhError(err) {
  if (!err) return false;
  if (TRANSIENT_CODES.has(err.code)) return true;
  // execFileSync beendet einen überlaufenen Prozess per SIGTERM.
  if (err.killed === true || err.signal === "SIGTERM") return true;
  const text = `${err.message ?? ""} ${String(err.stderr ?? "")}`;
  if (/\b5\d{2}\b|bad gateway|service unavailable|gateway timeout|internal server error/i.test(text)) return true;
  if (/rate limit|abuse detection/i.test(text)) return true;
  if (/socket hang up|fetch failed|network|TLS|handshake/i.test(text)) return true;
  return false;
}

/** Zentraler gh-Aufruf: Timeout, Retry nur bei temporären Fehlern. */
export async function ghExec(
  args,
  { attempts = 3, delayMs = 500, sleep, exec = execFileSync, shouldRetry = isTransientGhError } = {}
) {
  return withRetry(
    () => exec("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GH_TIMEOUT_MS }),
    { attempts, delayMs, sleep, shouldRetry }
  );
}

/** `gh` meldet ein bereits vorhandenes Release als Fehler — für uns ein Erfolg. */
function isAlreadyExists(err) {
  // Sowohl die Klartextform als auch die GitHub-422-Form (`already_exists`).
  return /already[ _-]?exists|tag .* exists/i.test(`${err?.message ?? ""} ${String(err?.stderr ?? "")}`);
}

/**
 * `release create` idempotent ausführen: bevor ein erneuter Versuch startet,
 * prüfen, ob das Release trotz Fehler (z. B. Timeout nach erfolgreichem Anlegen)
 * schon existiert. Replikationsbedingte `null`-Treffer werden dabei mehrfach
 * nachgefragt. "tag already exists" gilt immer als Erfolg.
 *
 * Rückgabe: true = von uns angelegt, false = schon vorhanden.
 */
export async function createReleaseWithRetry(
  tag,
  args,
  { info, create, attempts = 3, delayMs = 500, sleep } = {}
) {
  const lookup =
    info ??
    (async () => {
      try {
        return JSON.parse(await ghExec(["release", "view", tag, "--json", "name,body"]));
      } catch {
        return null;
      }
    });
  const perform = create ?? ((createArgs) => ghExec(createArgs));
  return withRetry(
    async (attempt) => {
      if (attempt > 1 && (await findReleaseWithRetry(lookup, tag, { sleep }))) return false;
      try {
        await perform(args);
        return true;
      } catch (err) {
        if (isAlreadyExists(err)) return false;
        throw err;
      }
    },
    { attempts, delayMs, sleep, shouldRetry: isTransientGhError }
  );
}
