import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, isTransientGhError, ghExec, createReleaseWithRetry } from "../scripts/gh.mjs";

const noSleep = () => {};

test("withRetry: Erfolg beim ersten Versuch → kein Backoff", async () => {
  const sleeps = [];
  const attempts = [];
  const value = await withRetry(
    (attempt) => {
      attempts.push(attempt);
      return "ok";
    },
    { sleep: (ms) => sleeps.push(ms) }
  );
  assert.equal(value, "ok");
  assert.deepEqual(attempts, [1]);
  assert.deepEqual(sleeps, []);
});

test("withRetry: Erfolg nach transientem Fehler → ein Backoff", async () => {
  const sleeps = [];
  const attempts = [];
  const value = await withRetry(
    (attempt) => {
      attempts.push(attempt);
      if (attempt === 1) throw new Error("timeout");
      return "ok";
    },
    { sleep: (ms) => sleeps.push(ms) }
  );
  assert.equal(value, "ok");
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(sleeps, [500]);
});

test("withRetry: Fehler nach allen Versuchen → letzter Fehler, exponentielles Backoff", async () => {
  const sleeps = [];
  const attempts = [];
  const boom = new Error("rate limited");
  await assert.rejects(
    () =>
      withRetry(
        (attempt) => {
          attempts.push(attempt);
          throw boom;
        },
        { attempts: 3, sleep: (ms) => sleeps.push(ms) }
      ),
    (err) => err === boom
  );
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(sleeps, [500, 1000]);
});

test("withRetry: shouldRetry=false beendet dauerhafte Fehler sofort", async () => {
  const sleeps = [];
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        () => {
          calls++;
          throw new Error("bad credentials");
        },
        { sleep: (ms) => sleeps.push(ms), shouldRetry: isTransientGhError }
      ),
    /bad credentials/
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("isTransientGhError: Timeout/5xx/Rate-Limit ja, dauerhafte Fehler nein", () => {
  const timeout = new Error("timed out");
  timeout.killed = true;
  timeout.signal = "SIGTERM";
  assert.equal(isTransientGhError(timeout), true);
  assert.equal(isTransientGhError(Object.assign(new Error("gh failed"), { stderr: "HTTP 503 Service Unavailable" })), true);
  assert.equal(isTransientGhError(new Error("API rate limit exceeded")), true);
  assert.equal(isTransientGhError(Object.assign(new Error("gh failed"), { stderr: "release already exists" })), false);
  assert.equal(isTransientGhError(Object.assign(new Error("gh failed"), { stderr: "401 Bad credentials" })), false);
});

test("ghExec: zentrale Optionen + Retry bei Timeout, kein Retry bei Dauerfehler", async () => {
  const sleeps = [];
  const calls = [];
  const value = await ghExec(["release", "list", "--json", "tagName"], {
    attempts: 2,
    sleep: (ms) => sleeps.push(ms),
    exec: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      if (calls.length === 1) {
        const err = new Error("timed out");
        err.killed = true;
        throw err;
      }
      return '["ok"]';
    },
  });
  assert.equal(value, '["ok"]');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cmd, "gh");
  assert.deepEqual(calls[0].args, ["release", "list", "--json", "tagName"]);
  assert.equal(calls[0].opts.timeout, 60000);
  assert.deepEqual(calls[0].opts.stdio, ["ignore", "pipe", "pipe"]);
  assert.deepEqual(sleeps, [500]);

  let permanentCalls = 0;
  await assert.rejects(
    () =>
      ghExec(["release", "list"], {
        sleep: noSleep,
        exec: () => {
          permanentCalls++;
          throw Object.assign(new Error("Bad credentials (401)"), { stderr: "401 Bad credentials" });
        },
      }),
    /Bad credentials/
  );
  assert.equal(permanentCalls, 1);
});

test("createReleaseWithRetry: Timeout nach erfolgtem Anlegen → existierendes Release gilt als Erfolg", async () => {
  const sleeps = [];
  const creates = [];
  const lookups = [];
  const args = ["release", "create", "2026-09-01T22-42-41Z", "--title", "Price Update", "--notes", "notes"];
  const created = await createReleaseWithRetry("2026-09-01T22-42-41Z", args, {
    info: async (tag) => {
      lookups.push(tag);
      return { name: "Price Update 2026-09-01T22-42-41Z" };
    },
    create: async (a) => {
      creates.push(a);
      if (creates.length === 1) {
        const err = new Error("timed out");
        err.killed = true;
        throw err;
      }
    },
    sleep: (ms) => sleeps.push(ms),
  });
  assert.equal(created, false, "beim Retry vorhanden → nicht erneut angelegt");
  assert.deepEqual(creates, [args]);
  assert.deepEqual(lookups, ["2026-09-01T22-42-41Z"]);
  assert.deepEqual(sleeps, [500]);
});

test("createReleaseWithRetry: 'tag already exists' → sofort Erfolg, kein Lookup nötig", async () => {
  let creates = 0;
  let lookups = 0;
  const created = await createReleaseWithRetry("2026-09-01T22-42-41Z", ["release", "create", "tag"], {
    info: async () => {
      lookups++;
      return { name: "already there" };
    },
    create: async () => {
      creates++;
      throw Object.assign(new Error("gh failed"), { stderr: "release already exists" });
    },
    sleep: noSleep,
  });
  assert.equal(created, false);
  assert.equal(creates, 1);
  assert.equal(lookups, 0);
});

test("createReleaseWithRetry: drei null-Treffer im Lookup → Release nach Replikation erkannt", async () => {
  const sleeps = [];
  let lookups = 0;
  let creates = 0;
  const created = await createReleaseWithRetry("tag", ["release", "create", "tag"], {
    info: async () => (++lookups < 4 ? null : { name: "Price Update tag" }),
    create: async () => {
      creates++;
      if (creates === 1) throw Object.assign(new Error("timed out"), { killed: true });
    },
    sleep: (ms) => sleeps.push(ms),
  });
  assert.equal(created, false);
  assert.equal(lookups, 4);
  assert.equal(creates, 1);
  // erster 500er: Timeout-Retry des create, danach die drei Lookup-Backoffs
  assert.deepEqual(sleeps, [500, 500, 1_000, 2_000]);
});

test("createReleaseWithRetry: GitHub-422 already_exists → Erfolg statt Fehler", async () => {
  let creates = 0;
  const created = await createReleaseWithRetry("tag", ["release", "create", "tag"], {
    info: async () => null,
    create: async () => {
      creates++;
      throw Object.assign(new Error("gh failed"), {
        stderr: "HTTP 422: Validation Failed (already_exists)",
      });
    },
    sleep: noSleep,
  });
  assert.equal(created, false);
  assert.equal(creates, 1);
});

test("createReleaseWithRetry: Dauerfehler (401) wird nicht retried", async () => {
  let creates = 0;
  await assert.rejects(
    () =>
      createReleaseWithRetry("tag", ["release", "create", "tag"], {
        info: async () => null,
        create: async () => {
          creates++;
          throw Object.assign(new Error("Bad credentials"), { stderr: "401 Bad credentials" });
        },
        sleep: noSleep,
      }),
    /Bad credentials/
  );
  assert.equal(creates, 1);
});

test("createReleaseWithRetry: transienter Fehler ohne Release nach allen Versuchen → reject", async () => {
  let creates = 0;
  await assert.rejects(
    () =>
      createReleaseWithRetry("tag", ["release", "create", "tag"], {
        info: async () => null,
        create: async () => {
          creates++;
          throw Object.assign(new Error("timed out"), { killed: true });
        },
        sleep: noSleep,
      }),
    /timed out/
  );
  assert.equal(creates, 3);
});
