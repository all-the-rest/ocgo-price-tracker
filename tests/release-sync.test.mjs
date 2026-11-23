import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseBody } from "../scripts/check-release-sync.mjs";

test("releaseBody: Release erst beim 2. Versuch sichtbar → Body, ein Backoff", async () => {
  const sleeps = [];
  let calls = 0;
  const body = await releaseBody("2026-11-23T20-00-00Z", {
    info: async () => (++calls === 1 ? null : { body: ".price update notes" }),
    sleep: (ms) => sleeps.push(ms),
  });
  assert.equal(body, ".price update notes");
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [500]);
});

test("releaseBody: Replikationsfenster mit mehreren null-Treffern → trotzdem gefunden", async () => {
  const sleeps = [];
  let calls = 0;
  const body = await releaseBody("tag", {
    info: async () => (++calls < 4 ? null : { body: "notes" }),
    sleep: (ms) => sleeps.push(ms),
  });
  assert.equal(body, "notes");
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [500, 1000, 2000]);
});

test("releaseBody: echtes Fehlen nach allen Versuchen → null (Sync-Check bleibt rot)", async () => {
  const sleeps = [];
  let calls = 0;
  const body = await releaseBody("tag", {
    info: async () => {
      calls++;
      return null;
    },
    sleep: (ms) => sleeps.push(ms),
  });
  assert.equal(body, null);
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [500, 1000, 2000]);
});
