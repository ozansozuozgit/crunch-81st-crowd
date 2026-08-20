# Crunch E 81st Crowd Desk

A public, measured record of the occupancy signal for Crunch E 81st St in New
York City. The dashboard is a static, quiet-workout planner in
[`docs/`](docs/), backed by a timestamped CSV rather than a claim of exact club
capacity or a forecast made from unobserved data. It presents the latest
recorded state, the last 24 recorded hours, evidence-qualified repeatable quiet
windows, and their week-to-week stability. When the history is still too thin,
it shows progress instead of a recommendation.

Weather, holidays, and the public class schedule are contextual annotations,
not causal explanations. Where enough data exists, the dashboard labels a
weather comparison as “Observed association, not proof”; independent local
dates are its evidence threshold. The quiet-window stability view shows the
historical range.

## Source and collection

Each reading comes from the public embedded club record on the official
[Crunch E 81st St location page](https://www.crunch.com/locations/e-81st-st).
The collector reads its numeric `current_occupancy` and its accompanying
`occupancy_status`; it does not use a login, secrets, a member account, or a
private Crunch endpoint. `max_occupancy` is deliberately excluded because the
published value is not treated as a reliable capacity measure.

GitHub Actions requests a measurement every ten minutes at minutes **07, 17,
27, 37, 47, and 57 UTC**. The collector separately checks the club's scheduled
local opening hours, so closed periods produce no reading and no commit. GitHub
does not promise that scheduled workflows run at the exact requested minute;
individual readings use the actual fetch timestamp.

The dashboard shows an explicit empty state only when no valid readings exist.
Otherwise, it distinguishes measured data and insufficient evidence: a sparse
history remains visible, but it does not become a recommendation.

## Data files

- [`docs/data/readings.csv`](docs/data/readings.csv) is append-only collection
  data with `timestamp_utc` (ISO-8601 UTC timestamp), `occupancy` (the public
  numeric count), and `status` (Crunch's public occupancy label).
- [`docs/data/insights.json`](docs/data/insights.json) is regenerated daily.
  It contains the latest observation, local weekday/time-slot baselines,
  recommendations, class-schedule state, and evidence-gated weather
  associations.
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

The dashboard shows collection progress but does not lower its evidence
thresholds: a quiet time needs **four independent local dates for the same
weekday/time slot**, and weather requires **20 independent rainy and 20
independent dry local dates** before an observed association can be described.
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
