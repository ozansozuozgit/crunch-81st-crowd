const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor() { this.children = []; this.hidden = false; this.textContent = ""; this.className = ""; }
  append(...items) { this.children.push(...items); this.textContent += items.map((item) => typeof item === "string" ? item : item.textContent || "").join(""); }
  replaceChildren(...items) { this.children = []; this.textContent = ""; this.append(...items); }
  setAttribute() {}
  querySelector() { return new Element(); }
}

const ids = [
  "latest-count", "latest-unit", "latest-time", "now-delta", "signal-state", "signal-copy",
  "chart-period", "chart-empty", "chart-caption", "heatmap-empty", "heatmap",
  "verdict-line", "verdict-sub",
  "stat-now", "stat-now-note", "stat-peak", "stat-peak-note", "stat-quiet", "stat-quiet-note",
  "today-list", "today-empty", "today-caption", "today-mode",
  "quiet-list", "quiet-empty", "stability-strip", "stability-empty", "day-strip", "day-empty",
  "factor-weather", "factor-holidays", "updated-at", "announce",
];
const elements = new Map(ids.map((id) => [id, new Element()]));
const page = fs.readFileSync("docs/index.html", "utf8");
const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
const hooks = {};
const context = {
  URL, Date, Intl, Math, Number, Object, Array, Boolean, String, RegExp, Promise, console,
  __CROWD_DESK_TEST_HOOKS__: hooks,
  document: {
    getElementById: (id) => elements.get(id),
    createElement: () => new Element(),
    createElementNS: () => new Element(),
    createTextNode: (text) => String(text),
  },
  fetch: async () => ({ ok: false, text: async () => "" }),
};
context.globalThis = context;
vm.runInNewContext(script, context);

const readyInsights = {
  baselines: { "0-18:00": { median: 25, n: 4 } },
  today_plan: { status: "ready", local_date: "2026-08-24", items: [{ slot: "0-18:00", expected_occupancy: 25, independent_dates: 4 }] },
  weekday_profile: [{ weekday_index: 5, weekday: "Sat", typical_daily_occupancy: 274, independent_dates: 2 }],
  quiet_window_details: { status: "ready", items: [{ slot: "0-18:00", baseline_occupancy: 25, independent_dates: 4, independent_weeks: 2, spread: 10 }] },
  monthly_stability: { status: "ready", items: [{ slot: "0-18:00", independent_weeks: 2, week_spread: 8 }] },
  factor_context: { holiday_dates: 1, non_holiday_dates: 8, weather_progress: { status: "collecting", rainy_dates: 2, dry_dates: 3, required_dates_per_group: 20 } },
  correlations: { status: "insufficient_data" },
};

const details = hooks.validQuietDetails(readyInsights);
assert.equal(details.length, 1);
assert.equal(details[0].spread, 10);
assert.equal(hooks.validQuietDetails({ quiet_window_details: { status: "ready", items: [{ ...readyInsights.quiet_window_details.items[0], independent_weeks: 0 }] } }).length, 0);
assert.equal(hooks.validQuietDetails({ quiet_window_details: { status: "ready", items: [{ ...readyInsights.quiet_window_details.items[0], baseline_occupancy: "25" }] } }).length, 0);

hooks.renderQuietPlanner(readyInsights);
assert.equal(elements.get("quiet-empty").hidden, true);
assert.match(elements.get("quiet-list").textContent, /days of data/);
hooks.renderQuietPlanner({ quiet_window_details: { status: "insufficient_data", items: [] }, recommendation_progress: { status: "collecting", matching_dates: 3, required_dates: 4 } });
assert.match(elements.get("quiet-empty").textContent, /3 of 4 days needed/);
assert.equal(elements.get("quiet-list").children.length, 0);

const plan = hooks.validTodayPlan(readyInsights);
assert.equal(plan.status, "ready");
assert.equal(plan.items.length, 1);
assert.equal(plan.items[0].label, "Mon · 18:00–19:00 ET");
assert.equal(hooks.validTodayPlan({ today_plan: { ...readyInsights.today_plan, items: [{ ...readyInsights.today_plan.items[0], expected_occupancy: "25" }] } }), null);
hooks.renderTodayPlan(readyInsights);
assert.equal(elements.get("today-empty").hidden, true);
assert.match(elements.get("today-list").textContent, /based on 4 days of data/);
hooks.renderTodayPlan({ today_plan: { status: "closed", local_date: "2026-08-24", items: [] } });
assert.match(elements.get("today-empty").textContent, /closed/i);
hooks.renderTodayPlan({ today_plan: { status: "provisional", local_date: "2026-08-24", items: [{ slot: "0-18:00", expected_occupancy: 25, independent_dates: 2 }] } });
assert.match(elements.get("today-mode").textContent, /Early data/);
assert.match(elements.get("today-caption").textContent, /fewer than 4 days/);

const profile = hooks.validWeekdayProfile(readyInsights);
assert.equal(profile.length, 1);
assert.equal(profile[0].typical, 274);
assert.equal(hooks.validWeekdayProfile({ weekday_profile: [{ weekday_index: 5, weekday: "Mon", typical_daily_occupancy: 274, independent_dates: 2 }] }).length, 0);
hooks.renderVerdict(null, readyInsights);
assert.match(elements.get("verdict-line").textContent, /Go around 6–7 PM/);
assert.match(elements.get("verdict-sub").textContent, /about 25 people/);
hooks.renderVerdict(null, { today_plan: { status: "closed", local_date: "2026-08-24", items: [] } });
assert.match(elements.get("verdict-line").textContent, /closed right now/i);

hooks.renderDayStrip(readyInsights);
assert.equal(elements.get("day-empty").hidden, true);
assert.match(elements.get("day-strip").textContent, /usually about 274 people/);
hooks.renderDayStrip({ weekday_profile: [] });
assert.equal(elements.get("day-empty").hidden, false);

assert.equal(hooks.validBaselineFor(readyInsights, "0-18:00").median, 25);
assert.equal(hooks.validBaselineFor(readyInsights, "1-18:00"), null);
assert.equal(hooks.validBaselineFor({ baselines: { "0-18:00": { median: 25, n: 1 } } }, "0-18:00"), null);
const reading = { occupancy: 30, date: new Date("2026-08-24T18:02:00-04:00") };
hooks.renderNowDelta([reading], readyInsights);
assert.equal(elements.get("now-delta").hidden, false);
assert.match(elements.get("now-delta").textContent, /\+20% vs typical/);
hooks.renderNowDelta([reading], { baselines: {} });
assert.equal(elements.get("now-delta").hidden, true);

hooks.renderStatChips([reading], readyInsights);
assert.equal(elements.get("stat-now").textContent, "+20%");
assert.equal(elements.get("stat-peak").textContent, "30");
assert.equal(elements.get("stat-quiet").textContent, "25");

const stability = hooks.validMonthlyStability(readyInsights, details);
assert.equal(stability.length, 1);
assert.equal(hooks.validMonthlyStability({ ...readyInsights, monthly_stability: { status: "ready", items: [{ slot: "1-18:00", independent_weeks: 2, week_spread: 8 }] } }, details).length, 0);
hooks.renderMonthlyStability(readyInsights);
assert.match(elements.get("stability-strip").textContent, /between weeks/);
assert.match(elements.get("stability-strip").textContent, /weeks of data/);

assert.equal(hooks.validFactorContext(readyInsights).holidayDates, 1);
assert.equal(hooks.validFactorContext({ factor_context: { ...readyInsights.factor_context, holiday_dates: "1" } }), null);
assert.equal(hooks.validFactorContext({ factor_context: { ...readyInsights.factor_context, weather_progress: { ...readyInsights.factor_context.weather_progress, rainy_dates: "2" } } }), null);
hooks.renderFactors(readyInsights);
assert.match(elements.get("factor-weather").textContent, /Rainy days recorded: 2 of 20/);
assert.match(elements.get("factor-holidays").textContent, /Recorded so far: 1 holiday day/);

const weatherUnavailable = {
  ...readyInsights,
  factor_context: {
    ...readyInsights.factor_context,
    weather_progress: { status: "unavailable", rainy_dates: 0, dry_dates: 0, required_dates_per_group: 20 },
  },
};
assert.equal(hooks.validFactorContext(weatherUnavailable).weather.status, "unavailable");
hooks.renderFactors(weatherUnavailable);
assert.match(elements.get("factor-weather").textContent, /rain comparison comes once 20 rainy/);
assert.match(elements.get("factor-holidays").textContent, /Recorded so far: 1 holiday day/);

hooks.renderUnavailable();
assert.equal(elements.get("quiet-list").children.length, 0);
assert.equal(elements.get("stability-strip").children.length, 0);
assert.equal(elements.get("now-delta").hidden, true);
assert.equal(elements.get("stat-now").textContent, "—");
assert.equal(elements.get("stat-quiet").textContent, "—");

console.log("dashboard runtime contracts OK");
