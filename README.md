# Crunch E 81st Crowd Desk

A public, measured record of the occupancy signal for Crunch E 81st St in New
York City. The dashboard is a static, quiet-workout planner in
[`docs/`](docs/), backed by a timestamped CSV rather than a claim of exact club
capacity or a forecast made from unobserved data. It presents the latest
recorded state, today against the typical day for its weekday, the calmest
stretch of hours left today, and each weekday's shape. When the history is
still too thin, it shows progress instead of a recommendation.

Weather and holidays are contextual annotations,
not causal explanations. The rain comparison measures each full day against
the median full day for its own weekday, so a rainy Sunday is never compared
with a dry Monday; independent local dates are its unit, and it reports the
likely range (the historical range of the difference), not just one number. A
clear difference is labelled “Observed association, not proof”.

## The dashboard

[`docs/index.html`](docs/index.html) is a single column: one answer for
right now (open, before opening, or closed), a ledger of the last reading,
the last full hour against normal, and the size of the record, then an
hour-by-hour chart with a "now" marker and the calmest stretch left, the best
hour in each part of the day still ahead, a weekly heatmap of open hours, and
a small chart of each weekday's shape with its calmest stretch and busiest
hour. Every number is walk-ins per hour.

A calm stretch is a run of consecutive hours within 30% (at least 10 walk-ins)
of the quietest usable hour: an hour's usual week-to-week spread is wider than
smaller differences, so the page names a stretch rather than one "best" hour.
The last hour before closing is never suggested.

Crunch updates its public counter about every 20 minutes, starting from zero at
opening. Each update is placed midway between the reading before it and the
reading that shows it, and its rise is spread evenly back to the previous
update (or to opening). This counts the first reading of the day, keeps hours
aligned with when people arrived, and spreads a collection gap over the time it
covers instead of dumping it into one hour. A pure `buildViewModel()` derives all of it from the
readings; rendering only paints. Append `?at=<ISO time>` to preview how the
page reads at another moment, using only readings up to then.

## Source and collection

Live collection runs on a Cloudflare Worker Cron and is stored in Cloudflare
D1, so it does not consume GitHub Actions credits. GitHub Pages remains the
public dashboard host and reads live data from the Worker's public read-only
endpoints. Once daily (04:11 UTC), the Worker also archives the full reading
history to [`docs/data/readings.csv`](docs/data/readings.csv) through the
GitHub contents API; this archive step is active only when a
`GITHUB_TOKEN` secret with write access to this repository is configured on
the Worker (`npx wrangler secret put GITHUB_TOKEN`). GitHub Actions remain as
an optional manual path only. Each reading comes from the public embedded club record on the official
[Crunch E 81st St location page](https://www.crunch.com/locations/e-81st-st).
The collector reads its numeric `current_occupancy` and its accompanying
`occupancy_status`; it does not use a login, secrets, a member account, or a
private Crunch endpoint. `max_occupancy` is deliberately excluded because the
published value is not treated as a reliable capacity measure.

The published counter is a **cumulative check-in total**, not a live headcount:
it starts at zero at opening, only ever rises until close, and resets overnight
(verified across every recorded day). The dashboard therefore reports
**check-ins per hour** — the difference between consecutive readings — as its
busyness signal, and treats the daily total as a measure of how busy a day
was, not of how many people were inside at once.

A Cloudflare Worker Cron requests a measurement every ten minutes at minutes **07, 17,
27, 37, 47, and 57 UTC**. The collector separately checks the club's scheduled
local opening hours, so closed periods produce no reading and no commit. It
reads once more in the 10 minutes after close to catch the counter's final
update of the day. GitHub
does not promise that scheduled workflows run at the exact requested minute;
individual readings use the actual fetch timestamp.

The dashboard shows an explicit empty state only when no valid readings exist.
Otherwise, it distinguishes measured data and insufficient evidence: a sparse
history remains visible, but it does not become a recommendation.

## Data files

- [`docs/data/readings.csv`](docs/data/readings.csv) is append-only collection
  data with `timestamp_utc` (ISO-8601 UTC timestamp), `occupancy` (the public
  numeric count), and `status` (Crunch's public occupancy label).
- The Worker's `/v1/insights.json` is built on request from the last 90 days.
  The dashboard reads its `rain_comparison`, `weather_progress` and holiday
  counts. Daily precipitation is stored for finished days only and overwritten
  with Open-Meteo's archive values once they exist, so forecasts never stand in
  for measured rain. The committed `docs/data/insights.json` is the older
  output of `scripts/analyze.py` (a manual workflow) and is not read by the page.
- [`docs/data/classes.csv`](docs/data/classes.csv) is automatically refreshed
  from Crunch's public [E 81st weekly schedule PDF](https://class-prod.crunch.com/week_schedule.pdf?button_location=web&club_id=40&options=group).
  It contains validated `weekday`, `start_local`, `end_local`, and `class_name`
  annotation rows.
- [`docs/data/classes_meta.json`](docs/data/classes_meta.json) records the
  official source and the last verified fetch time. If Crunch's PDF is
  temporarily unavailable or cannot be validated, the last known valid schedule
  is retained and explicitly marked **stale** in the dashboard rather than
  silently removed or presented as current. In that state, `fetched_at` remains
  the last verified schedule time while `last_attempt_at` records the failed
  refresh attempt.

The dashboard shows collection progress while evidence is thin: the rain
comparison needs **8 full rainy and 8 full dry local dates** (1 mm or more counts
as rainy) and then always shows its likely range, so noise is reported as "no
clear difference" instead of a finding.
Correlation is not causation, and the dashboard must not present weather or a
class as the reason attendance changed.

## Run locally

Python 3.12 or later is sufficient. The automatic schedule parser uses the
pinned dependency in `requirements.txt`.

```sh
python -m pip install --requirement requirements.txt
python scripts/collector.py
python scripts/sync_classes.py
python scripts/analyze.py
python -m unittest discover -v
```

On systems where `python` is not aliased to Python 3, replace it with
`python3`. The collector only writes during scheduled open hours; schedule
refreshes use only the public Crunch PDF, and tests use fixtures without a
Crunch login.

## Publish the dashboard

In the GitHub repository settings, enable **GitHub Pages** with **Deploy from a
branch**, choose the `main` branch, and select the `/docs` folder. The resulting
site serves `docs/index.html` and reads the committed public data files.

## Public-data warning

This repository, its history, and its GitHub Pages site are public. Anyone can
inspect, clone, or retain the recorded occupancy history. Changing the
repository to private later cannot retract copies that were already public.
