import assert from "node:assert/strict";
import test from "node:test";

import { archiveReadings, buildInsights, hourlyVisits, parseClubRecord, parseSlotKey, summarizeWeather, toCsv, todayPlan, weekdayProfile } from "../src/index.js";

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

// The public counter is a cumulative check-in total: 0 at open, rising to its
// close-of-day peak, then resetting. These fixtures follow that shape.
function counterDay(date, hourlyTotals, status = "moderate") {
  const noon = Date.parse(date + "T12:07:00Z"); // 8:07 AM ET
  return hourlyTotals.map((cumulative, index) => ({
    timestamp_utc: new Date(noon + index * 3600000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    occupancy: cumulative,
    status,
  }));
}
// A realistic Monday-style cumulative counter: 15 readings, 8 AM through 10 PM ET.
const FULL_DAY = [10, 30, 45, 70, 110, 145, 175, 195, 225, 270, 320, 360, 385, 400, 410];

test("hourlyVisits converts the cumulative counter into per-hour check-ins", () => {
  const rows = counterDay("2026-08-24", [10, 25, 25, 60]);
  assert.deepEqual(hourlyVisits(rows), [
    { date: "2026-08-24", weekday: 0, hour: 9, visits: 15 },
    { date: "2026-08-24", weekday: 0, hour: 10, visits: 0 },
    { date: "2026-08-24", weekday: 0, hour: 11, visits: 35 },
  ]);
});

test("hourlyVisits skips the overnight reset and never invents negative visits", () => {
  const rows = [
    { timestamp_utc: "2026-08-24T01:57:00Z", occupancy: 595, status: "active" },
    { timestamp_utc: "2026-08-24T02:07:00Z", occupancy: 590, status: "active" },
    { timestamp_utc: "2026-08-24T09:07:00Z", occupancy: 12, status: "light" },
    { timestamp_utc: "2026-08-24T10:07:00Z", occupancy: 30, status: "light" },
  ];
  assert.deepEqual(hourlyVisits(rows), [
    { date: "2026-08-23", weekday: 6, hour: 22, visits: 0 },
    { date: "2026-08-24", weekday: 0, hour: 6, visits: 18 },
  ]);
});

test("today plan ranks remaining hours by fewest expected walk-ins", () => {
  const rows = counterDay("2026-08-24", FULL_DAY);
  const insights = buildInsights(rows, "2026-08-24T19:30:00Z"); // 3:30 PM ET
  assert.equal(insights.today_plan.status, "provisional");
  assert.equal(insights.today_plan.local_date, "2026-08-24");
  const rates = insights.today_plan.items.map((item) => item.expected_rate);
  assert.deepEqual(rates, [...rates].sort((a, b) => a - b));
  assert.equal(insights.today_plan.items[0].slot, "0-21"); // 9 PM: quietest usable hour (the final hour before close is excluded)
  assert.equal(insights.today_plan.items[0].expected_rate, 15);
});

test("today plan marks four independent dates as ready and is closed at night", () => {
  const rows = [
    ...counterDay("2026-08-03", FULL_DAY),
    ...counterDay("2026-08-10", FULL_DAY),
    ...counterDay("2026-08-17", FULL_DAY),
    ...counterDay("2026-08-24", FULL_DAY),
  ];
  const insights = buildInsights(rows, "2026-08-24T19:30:00Z");
  assert.equal(insights.today_plan.status, "ready");
  const quietest = insights.today_plan.items[0];
  assert.equal(quietest.slot, "0-22"); // 10 PM: only ~10 check-ins that hour
  assert.equal(quietest.expected_rate, 10);
  const closed = buildInsights(rows, "2026-08-25T04:00:00Z");
  assert.equal(closed.today_plan.status, "closed");
  assert.deepEqual(closed.today_plan.items, []);
});

test("weekday profile orders weekdays by typical daily check-in totals", () => {
  const rows = [
    ...counterDay("2026-08-03", FULL_DAY),  // Monday: 410 total
    ...counterDay("2026-08-08", [50, 90]),  // Saturday: 90 total
  ];
  const insights = buildInsights(rows, "2026-08-24T12:00:00Z");
  assert.equal(insights.weekday_profile[0].weekday, "Sat");
  assert.equal(insights.weekday_profile[0].typical_daily_visits, 40); // Saturday: 50 -> 90 counter = 40 visits
  assert.equal(insights.weekday_profile[1].weekday, "Mon");
  assert.equal(insights.weekday_profile[1].typical_daily_visits, 400); // first-hour check-ins have no prior reading to difference against
});

test("now comparison compares the trailing hour against the typical hour", () => {
  const rows = [
    ...counterDay("2026-08-03", FULL_DAY),
    ...counterDay("2026-08-10", FULL_DAY),
    ...counterDay("2026-08-17", FULL_DAY),
    ...counterDay("2026-08-24", FULL_DAY),
  ];
  const insights = buildInsights(rows, "2026-08-24T19:30:00Z");
  assert.ok(insights.now_comparison, "expected a now_comparison");
  assert.equal(insights.now_comparison.weekday, 0);
  assert.equal(insights.now_comparison.visits, 10); // 9:07 PM -> 10:07 PM ET: 400 -> 410
  assert.equal(insights.now_comparison.typical, 10);
});

test("parseSlotKey validates the hourly slot contract", () => {
  assert.deepEqual(parseSlotKey("4-07"), { weekday: 4, hour: 7 });
  assert.equal(parseSlotKey("7-07"), null);
  assert.equal(parseSlotKey("0-24"), null);
  assert.equal(parseSlotKey("bad"), null);
});

test("weather progress counts only reading dates with recorded weather", () => {
  const rows = [...counterDay("2026-08-03", [10, 40]), ...counterDay("2026-08-04", [20, 60]), ...counterDay("2026-08-05", [15, 50])];
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
  const rows = [...rainyDates, ...dryDates].flatMap((date, index) => counterDay(date, date.startsWith("2026-05") ? (index % 2 ? [60, 170] : [50, 150]) : index % 2 ? [30, 90] : [20, 70]));
  const weatherRows = [...rainyDates.map((local_date) => ({ local_date, precipitation_mm: 5 })), ...dryDates.map((local_date) => ({ local_date, precipitation_mm: 0 }))];
  const { correlations } = summarizeWeather(rows, weatherRows);
  assert.equal(correlations.status, "observed");
  assert.equal(correlations.condition_n, 20);
  assert.equal(correlations.comparison_n, 20);
  assert.ok(Math.abs(correlations.effect - 50) < 0.001); // rainy days average ~105 visits vs ~55 on dry days
  assert.ok(correlations.confidence_low < correlations.effect && correlations.confidence_high > correlations.effect);
});

test("buildInsights exposes real weather progress instead of a hardcoded unavailable state", () => {
  const rows = [...counterDay("2026-08-03", [10, 40]), ...counterDay("2026-08-04", [20, 60])];
  const insights = buildInsights(rows, "2026-08-24T12:00:00Z", [{ local_date: "2026-08-03", precipitation_mm: 3 }, { local_date: "2026-08-04", precipitation_mm: 0 }]);
  assert.equal(insights.weather_progress.status, "collecting");
  assert.equal(insights.factor_context.weather_progress.rainy_dates, 1);
});

test("emits the public CSV contract", () => {
  assert.equal(toCsv([{ timestamp_utc: "2026-08-17T22:01:00Z", occupancy: 20, status: "light" }]), "timestamp_utc,occupancy,status\n2026-08-17T22:01:00Z,20,light\n");
});

test("todayPlan helper is exported and stable", () => {
  const rows = counterDay("2026-08-24", [10, 30, 20, 45]);
  const grouped = new Map();
  for (const row of hourlyVisits(rows)) {
    const slot = row.weekday + "-" + String(row.hour).padStart(2, "0");
    const perSlot = grouped.get(slot) || new Map();
    perSlot.set(row.date, (perSlot.get(row.date) || 0) + row.visits);
    grouped.set(slot, perSlot);
  }
  const baselines = {};
  for (const [slot, dates] of grouped) baselines[slot] = { median: medianOf([...dates.values()]), n: [...dates.values()].length };
  function medianOf(values) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
  const plan = todayPlan(grouped, baselines, "2026-08-24T19:30:00Z");
  assert.equal(plan.items.every((item) => item.expected_rate >= 0), true);
});

test("weekdayProfile helper handles empty input", () => {
  assert.deepEqual(weekdayProfile(new Map()), []);
});
