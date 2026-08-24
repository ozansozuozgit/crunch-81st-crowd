const CRUNCH_URL = "https://www.crunch.com/locations/e-81st-st";
const BOOTSTRAP_CSV_URL = "https://ozansozuozgit.github.io/crunch-81st-crowd/data/readings.csv";
const REPO = "ozansozuozgit/crunch-81st-crowd";
const CSV_PATH = "docs/data/readings.csv";
const PAGES_ORIGIN = "https://ozansozuozgit.github.io";
const NEW_YORK = "America/New_York";
const QUIET_DATES = 4;
const HOURS = [[5 * 60, 23 * 60], [5 * 60, 23 * 60], [5 * 60, 23 * 60], [5 * 60, 23 * 60], [5 * 60, 22 * 60], [7 * 60, 21 * 60], [8 * 60, 21 * 60]];
const partsFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: NEW_YORK, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ARCHIVE_CRON = "11 4 * * *";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=40.7829&longitude=-73.9654&daily=precipitation_sum&past_days=7&forecast_days=1&timezone=America%2FNew_York";

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
  return local.weekday + "-" + String(local.hour).padStart(2, "0");
}

export function parseSlotKey(slot) {
  const match = typeof slot === "string" && slot.match(/^([0-6])-(\d{2})$/);
  const hour = match ? Number(match[2]) : -1;
  return match && hour < 24 ? { weekday: Number(match[1]), hour } : null;
}

export function hourlyVisits(rows) {
  const visits = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = localParts(rows[index - 1].timestamp_utc);
    const after = localParts(rows[index].timestamp_utc);
    if (before.date !== after.date) continue;
    visits.push({ date: after.date, weekday: after.weekday, hour: after.hour, visits: Math.max(0, rows[index].occupancy - rows[index - 1].occupancy) });
  }
  return visits;
}

function groupHourly(rows) {
  const result = new Map();
  for (const row of hourlyVisits(rows)) {
    const slot = row.weekday + "-" + String(row.hour).padStart(2, "0");
    const perSlot = result.get(slot) || new Map();
    perSlot.set(row.date, (perSlot.get(row.date) || 0) + row.visits);
    result.set(slot, perSlot);
  }
  return result;
}

function recentVisits(rows, windowMinutes = 60) {
  if (!rows.length) return { visits: 0, minutes: 0, until: null };
  const until = rows[rows.length - 1];
  const cutoff = new Date(until.timestamp_utc).getTime() - windowMinutes * 60000;
  let visits = 0;
  let minutes = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const start = new Date(rows[index - 1].timestamp_utc).getTime();
    const end = new Date(rows[index].timestamp_utc).getTime();
    if (localParts(rows[index - 1].timestamp_utc).date !== localParts(rows[index].timestamp_utc).date || end <= cutoff) continue;
    const overlapStart = Math.max(start, cutoff);
    const fraction = (end - overlapStart) / Math.max(end - start, 1);
    visits += Math.max(0, rows[index].occupancy - rows[index - 1].occupancy) * fraction;
    minutes += (end - overlapStart) / 60000;
  }
  return { visits: Math.round(visits), minutes: Math.round(minutes), until: until.timestamp_utc };
}

function nowComparison(rows, baselines) {
  const recent = recentVisits(rows);
  if (!recent.until || recent.minutes < 20) return null;
  const stamp = localParts(recent.until);
  const baseline = baselines[stamp.weekday + "-" + String(stamp.hour).padStart(2, "0")];
  if (!baseline) return null;
  return { visits: recent.visits, minutes: recent.minutes, typical: Math.round(baseline.median), weekday: stamp.weekday, hour: stamp.hour };
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

export function todayPlan(grouped, baselines, generatedAt) {
  const local = localParts(generatedAt);
  const minutes = local.hour * 60 + local.minute;
  const [opens, closes] = HOURS[local.weekday];
  if (minutes < opens || minutes >= closes) return { status: "closed", local_date: local.date, items: [] };
  const items = [];
  for (const [slot, baseline] of Object.entries(baselines)) {
    const parsed = parseSlotKey(slot);
    if (!parsed || parsed.weekday !== local.weekday) continue;
    const start = parsed.hour * 60;
    if (start + 60 <= minutes || start >= closes - 60) continue; // skip hours that end within the final hour before close
    items.push({ slot, expected_rate: baseline.median, independent_dates: baseline.n });
  }
  items.sort((a, b) => a.expected_rate - b.expected_rate || a.slot.localeCompare(b.slot));
  const top = items.slice(0, 5);
  return { status: top.some((item) => item.independent_dates >= QUIET_DATES) ? "ready" : "provisional", local_date: local.date, items: top };
}

export function weekdayProfile(grouped) {
  const perWeekday = Array.from({ length: 7 }, () => new Map());
  for (const [slot, dates] of grouped) {
    const parsed = parseSlotKey(slot);
    if (!parsed) continue;
    const totals = perWeekday[parsed.weekday];
    for (const [date, visits] of dates) totals.set(date, (totals.get(date) || 0) + visits);
  }
  return perWeekday.flatMap((dates, weekday) => {
    if (!dates.size) return [];
    const dailyTotals = [...dates.values()];
    return [{ weekday_index: weekday, weekday: dayNames[weekday], typical_daily_visits: Math.round(median(dailyTotals)), independent_dates: dailyTotals.length }];
  }).sort((a, b) => a.typical_daily_visits - b.typical_daily_visits);
}

export function summarizeWeather(rows, weatherRows) {
  const precipitationByDate = new Map((weatherRows || []).filter((row) => row && typeof row.local_date === "string" && Number.isFinite(row.precipitation_mm)).map((row) => [row.local_date, row.precipitation_mm]));
  const dayTotals = new Map();
  for (const row of hourlyVisits(rows)) dayTotals.set(row.date, (dayTotals.get(row.date) || 0) + row.visits);
  let rainy = 0;
  let dry = 0;
  const rainyMeans = [];
  const dryMeans = [];
  for (const [date, total] of dayTotals) {
    const precip = precipitationByDate.get(date);
    if (precip === undefined) continue;
    if (precip >= 1) { rainy += 1; rainyMeans.push(total); } else { dry += 1; dryMeans.push(total); }
  }
  const progress = { rainy_dates: rainy, dry_dates: dry, required_dates_per_group: 20, status: rainy || dry ? "collecting" : "unavailable" };
  let correlations = { status: "insufficient_data" };
  if (rainy >= 20 && dry >= 20 && rainyMeans.length >= 2 && dryMeans.length >= 2) {
    const meanOf = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const varianceOf = (values) => { const mean = meanOf(values); return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1); };
    const effect = meanOf(rainyMeans) - meanOf(dryMeans);
    const standardError = Math.sqrt(varianceOf(rainyMeans) / rainy + varianceOf(dryMeans) / dry);
    correlations = { status: "observed", effect, condition_n: rainy, comparison_n: dry, confidence_low: effect - 1.96 * standardError, confidence_high: effect + 1.96 * standardError };
  }
  return { progress, correlations };
}

export function buildInsights(rows, generatedAt = new Date().toISOString(), weatherRows = []) {
  const grouped = groupHourly(rows);
  const baselines = {};
  const candidates = [];
  let matchingDates = 0;
  for (const [slot, dates] of grouped) {
    const entries = [...dates.entries()];
    matchingDates = Math.max(matchingDates, entries.length);
    const allValues = entries.map(([, visits]) => visits);
    baselines[slot] = { median: median(allValues), n: allValues.length };
    if (entries.length < QUIET_DATES) continue;
    const weekValues = new Map();
    for (const [date, value] of entries) {
      const week = isoWeek(date);
      const values = weekValues.get(week) || [];
      values.push(value);
      weekValues.set(week, values);
    }
    const weekly = [...weekValues.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
    candidates.push({ slot, baseline_occupancy: median(allValues), independent_dates: entries.length, independent_weeks: weekly.length, spread: Math.max(...allValues) - Math.min(...allValues), week_spread: Math.max(...weekly) - Math.min(...weekly) });
  }
  candidates.sort((a, b) => a.baseline_occupancy - b.baseline_occupancy || a.slot.localeCompare(b.slot));
  const items = candidates.slice(0, 5);
  const distinctDates = new Set(rows.map((row) => localParts(row.timestamp_utc).date));
  const holidayDates = [...distinctDates].filter(holiday).length;
  const ready = items.length > 0;
  const weather = summarizeWeather(rows, weatherRows);
  return {
    generated_at: generatedAt,
    latest: rows.at(-1) || null,
    baselines,
    now_comparison: nowComparison(rows, baselines),
    today_plan: todayPlan(grouped, baselines, generatedAt),
    weekday_profile: weekdayProfile(grouped),
    recommendations: items.map(({ slot, baseline_occupancy, independent_dates }) => ({ slot, baseline_occupancy, independent_dates })),
    recommendations_status: ready ? "ready" : "insufficient_data",
    recommendation_progress: { matching_dates: matchingDates, required_dates: QUIET_DATES, status: matchingDates >= QUIET_DATES ? "ready" : "collecting" },
    quiet_window_details: { status: ready ? "ready" : "insufficient_data", items: items.map(({ week_spread, ...item }) => item) },
    monthly_stability: { status: ready ? "ready" : "insufficient_data", items: items.map(({ slot, independent_weeks, week_spread }) => ({ slot, independent_weeks, week_spread })) },
    correlations: weather.correlations,
    weather_progress: weather.progress,
    factor_context: { holiday_dates: holidayDates, non_holiday_dates: distinctDates.size - holidayDates, weather_progress: weather.progress, class_schedule_status: "unavailable" },
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

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function setState(env, key, value) {
  return env.DB.prepare("INSERT INTO collector_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

export async function archiveReadings(env, now = new Date()) {
  if (!env.GITHUB_TOKEN) {
    await setState(env, "last_archive", "skipped: no GITHUB_TOKEN");
    return { status: "skipped" };
  }
  const headers = {
    "authorization": "Bearer " + env.GITHUB_TOKEN,
    "user-agent": "crunch-81st-cloudflare-collector/1.0",
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const api = "https://api.github.com/repos/" + REPO + "/contents/" + CSV_PATH;
  try {
    const { results } = await env.DB.prepare("SELECT timestamp_utc, occupancy, status FROM readings ORDER BY timestamp_utc").all();
    const csv = toCsv(results);
    const existing = await fetch(api, { headers });
    if (!existing.ok && existing.status !== 404) throw new Error("GitHub read returned " + existing.status);
    const current = existing.ok ? (await existing.json()) : null;
    if (current && fromBase64(current.content.replace(/\n/g, "")) === csv) {
      await setState(env, "last_archive", now.toISOString().replace(/\.\d{3}Z$/, "Z") + " unchanged");
      return { status: "unchanged" };
    }
    const committed = await fetch(api, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        message: "data: record Crunch occupancy",
        content: toBase64(csv),
        ...(current ? { sha: current.sha } : {}),
      }),
    });
    if (!committed.ok) throw new Error("GitHub write returned " + committed.status);
    const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
    await setState(env, "last_archive", stamp + " committed " + results.length + " rows");
    return { status: "committed", rows: results.length };
  } catch (error) {
    await setState(env, "last_archive", String(error).slice(0, 240));
    throw error;
  }
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

async function recordWeather(env) {
  const response = await fetch(WEATHER_URL, { headers: { "user-agent": "crunch-81st-cloudflare-collector/1.0" } });
  if (!response.ok) throw new Error("Open-Meteo returned " + response.status);
  const payload = await response.json();
  const dates = payload?.daily?.time;
  const precipitation = payload?.daily?.precipitation_sum;
  if (!Array.isArray(dates) || !Array.isArray(precipitation) || dates.length !== precipitation.length || !dates.every((date) => /^\d{4}-\d\d-\d\d$/.test(date))) {
    throw new Error("invalid weather payload");
  }
  await env.DB.batch(dates.map((date, index) => env.DB.prepare("INSERT OR IGNORE INTO daily_weather (local_date, precipitation_mm) VALUES (?, ?)").bind(date, precipitation[index])));
  return setState(env, "last_weather", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
}

export default {
  async scheduled(controller, env, ctx) {
    if (controller.cron === ARCHIVE_CRON) {
      ctx.waitUntil(archiveReadings(env));
      ctx.waitUntil(recordWeather(env).catch(async (error) => {
        await setState(env, "last_weather_error", String(error).slice(0, 240));
      }));
      return;
    }
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
    if (url.pathname === "/internal/archive" && request.method === "POST") {
      if (!env.ADMIN_KEY || request.headers.get("authorization") !== "Bearer " + env.ADMIN_KEY) {
        return responseJson(request, { error: "not found" }, 404);
      }
      const result = await archiveReadings(env);
      return responseJson(request, result);
    }
    if (url.pathname === "/internal/weather" && request.method === "POST") {
      if (!env.ADMIN_KEY || request.headers.get("authorization") !== "Bearer " + env.ADMIN_KEY) {
        return responseJson(request, { error: "not found" }, 404);
      }
      await recordWeather(env);
      return responseJson(request, { status: "weather recorded" });
    }
    if (request.method !== "GET") return responseJson(request, { error: "not found" }, 404);
    if (url.pathname === "/health") {
      const { results } = await env.DB.prepare("SELECT key, value FROM collector_state").all();
      return responseJson(request, { status: "ok", state: Object.fromEntries(results.map((row) => [row.key, row.value])) });
    }
    const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days") || 90)));
    const rows = await rowsFor(env, Number.isInteger(days) ? days : 90);
    if (url.pathname === "/v1/readings.csv") return new Response(toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", ...cors(request) } });
    if (url.pathname === "/v1/insights.json") {
      const weather = await env.DB.prepare("SELECT local_date, precipitation_mm FROM daily_weather").all();
      return responseJson(request, buildInsights(rows, undefined, weather.results));
    }
    return responseJson(request, { error: "not found" }, 404);
  },
};
