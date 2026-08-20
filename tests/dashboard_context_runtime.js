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
  "latest-count", "latest-unit", "latest-time", "signal-state", "signal-copy",
  "chart-period", "chart-empty", "chart-caption", "heatmap-empty", "heatmap",
  "quiet-list", "quiet-empty", "stability-strip", "stability-empty", "factor-weather",
  "factor-holidays", "factor-schedule", "schedule-source", "schedule-context", "updated-at", "announce",
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
  quiet_window_details: { status: "ready", items: [{ slot: "0-18:00", baseline_occupancy: 25, independent_dates: 4, independent_weeks: 2, spread: 10 }] },
  monthly_stability: { status: "ready", items: [{ slot: "0-18:00", independent_weeks: 2, week_spread: 8 }] },
  factor_context: { holiday_dates: 1, non_holiday_dates: 8, weather_progress: { status: "collecting", rainy_dates: 2, dry_dates: 3, required_dates_per_group: 20 }, class_schedule_status: "fresh" },
  correlations: { status: "insufficient_data" },
  class_schedule: { status: "fresh", source_url: "https://class-prod.crunch.com/week_schedule.pdf?club_id=40", fetched_at: "2026-08-20T08:48:33Z" },
};

const details = hooks.validQuietDetails(readyInsights);
assert.equal(details.length, 1);
assert.equal(details[0].spread, 10);
assert.equal(hooks.validQuietDetails({ quiet_window_details: { status: "ready", items: [{ ...readyInsights.quiet_window_details.items[0], independent_weeks: 0 }] } }).length, 0);
assert.equal(hooks.validQuietDetails({ quiet_window_details: { status: "ready", items: [{ ...readyInsights.quiet_window_details.items[0], baseline_occupancy: "25" }] } }).length, 0);

hooks.renderQuietPlanner(readyInsights);
assert.equal(elements.get("quiet-empty").hidden, true);
assert.match(elements.get("quiet-list").textContent, /independent local dates/);
hooks.renderQuietPlanner({ quiet_window_details: { status: "insufficient_data", items: [] }, recommendation_progress: { status: "collecting", matching_dates: 3, required_dates: 4 } });
assert.match(elements.get("quiet-empty").textContent, /3 \/ 4/);
assert.equal(elements.get("quiet-list").children.length, 0);

const stability = hooks.validMonthlyStability(readyInsights, details);
assert.equal(stability.length, 1);
assert.equal(hooks.validMonthlyStability({ ...readyInsights, monthly_stability: { status: "ready", items: [{ slot: "1-18:00", independent_weeks: 2, week_spread: 8 }] } }, details).length, 0);
hooks.renderMonthlyStability(readyInsights);
assert.match(elements.get("stability-strip").textContent, /historical range/);
assert.match(elements.get("stability-strip").textContent, /independent local weeks/);

assert.equal(hooks.validFactorContext(readyInsights).holidayDates, 1);
assert.equal(hooks.validFactorContext({ factor_context: { ...readyInsights.factor_context, holiday_dates: "1" } }), null);
assert.equal(hooks.validFactorContext({ factor_context: { ...readyInsights.factor_context, weather_progress: { ...readyInsights.factor_context.weather_progress, rainy_dates: "2" } } }), null);
hooks.renderFactors(readyInsights);
assert.match(elements.get("factor-weather").textContent, /2 rainy \/ 20/);
assert.match(elements.get("factor-holidays").textContent, /1 holiday local date/);
assert.match(elements.get("factor-schedule").textContent, /fresh/);

hooks.renderScheduleContext(readyInsights);
assert.equal(elements.get("schedule-context").hidden, false);
assert.match(elements.get("schedule-source").textContent, /last verified/);
assert.equal(hooks.validClassSchedule({ class_schedule: { ...readyInsights.class_schedule, source_url: "http://class-prod.crunch.com/week_schedule.pdf" } }), null);
const stale = { ...readyInsights, class_schedule: { ...readyInsights.class_schedule, status: "stale", last_attempt_at: "2026-08-20T09:48:33Z" } };
hooks.renderScheduleContext(stale);
assert.match(elements.get("schedule-source").textContent, /retained schedule may be out of date/);

hooks.renderUnavailable();
assert.equal(elements.get("quiet-list").children.length, 0);
assert.equal(elements.get("stability-strip").children.length, 0);
assert.equal(elements.get("schedule-context").hidden, true);
