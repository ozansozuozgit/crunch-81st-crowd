const CRUNCH_URL = "https://www.crunch.com/locations/e-81st-st";
const BOOTSTRAP_CSV_URL = "https://ozansozuozgit.github.io/crunch-81st-crowd/data/readings.csv";
const PAGES_ORIGIN = "https://ozansozuozgit.github.io";
const NEW_YORK = "America/New_York";
const QUIET_DATES = 4;
const HOURS = [[5 * 60, 23 * 60], [5 * 60, 23 * 60], [5 * 60, 23 * 60], [5 * 60, 23 * 60], [5 * 60, 22 * 60], [7 * 60, 21 * 60], [8 * 60, 21 * 60]];
const partsFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: NEW_YORK, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function htmlDecode(value) {
  return value.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export function parseClubRecord(page) {
  const match = typeof page === "string" && page.match(/data-react-props="([^"]*)"/);
  if (!match) throw new Error("missing data-react-props");
  let club;
  try { club = JSON.parse(htmlDecode(match[1])).club; } catch { throw new Error("invalid club record"); }
  const occupancy = club?.current_occupancy;
  const status = club?.occupancy_status;
  if (!Number.isInteger(occupancy) || occupancy < 0 || typeof status !== "string" || !status.trim()) throw new Error("invalid club record");
  return { occupancy, status: status.trim() };
}

function localParts(timestamp) {
  const date = new Date(timestamp);
  const values = Object.fromEntries(partsFormatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const weekday = dayNames.indexOf(values.weekday);
  return { date: values.year + "-" + values.month + "-" + values.day, weekday, hour: Number(values.hour), minute: Number(values.minute) };
}

function slotFor(timestamp) {
  const local = localParts(timestamp);
  return local.weekday + "-" + String(local.hour).padStart(2, "0") + ":" + String(local.minute - (local.minute % 10)).padStart(2, "0");
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isoWeek(localDate) {
  const date = new Date(localDate + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return date.getUTCFullYear() + "-" + String(Math.ceil((((date - yearStart) / 86400000) + 1) / 7)).padStart(2, "0");
}

function holiday(dateString) {
  const date = new Date(dateString + "T12:00:00Z");
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();
  const same = (candidate) => candidate.getUTCFullYear() === year && candidate.getUTCMonth() + 1 === month && candidate.getUTCDate() === day;
  const observed = (candidate) => {
    const copy = new Date(candidate);
    if (copy.getUTCDay() === 6) copy.setUTCDate(copy.getUTCDate() - 1);
    if (copy.getUTCDay() === 0) copy.setUTCDate(copy.getUTCDate() + 1);
    return copy;
  };
  const fixed = [new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year, 6, 4)), new Date(Date.UTC(year, 10, 11)), new Date(Date.UTC(year, 11, 25))];
  if (year >= 2021) fixed.push(new Date(Date.UTC(year, 5, 19)));
  if (fixed.some((candidate) => same(candidate) || same(observed(candidate)))) return true;
  const nth = (m, target, count) => { const d = new Date(Date.UTC(year, m - 1, 1)); d.setUTCDate(1 + ((target - d.getUTCDay() + 7) % 7) + (count - 1) * 7); return d; };
  const last = (m, target) => { const d = new Date(Date.UTC(year, m, 0)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - target + 7) % 7)); return d; };
  return [nth(1, 1, 3), nth(2, 1, 3), last(5, 1), nth(9, 1, 1), nth(10, 1, 2), nth(11, 4, 4)].some(same);
}

function groupDaily(rows) {
  const result = new Map();
  for (const row of rows) {
    const slot = slotFor(row.timestamp_utc);
    const date = localParts(row.timestamp_utc).date;
    const perSlot = result.get(slot) || new Map();
    const values = perSlot.get(date) || [];
    values.push(row.occupancy);
    perSlot.set(date, values);
    result.set(slot, perSlot);
  }
  return result;
}

export function buildInsights(rows, generatedAt = new Date().toISOString()) {
  const grouped = groupDaily(rows);
  const baselines = {};
  const candidates = [];
  let matchingDates = 0;
  for (const [slot, dates] of grouped) {
    const daily = [...dates.entries()].map(([date, values]) => [date, values.reduce((sum, value) => sum + value, 0) / values.length]);
    matchingDates = Math.max(matchingDates, daily.length);
    const allValues = daily.map(([, value]) => value);
    baselines[slot] = { median: median(allValues), n: allValues.length };
    if (daily.length < QUIET_DATES) continue;
    const weekValues = new Map();
    for (const [date, value] of daily) {
      const week = isoWeek(date);
      const values = weekValues.get(week) || [];
      values.push(value);
      weekValues.set(week, values);
    }
    const weekly = [...weekValues.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
    candidates.push({ slot, baseline_occupancy: median(allValues), independent_dates: daily.length, independent_weeks: weekly.length, spread: Math.max(...allValues) - Math.min(...allValues), week_spread: Math.max(...weekly) - Math.min(...weekly) });
  }
  candidates.sort((a, b) => a.baseline_occupancy - b.baseline_occupancy || a.slot.localeCompare(b.slot));
  const items = candidates.slice(0, 5);
  const distinctDates = new Set(rows.map((row) => localParts(row.timestamp_utc).date));
  const holidayDates = [...distinctDates].filter(holiday).length;
  const ready = items.length > 0;
  return {
    generated_at: generatedAt,
    latest: rows.at(-1) || null,
    baselines,
    recommendations: items.map(({ slot, baseline_occupancy, independent_dates }) => ({ slot, baseline_occupancy, independent_dates })),
    recommendations_status: ready ? "ready" : "insufficient_data",
    recommendation_progress: { matching_dates: matchingDates, required_dates: QUIET_DATES, status: matchingDates >= QUIET_DATES ? "ready" : "collecting" },
    quiet_window_details: { status: ready ? "ready" : "insufficient_data", items: items.map(({ week_spread, ...item }) => item) },
    monthly_stability: { status: ready ? "ready" : "insufficient_data", items: items.map(({ slot, independent_weeks, week_spread }) => ({ slot, independent_weeks, week_spread })) },
    correlations: { status: "insufficient_data" },
    weather_progress: { status: "unavailable", rainy_dates: 0, dry_dates: 0, required_dates_per_group: 20 },
    factor_context: { holiday_dates: holidayDates, non_holiday_dates: distinctDates.size - holidayDates, weather_progress: { status: "unavailable", rainy_dates: 0, dry_dates: 0, required_dates_per_group: 20 }, class_schedule_status: "unavailable" },
    class_schedule: { status: "unavailable" },
    class_annotations: { status: "unavailable", items: [] },
  };
}

export function toCsv(rows) {
  return "timestamp_utc,occupancy,status\n" + rows.map((row) => row.timestamp_utc + "," + row.occupancy + "," + row.status).join("\n") + (rows.length ? "\n" : "");
}

function responseJson(request, value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...cors(request) } });
}
function cors(request) {
  return request.headers.get("Origin") === PAGES_ORIGIN ? { "access-control-allow-origin": PAGES_ORIGIN, "vary": "Origin" } : {};
}
function validCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines[0] !== "timestamp_utc,occupancy,status") return [];
  return lines.slice(1).map((line) => {
    const [timestamp_utc, occupancy, status, extra] = line.split(",");
    const count = Number(occupancy);
    return !extra && /^\d{4}-\d\d-\d\dT/.test(timestamp_utc) && Number.isInteger(count) && count >= 0 && status ? { timestamp_utc, occupancy: count, status } : null;
  }).filter(Boolean);
}
async function rowsFor(env, days = 90) {
  const since = new Date(Date.now() - days * 86400000).toISOString().replace(".000", "");
  const { results } = await env.DB.prepare("SELECT timestamp_utc, occupancy, status FROM readings WHERE timestamp_utc >= ? ORDER BY timestamp_utc").bind(since).all();
  return results;
}
async function bootstrap(env) {
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM readings").first();
  if (Number(count.n) > 0) return;
  const response = await fetch(BOOTSTRAP_CSV_URL, { headers: { "user-agent": "crunch-81st-cloudflare-collector/1.0" } });
  if (!response.ok) throw new Error("bootstrap CSV unavailable");
  const records = validCsv(await response.text());
  for (let offset = 0; offset < records.length; offset += 500) {
    await env.DB.batch(records.slice(offset, offset + 500).map((row) => env.DB.prepare("INSERT OR IGNORE INTO readings (timestamp_utc, occupancy, status) VALUES (?, ?, ?)").bind(row.timestamp_utc, row.occupancy, row.status)));
  }
}
async function collect(env, now = new Date()) {
  const local = localParts(now.toISOString());
  const [opens, closes] = HOURS[local.weekday];
  if (local.hour * 60 + local.minute < opens || local.hour * 60 + local.minute >= closes) return { status: "closed" };
  await bootstrap(env);
  const response = await fetch(CRUNCH_URL, { headers: { "user-agent": "crunch-81st-cloudflare-collector/1.0" } });
  if (!response.ok) throw new Error("Crunch returned " + response.status);
  const record = parseClubRecord(await response.text());
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  await env.DB.prepare("INSERT OR IGNORE INTO readings (timestamp_utc, occupancy, status) VALUES (?, ?, ?)").bind(timestamp, record.occupancy, record.status).run();
  await env.DB.prepare("INSERT INTO collector_state (key, value) VALUES ('last_success', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(timestamp).run();
  return { status: "recorded", timestamp, ...record };
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(collect(env).catch(async (error) => {
      await env.DB.prepare("INSERT INTO collector_state (key, value) VALUES ('last_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(error).slice(0, 240)).run();
      throw error;
    }));
  },
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(request) });
    const url = new URL(request.url);
    if (url.pathname === "/internal/bootstrap" && request.method === "POST") {
      if (!env.ADMIN_KEY || request.headers.get("authorization") !== "Bearer " + env.ADMIN_KEY) {
        return responseJson(request, { error: "not found" }, 404);
      }
      await bootstrap(env);
      return responseJson(request, { status: "bootstrapped" });
    }
    if (request.method !== "GET") return responseJson(request, { error: "not found" }, 404);
    if (url.pathname === "/health") {
      const { results } = await env.DB.prepare("SELECT key, value FROM collector_state").all();
      return responseJson(request, { status: "ok", state: Object.fromEntries(results.map((row) => [row.key, row.value])) });
    }
    const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days") || 90)));
    const rows = await rowsFor(env, Number.isInteger(days) ? days : 90);
    if (url.pathname === "/v1/readings.csv") return new Response(toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", ...cors(request) } });
    if (url.pathname === "/v1/insights.json") return responseJson(request, buildInsights(rows));
    return responseJson(request, { error: "not found" }, 404);
  },
};
