import assert from "node:assert/strict";
import test from "node:test";

import { archiveReadings, buildInsights, parseClubRecord, toCsv } from "../src/index.js";

function fakeDb(rows) {
  const state = {};
  const db = {
    prepare(sql) {
      if (sql.startsWith("SELECT timestamp_utc, occupancy, status FROM readings")) {
        return { all: async () => ({ results: rows }) };
      }
      if (sql.startsWith("INSERT INTO collector_state")) {
        return {
          bind(key, value) {
            return { run: async () => { state[key] = value; } };
          },
        };
      }
      throw new Error("unexpected sql " + sql);
    },
  };
  return { DB: db, state };
}

function fakeFetch(handlers) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    return handlers(url, init);
  };
  impl.calls = calls;
  return impl;
}

test("archive skips without a GitHub token", async () => {
  const env = fakeDb([{ timestamp_utc: "2026-08-17T22:01:00Z", occupancy: 20, status: "light" }]);
  const fetchImpl = fakeFetch(() => { throw new Error("must not call GitHub"); });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    assert.deepEqual(await archiveReadings(env), { status: "skipped" });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(env.state.last_archive, "skipped: no GITHUB_TOKEN");
  assert.equal(fetchImpl.calls.length, 0);
});

test("archive commits the full CSV when it changed", async () => {
  const rows = [{ timestamp_utc: "2026-08-17T22:01:00Z", occupancy: 20, status: "light" }];
  const env = fakeDb(rows);
  env.GITHUB_TOKEN = "token";
  const fetchImpl = fakeFetch((url, init) => {
    if (!init.method) return new Response(JSON.stringify({ content: btoa(toCsv([])), sha: "abc" }), { status: 200 });
    assert.equal(init.method, "PUT");
    const body = JSON.parse(init.body);
    assert.equal(body.sha, "abc");
    assert.match(body.message, /Crunch occupancy/);
    return new Response("{}", { status: 200 });
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const result = await archiveReadings(env, new Date("2026-08-24T04:11:00Z"));
    assert.equal(result.status, "committed");
    assert.equal(result.rows, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.match(env.state.last_archive, /committed 1 rows/);
});

test("archive records unchanged without a commit", async () => {
  const rows = [{ timestamp_utc: "2026-08-17T22:01:00Z", occupancy: 20, status: "light" }];
  const env = fakeDb(rows);
  env.GITHUB_TOKEN = "token";
  const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ content: btoa(toCsv(rows)), sha: "abc" }), { status: 200 }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    assert.deepEqual(await archiveReadings(env), { status: "unchanged" });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(env.state.last_archive, /unchanged/);
});

test("parses entity-encoded public Crunch occupancy", () => {
  const page = '<div data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:42,&quot;occupancy_status&quot;:&quot;light&quot;}}"></div>';
  assert.deepEqual(parseClubRecord(page), { occupancy: 42, status: "light" });
});

test("rejects invalid public Crunch occupancy", () => {
  assert.throws(() => parseClubRecord('<div data-react-props="{}"></div>'));
  assert.throws(() => parseClubRecord('<div data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:-1,&quot;occupancy_status&quot;:&quot;light&quot;}}"></div>'));
});

test("only qualifies a quiet window after four independent local dates", () => {
  const rows = [
    ["2026-08-17T22:01:00Z", 20, "light"],
    ["2026-08-17T22:09:00Z", 24, "light"],
    ["2026-08-24T22:01:00Z", 30, "light"],
    ["2026-08-31T22:01:00Z", 20, "light"],
    ["2026-09-07T22:01:00Z", 30, "light"],
  ].map(([timestamp_utc, occupancy, status]) => ({ timestamp_utc, occupancy, status }));
  const insights = buildInsights(rows, "2026-09-08T00:00:00Z");
  assert.equal(insights.quiet_window_details.status, "ready");
  assert.equal(insights.quiet_window_details.items[0].independent_dates, 4);
  assert.equal(insights.quiet_window_details.items[0].baseline_occupancy, 26);
  assert.equal(insights.recommendation_progress.status, "ready");
});

test("emits the public CSV contract", () => {
  assert.equal(toCsv([{ timestamp_utc: "2026-08-17T22:01:00Z", occupancy: 20, status: "light" }]), "timestamp_utc,occupancy,status\n2026-08-17T22:01:00Z,20,light\n");
});

