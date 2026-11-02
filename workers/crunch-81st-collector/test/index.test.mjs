import assert from "node:assert/strict";
import test from "node:test";

import { archiveReadings, buildInsights, completeDayTotals, hourlyVisits, parseClubRecord, parseSlotKey, recordWeather, summarizeWeather, toCsv, todayPlan, weekdayProfile } from "../src/index.js";

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
  assert.equal(quietest.slot, "0-21"); // 9 PM: quietest usable hour
  assert.equal(quietest.expected_rate, 15);
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

// A day read from opening to close (EDT dates): 7 minutes after open, then
// 3 minutes before close, with the counter at the day's total.
const OPEN_MINUTES = [[300, 1380], [300, 1380], [300, 1380], [300, 1380], [300, 1320], [420, 1260], [480, 1260]];
function wholeDay(date, total) {
  const weekday = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
  const [opens, closes] = OPEN_MINUTES[weekday];
  const at = (minute) => new Date(Date.parse(date + "T00:00:00-04:00") + minute * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return [{ timestamp_utc: at(opens + 7), occupancy: 5, status: "light" }, { timestamp_utc: at(closes - 3), occupancy: total, status: "active" }];
}
const dayAfter = (date, days) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);

test("complete day totals keep only days read from opening to close", () => {
  const rows = [...wholeDay("2026-08-03", 900), ...counterDay("2026-08-04", [10, 40])];
  const totals = completeDayTotals(rows);
  assert.deepEqual([...totals.keys()], ["2026-08-03"]);
  assert.deepEqual(totals.get("2026-08-03"), { weekday: 0, total: 900 });
});

test("weather progress counts only complete days with recorded weather", () => {
  const rows = [...wholeDay("2026-08-03", 900), ...wholeDay("2026-08-04", 950), ...wholeDay("2026-08-05", 880), ...counterDay("2026-08-06", [10, 40])];
  const weatherRows = [
    { local_date: "2026-08-03", precipitation_mm: 0 },
    { local_date: "2026-08-04", precipitation_mm: 4.2 },
    { local_date: "2026-08-05", precipitation_mm: null },
    { local_date: "2026-08-06", precipitation_mm: 9 },
  ];
  const { progress, rain } = summarizeWeather(rows, weatherRows);
  assert.equal(progress.status, "collecting");
  assert.equal(progress.rainy_dates, 1);
  assert.equal(progress.dry_dates, 1);
  assert.equal(progress.required_dates_per_group, 8);
  assert.equal(rain.status, "insufficient_data");
});

test("rain comparison measures each day against its own weekday", () => {
  // Rainy days fall on quiet Sundays, dry days on busy Mondays: raw totals differ
  // by half, but against their own weekday neither group is busier.
  const rows = [];
  const weatherRows = [];
  for (let week = 0; week < 10; week += 1) {
    const monday = dayAfter("2026-06-01", week * 7);
    const sunday = dayAfter(monday, 6);
    const wobble = week % 2 ? 1.1 : 0.9;
    rows.push(...wholeDay(monday, Math.round(1000 * wobble)), ...wholeDay(sunday, Math.round(500 * wobble)));
    weatherRows.push({ local_date: monday, precipitation_mm: 0 }, { local_date: sunday, precipitation_mm: 6 });
  }
  const { progress, rain } = summarizeWeather(rows, weatherRows);
  assert.equal(progress.status, "eligible");
  assert.equal(rain.status, "observed");
  assert.equal(rain.unit, "share_of_weekday_normal");
  assert.equal(rain.condition_n, 10);
  assert.equal(rain.comparison_n, 10);
  assert.ok(Math.abs(rain.effect) < 0.001, "no difference once weekday is accounted for");
  assert.equal(rain.clear, false);
});

test("rain comparison reports a clear difference with its range", () => {
  const rows = [];
  const weatherRows = [];
  for (let week = 0; week < 10; week += 1) {
    for (let day = 0; day < 2; day += 1) {
      const date = dayAfter("2026-06-01", week * 7 + day);
      const rainy = (week + day) % 2 === 0;
      rows.push(...wholeDay(date, Math.round((rainy ? 1200 : 1000) * (week % 3 ? 1.02 : 0.98))));
      weatherRows.push({ local_date: date, precipitation_mm: rainy ? 3 : 0 });
    }
  }
  const { rain } = summarizeWeather(rows, weatherRows);
  assert.equal(rain.status, "observed");
  assert.ok(rain.effect > 0.15 && rain.effect < 0.25, "rainy days run about 20% busier");
  assert.ok(rain.confidence_low > 0 && rain.confidence_high > rain.effect);
  assert.equal(rain.clear, true);
});

test("buildInsights exposes the rain comparison and retires the raw correlation", () => {
  const rows = [...wholeDay("2026-08-03", 900), ...wholeDay("2026-08-04", 950)];
  const insights = buildInsights(rows, "2026-08-24T12:00:00Z", [{ local_date: "2026-08-03", precipitation_mm: 3 }, { local_date: "2026-08-04", precipitation_mm: 0 }]);
  assert.equal(insights.weather_progress.status, "collecting");
  assert.equal(insights.factor_context.weather_progress.rainy_dates, 1);
  assert.equal(insights.rain_comparison.status, "insufficient_data");
  assert.equal(insights.correlations.status, "superseded");
});

test("weather keeps finished days only and lets the archive overwrite the forecast", async () => {
  const writes = [];
  const state = {};
  const env = {
    DB: {
      prepare(sql) {
        return { bind: (...args) => ({ sql, args, run: async () => { if (sql.includes("collector_state")) state[args[0]] = args[1]; } }) };
      },
      batch: async (statements) => { writes.push(...statements.map((statement) => statement.args)); },
    },
  };
  const fetchImpl = fakeFetch((url) => {
    if (url.includes("archive-api")) {
      assert.match(url, /start_date=2026-07-29&end_date=2026-10-31/);
      return new Response(JSON.stringify({ daily: { time: ["2026-10-29", "2026-10-30", "2026-10-31"], precipitation_sum: [2.5, 0, null] } }));
    }
    return new Response(JSON.stringify({ daily: { time: ["2026-10-30", "2026-10-31", "2026-11-01"], precipitation_sum: [7, 1.2, 9] } }));
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    assert.deepEqual(await recordWeather(env, new Date("2026-11-02T04:11:00Z")), { status: "recorded", days: 3 });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(writes.sort(), [["2026-10-29", 2.5], ["2026-10-30", 0], ["2026-10-31", 1.2]]);
  assert.match(state.last_weather, /3 days/);
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
