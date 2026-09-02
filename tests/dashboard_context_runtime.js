// Runs the dashboard script in a bare VM with a stub DOM, then checks the pure
// view model against synthetic readings. Fails loudly (assert) on any drift.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor() { this.children = []; this.hidden = false; this.textContent = ""; this.className = ""; this.style = { setProperty() {} }; this.classList = { add() {} }; }
  append(...items) { this.children.push(...items); this.textContent += items.map((item) => (typeof item === "string" ? item : item.textContent || "")).join(""); }
  replaceChildren(...items) { this.children = []; this.textContent = ""; this.append(...items); }
  setAttribute() {}
  removeAttribute() {}
  querySelector() { return new Element(); }
}
const elements = new Map();
const page = fs.readFileSync("docs/index.html", "utf8");
const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
const context = {
  URL, URLSearchParams, Date, Intl, Math, Number, Object, Array, Boolean, String, RegExp, Promise, Set, Map, JSON, console,
  location: { search: "" },
  document: {
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: () => new Element(),
    createElementNS: () => new Element(),
    createTextNode: (text) => String(text),
  },
  fetch: async () => ({ ok: false, text: async () => "" }),
};
context.globalThis = context;
vm.runInNewContext(script, context);
const api = context.__CROWD_DESK_V2__;
assert.ok(api && typeof api.buildViewModel === "function", "buildViewModel must be exposed");

// ---- synthetic record: three weeks, every 10 minutes, New York time ----
// Hourly walk-in profile by hour of day; the counter is cumulative per day.
const PROFILE = { 5: 12, 6: 60, 7: 100, 8: 55, 9: 40, 10: 45, 11: 35, 12: 50, 13: 30, 14: 28, 15: 33, 16: 50, 17: 95, 18: 110, 19: 80, 20: 40, 21: 25, 22: 20 };
const OPEN = [[5, 23], [5, 23], [5, 23], [5, 23], [5, 22], [7, 21], [8, 21]];
function offsetForNY(dateKey) { return "-04:00"; } // all synthetic dates fall in EDT
function makeReadings(fromKey, days, until) {
  const rows = [];
  const start = new Date(`${fromKey}T00:00:00${offsetForNY(fromKey)}`);
  for (let d = 0; d < days; d += 1) {
    const day = new Date(start.getTime() + d * 86400000);
    const key = day.toISOString().slice(0, 10);
    const weekday = (day.getUTCDay() + 6) % 7; // Mon = 0, using UTC midnight-4h anchoring
    const [o, c] = OPEN[weekday];
    let total = 0;
    for (let minute = o * 60; minute < c * 60; minute += 10) {
      const hour = Math.floor(minute / 60);
      total += Math.round((PROFILE[hour] || 10) / 6);
      const ts = new Date(`${key}T${String(hour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00${offsetForNY(key)}`);
      if (until && ts > until) break;
      rows.push({ date: ts, occupancy: total, status: "active" });
    }
  }
  return rows;
}

// CSV parsing
const csv = ["timestamp_utc,occupancy,status", "2026-08-17T09:07:51Z,5,active", "2026-08-17T09:17:51Z,9,active"].join("\n");
const parsed = api.parseCSV(csv);
assert.equal(parsed.length, 2);
assert.equal(parsed[1].occupancy, 9);
assert.equal(api.parseCSV("timestamp_utc,occupancy,status\nbad,1,active"), null);
assert.equal(api.parseCSV("nope"), null);

// Open, Tuesday 6:20 PM New York on 2026-09-01, with three prior Tuesdays on record.
const openNow = new Date("2026-09-01T22:20:00Z");
const readings = makeReadings("2026-08-10", 23, openNow);
const open = api.buildViewModel(readings, {}, openNow);
assert.equal(open.status, "open");
assert.equal(open.clock.weekdayIndex, 1);
assert.equal(open.clock.hour, 18);
assert.ok(open.pick, "an open gym with history must produce a pick");
assert.equal(open.pick.hour, 22, "quietest remaining hour follows the profile");
assert.ok(open.pick.n >= 3, "pick evidence counts prior Tuesdays only");
assert.equal(open.weekdayDates, 3);
assert.equal(open.lastHour, 17);
assert.ok(open.lastVisits > 0 && open.lastTypical && open.lastTypical.median > 0);
assert.ok(open.todayHours.find((h) => h.hour === 18).visits !== null, "in-progress hour carries partial visits");
assert.equal(open.todayHours.find((h) => h.hour === 19).visits, null, "future hours are not filled in");

// Dayparts: one row per part of the open day, passed parts flagged, best hour in each.
assert.equal(JSON.stringify(open.dayparts.map((d) => d.label)), JSON.stringify(["Early", "Morning", "Midday", "Afternoon", "Evening", "Late"]));
assert.equal(JSON.stringify(open.dayparts.map((d) => d.passed)), JSON.stringify([true, true, true, true, false, false]));
assert.equal(open.dayparts.find((d) => d.label === "Late").best.hour, 22);
assert.equal(open.dayparts.find((d) => d.label === "Afternoon").best.hour, 14);
assert.equal(open.dayparts.find((d) => d.label === "Evening").current, true);

// Weekday summary skips the opening hour so 5 AM is not the answer every day.
const tue = open.weekdaySummary.find((r) => r.weekdayIndex === 1);
assert.ok(tue, "Tuesday appears in the weekday summary");
assert.notEqual(tue.quiet.hour, 5, "opening hour is left out of quietest");
assert.equal(tue.quiet.hour, 22);
assert.equal(tue.busy.hour, 18);
const sat = open.weekdaySummary.find((r) => r.weekdayIndex === 5);
assert.notEqual(sat.quiet.hour, 7, "Saturday opening hour (7 AM) is left out too");

// Week heatmap: closed hours are blank, open hours carry medians, range is finite.
assert.ok(Number.isFinite(open.weekMin) && Number.isFinite(open.weekMax) && open.weekMax > open.weekMin);
const sunday = open.week[6];
assert.equal(sunday.cells.find((c) => c.hour === 5).closed, true);
assert.equal(sunday.cells.find((c) => c.hour === 9).closed, false);

// Closed, Wednesday 3 AM: recap yesterday, point at today's later picks, no pick.
const closedNow = new Date("2026-09-02T07:00:00Z");
const closed = api.buildViewModel(makeReadings("2026-08-10", 23, closedNow), {}, closedNow);
assert.equal(closed.status, "pre-open");
assert.equal(closed.pick, null);
assert.equal(closed.planWeekday, 2);
assert.ok(closed.dayparts.every((d) => !d.passed));
assert.ok(closed.dayparts.some((d) => d.best && d.best.hour !== 5), "later parts of the day have their own best hour");

// After close, Tuesday 11:30 PM: status closed, tomorrow's weekday is planned.
const lateNow = new Date("2026-09-02T03:30:00Z");
const late = api.buildViewModel(makeReadings("2026-08-10", 23, lateNow), {}, lateNow);
assert.equal(late.status, "closed");
assert.equal(late.nextWeekday, 2);
assert.equal(late.planWeekday, 2);
assert.ok(late.todayTotal > 0, "closed state recaps today's total");

// Unavailable data path renders the explicit empty state without throwing.
const unavailableIds = ["headline", "chart-empty", "heat-empty", "parts-empty", "days-empty"];
unavailableIds.forEach((id) => elements.set(id, new Element()));
setTimeout(() => {
  assert.match(elements.get("headline").textContent, /couldn’t load/);
  assert.equal(elements.get("parts-empty").hidden, false);
  console.log("dashboard runtime contracts: ok");
}, 20);
