const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor() {
    this.children = [];
    this.hidden = false;
    this.textContent = "";
  }

  append(...items) {
    this.children.push(...items);
    this.textContent += items.map((item) => typeof item === "string" ? item : item.textContent || "").join("");
  }

  replaceChildren(...items) {
    this.children = [];
    this.textContent = "";
    this.append(...items);
  }

  setAttribute() {}
  querySelector() { return new Element(); }
}

const ids = [
  "latest-count", "latest-unit", "latest-time", "signal-state", "signal-copy",
  "chart-period", "chart-empty", "chart-caption", "heatmap-empty", "heatmap",
  "quiet-list", "quiet-empty", "class-list", "class-empty", "class-source",
  "class-note", "weather-state", "weather-copy", "updated-at", "announce",
];
const elements = new Map(ids.map((id) => [id, new Element()]));
const page = fs.readFileSync("docs/index.html", "utf8");
const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
const hooks = {};
const context = {
  URL,
  Date,
  Intl,
  Math,
  Number,
  Object,
  Array,
  Boolean,
  String,
  RegExp,
  Promise,
  console,
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

const freshSchedule = {
  class_schedule: {
    status: "fresh",
    source_url: "https://class-prod.crunch.com/week_schedule.pdf?club_id=40",
    fetched_at: "2026-08-20T08:48:33Z",
  },
  class_annotations: {
    status: "available",
    items: [{ weekday: 0, start_local: "09:00", end_local: "10:00", class_name: "Yoga" }],
  },
};

assert.equal(hooks.validClassSchedule(freshSchedule).status, "fresh");
hooks.renderClassAnnotations(freshSchedule);
assert.equal(elements.get("class-empty").hidden, true);
assert.match(elements.get("class-source").textContent, /last verified/);

const staleSchedule = {
  ...freshSchedule,
  class_schedule: { ...freshSchedule.class_schedule, status: "stale", last_attempt_at: "2026-08-20T09:48:33Z" },
};
hooks.renderClassAnnotations(staleSchedule);
assert.match(elements.get("class-source").textContent, /retained schedule may be out of date/);
assert.match(elements.get("class-source").textContent, /Refresh failed/);

for (const invalidSchedule of [
  { class_schedule: { ...freshSchedule.class_schedule, source_url: "http://class-prod.crunch.com/week_schedule.pdf" } },
  { class_schedule: { ...freshSchedule.class_schedule, source_url: "https://example.test/schedule.pdf" } },
  { class_schedule: { ...freshSchedule.class_schedule, fetched_at: "2026-08-20" } },
  { class_schedule: { ...staleSchedule.class_schedule, last_attempt_at: "2026-08-20" } },
]) {
  assert.equal(hooks.validClassSchedule(invalidSchedule), null);
}

const weatherProgress = hooks.validWeatherProgress({ weather_progress: { status: "collecting", rainy_dates: 2, dry_dates: 3, required_dates_per_group: 20 } });
assert.equal(weatherProgress.rainyDates, 2);
assert.equal(weatherProgress.dryDates, 3);
assert.equal(hooks.validWeatherProgress({ weather_progress: { status: "collecting", rainy_dates: "2", dry_dates: 3, required_dates_per_group: 20 } }), null);
hooks.renderWeather({ correlations: { status: "insufficient_data" }, weather_progress: { status: "collecting", rainy_dates: 2, dry_dates: 3, required_dates_per_group: 20 } });
assert.equal(elements.get("weather-copy").textContent, "Tracking: 2 rainy / 20 and 3 dry / 20 independent dates.");

hooks.renderQuietWindows({ recommendations_status: "insufficient_data", recommendation_progress: { status: "collecting", matching_dates: 2, required_dates: 4 } });
assert.equal(elements.get("quiet-empty").textContent, "Tracking: 2 / 4 matching weekday-time observations.");
hooks.renderQuietWindows({ recommendations_status: "insufficient_data", recommendation_progress: { status: "collecting", matching_dates: "2", required_dates: 4 } });
assert.notEqual(elements.get("quiet-empty").textContent, "Tracking: 2 / 4 matching weekday-time observations.");

hooks.renderUnavailable();
assert.equal(elements.get("weather-state").textContent, "Data unavailable");
assert.equal(elements.get("class-source").hidden, true);
