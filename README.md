# Crunch E 81st Crowd Desk

A public, measured record of the occupancy signal for Crunch E 81st St in New
York City. The dashboard is a static site in [`docs/`](docs/), backed by a
timestamped CSV rather than a claim of exact club capacity or a forecast made
from unobserved data.

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

The data set starts empty. No scheduled GitHub Action run has been observed
yet, so the dashboard intentionally shows an empty-state until collection
begins.

## Data files

- [`docs/data/readings.csv`](docs/data/readings.csv) is append-only collection
  data with `timestamp_utc` (ISO-8601 UTC timestamp), `occupancy` (the public
  numeric count), and `status` (Crunch's public occupancy label).
- [`docs/data/insights.json`](docs/data/insights.json) is regenerated daily.
  It contains the latest observation, local weekday/time-slot baselines,
  recommendations, and evidence-gated weather associations.
- [`docs/data/classes.csv`](docs/data/classes.csv) is a manually maintained
  optional class-time reference with `weekday`, `start_local`, `end_local`, and
  `class_name`.

Weather is examined only as an observed association after the analyzer has
enough independent local dates in both rainy and dry groups. Correlation is not
causation, and the dashboard must not present weather as the reason attendance
changed.

## Run locally

Python 3.12 or later is sufficient; there are no package dependencies.

```sh
python scripts/collector.py
python scripts/analyze.py
python -m unittest discover -v
```

On systems where `python` is not aliased to Python 3, replace it with
`python3`. The collector only writes during scheduled open hours; tests use
fixtures and do not need a Crunch login.

## Publish the dashboard

In the GitHub repository settings, enable **GitHub Pages** with **Deploy from a
branch**, choose the `main` branch, and select the `/docs` folder. The resulting
site serves `docs/index.html` and reads the committed public data files.

## Public-data warning

This repository, its history, and its GitHub Pages site are public. Anyone can
inspect, clone, or retain the recorded occupancy history. Changing the
repository to private later cannot retract copies that were already public.
