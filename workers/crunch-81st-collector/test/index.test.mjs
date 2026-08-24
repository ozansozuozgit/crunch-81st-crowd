import assert from "node:assert/strict";
import test from "node:test";

import { archiveReadings, buildInsights, parseClubRecord, parseSlotKey, summarizeWeather, toCsv, weekdayProfile } from "../src/index.js";

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

function rowsForSlot(utcHours, dates) {
  return dates.flatMap((date) => utcHours.map((hour) => ({ timestamp_utc: `${date}T${String(hour).padStart(2, "0")}:10:00Z`, occupancy: 30, status: "moderate" })));
}

test("today plan ranks remaining Monday windows and marks qualified samples ready", () => {
  const dates = ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"];
  const rows = rowsForSlot([15], dates).map((row, index) => ({ ...row, occupancy: index % 2 ? 28 : 32 }));
  const insights = buildInsights(rows, "2026-08-24T14:30:00Z");
  assert.equal(insights.today_plan.status, "ready");
  assert.equal(insights.today_plan.local_date, "2026-08-24");
  assert.equal(insights.today_plan.items[0].slot, "0-11:10");
  assert.equal(insights.today_plan.items[0].independent_dates, 4);
});

test("today plan is provisional before four independent dates and skips past slots", () => {
  const rows = rowsForSlot([14, 15], ["2026-08-17"]);
  const insights = buildInsights(rows, "2026-08-24T14:30:00Z");
  assert.equal(insights.today_plan.status, "provisional");
  assert.deepEqual(insights.today_plan.items.map((item) => item.slot), ["0-11:10"]);
});

test("today plan reports closed outside scheduled local hours", () => {
  const rows = rowsForSlot([15], ["2026-08-22"]);
  const insights = buildInsights(rows, "2026-08-23T01:00:00Z");
  assert.equal(insights.today_plan.status, "closed");
  assert.deepEqual(insights.today_plan.items, []);
});

test("weekday profile orders weekdays by typical daily level", () => {
  const rows = [
    ...rowsForSlot([13], ["2026-08-03"]).map((row) => ({ ...row, occupancy: 100 })),
    ...rowsForSlot([13], ["2026-08-08"]).map((row) => ({ ...row, occupancy: 40 })),
  ];
  const insights = buildInsights(rows, "2026-08-24T12:00:00Z");
  assert.equal(insights.weekday_profile[0].weekday, "Sat");
  assert.equal(insights.weekday_profile[0].typical_daily_occupancy, 40);
  assert.equal(insights.weekday_profile[1].weekday, "Mon");
  assert.equal(insights.weekday_profile[1].typical_daily_occupancy, 100);
  assert.equal(insights.weekday_profile.every((entry) => entry.independent_dates >= 1), true);
});

test("parseSlotKey validates the slot contract", () => {
  assert.deepEqual(parseSlotKey("4-07:30"), { weekday: 4, hour: 7, minute: 30 });
  assert.equal(parseSlotKey("7-07:30"), null);
  assert.equal(parseSlotKey("bad"), null);
});

test("weather progress counts only reading dates with recorded weather", () => {
  const rows = rowsForSlot([13], ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]);
  const weatherRows = [
    { local_date: "2026-08-03", precipitation_mm: 0 },
    { local_date: "2026-08-04", precipitation_mm: 4.2 },
    { local_date: "2026-08-05", precipitation_mm: null },
  ];
  const { progress, correlations } = summarizeWeather(rows, weatherRows);
  assert.equal(progress.status, "collecting");
  assert.equal(progress.rainy_dates, 1);
  assert.equal(progress.dry_dates, 1);
  assert.equal(correlations.status, "insufficient_data");
});

test("weather correlation unlocks at twenty independent dates per group", () => {
  const rainyDates = Array.from({ length: 20 }, (_, index) => `2026-05-${String(index + 1).padStart(2, "0")}`);
  const dryDates = Array.from({ length: 20 }, (_, index) => `2026-06-${String(index + 1).padStart(2, "0")}`);
  const rows = [...rainyDates, ...dryDates].flatMap((date, index) => [{ timestamp_utc: `${date}T13:00:00Z`, occupancy: date.startsWith("2026-05") ? 200 + (index % 3) : 100 - (index % 2), status: "moderate" }]);
  const weatherRows = [...rainyDates.map((local_date) => ({ local_date, precipitation_mm: 5 })), ...dryDates.map((local_date) => ({ local_date, precipitation_mm: 0 }))];
  const { correlations } = summarizeWeather(rows, weatherRows);
  assert.equal(correlations.status, "observed");
  assert.equal(correlations.condition_n, 20);
  assert.equal(correlations.comparison_n, 20);
  assert.ok(Math.abs(correlations.effect - 101.45) < 0.001);
  assert.ok(correlations.confidence_low < correlations.effect && correlations.confidence_high > correlations.effect);
});

test("buildInsights exposes real weather progress instead of a hardcoded unavailable state", () => {
  const rows = rowsForSlot([13], ["2026-08-03", "2026-08-04"]);
  const insights = buildInsights(rows, "2026-08-24T12:00:00Z", [{ local_date: "2026-08-03", precipitation_mm: 3 }, { local_date: "2026-08-04", precipitation_mm: 0 }]);
  assert.equal(insights.weather_progress.status, "collecting");
  assert.equal(insights.factor_context.weather_progress.rainy_dates, 1);
});

