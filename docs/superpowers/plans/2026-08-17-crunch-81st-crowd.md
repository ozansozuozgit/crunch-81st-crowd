# Crunch E 81st Crowd Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a public GitHub Pages dashboard that records Crunch E 81st's public occupancy every ten minutes and reports cautious historical crowd and weather insights.

**Architecture:** A standard-library Python collector reads the public server-rendered club record and appends validated readings to a CSV. A daily analysis builds weekday/time baselines and reports weather associations only when evidence is adequate. GitHub Actions owns scheduled execution; `docs/` contains the static dashboard and its public data.

**Tech Stack:** Python 3.12 standard library, `unittest`, GitHub Actions, GitHub Pages, HTML/CSS/vanilla JavaScript, Open-Meteo historical weather API.

---

## File structure

```text
.github/workflows/collect.yml       # 10-minute collection + commit
.github/workflows/analyze.yml       # daily analysis + commit
docs/index.html                     # dashboard
docs/data/readings.csv              # append-only readings
docs/data/classes.csv               # optional class-time annotations
docs/data/insights.json             # generated baseline/association data
scripts/collector.py                # source parsing and CSV persistence
scripts/analyze.py                  # analysis and JSON output
tests/test_collector.py             # collector tests
tests/test_analyze.py               # analysis tests
README.md                           # public operation and limits
.gitignore                          # local/generated exclusions
```

### Task 1: Parse the official public source

**Files:**
- Create: `tests/test_collector.py`
- Create: `scripts/collector.py`
- Create: `.gitignore`

- [ ] **Step 1: Write the failing parser test**

```python
import unittest
from scripts.collector import parse_club_record

class ParseClubRecordTests(unittest.TestCase):
    def test_returns_numeric_occupancy_and_status_from_react_props(self):
        page = ('<div data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:34,'
                '&quot;occupancy_status&quot;:&quot;light&quot;}}"></div>')
        self.assertEqual(parse_club_record(page), (34, "light"))
```

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest tests.test_collector.ParseClubRecordTests.test_returns_numeric_occupancy_and_status_from_react_props -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.collector'`.

- [ ] **Step 3: Implement the minimal parser**

```python
import html
import json
import re

def parse_club_record(page: str) -> tuple[int, str]:
    match = re.search(r'data-react-props="([^"]+)"', page)
    if match is None:
        raise ValueError("Crunch club record was not found")
    club = json.loads(html.unescape(match.group(1)))["club"]
    occupancy, status = club["current_occupancy"], club["occupancy_status"]
    if isinstance(occupancy, bool) or not isinstance(occupancy, int) or occupancy < 0:
        raise ValueError("Crunch occupancy was not a non-negative integer")
    if not isinstance(status, str) or not status:
        raise ValueError("Crunch occupancy status was invalid")
    return occupancy, status
```

- [ ] **Step 4: Add invalid-source coverage, run GREEN, commit**

Add tests that missing source and `current_occupancy: -1` raise `ValueError`. Run `python3 -m unittest tests.test_collector -v`; expected PASS. Then:

```bash
git add scripts/collector.py tests/test_collector.py .gitignore
git commit -m "feat: parse public Crunch occupancy"
```

### Task 2: Persist only valid, non-duplicate open-hour observations

**Files:**
- Modify: `tests/test_collector.py`
- Modify: `scripts/collector.py`
- Create: `docs/data/readings.csv`

- [ ] **Step 1: Write the failing persistence test**

```python
from pathlib import Path
from tempfile import TemporaryDirectory
from scripts.collector import append_reading

def test_appends_a_reading_once_per_timestamp(self):
    with TemporaryDirectory() as directory:
        target = Path(directory) / "readings.csv"
        self.assertTrue(append_reading(target, "2026-08-17T12:07:00Z", 34, "light"))
        self.assertFalse(append_reading(target, "2026-08-17T12:07:00Z", 34, "light"))
        self.assertEqual(target.read_text().splitlines(), [
            "timestamp_utc,occupancy,status",
            "2026-08-17T12:07:00Z,34,light",
        ])
```

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest tests.test_collector -v`

Expected: FAIL because `append_reading` is not defined.

- [ ] **Step 3: Implement persistence and collection**

Implement `append_reading(path, timestamp_utc, occupancy, status)` with `csv.DictReader`/`DictWriter`, a header on first write, and timestamp de-duplication. Add:

```python
SOURCE_URL = "https://www.crunch.com/locations/e-81st-st"

def collect(now, fetcher, target):
    if not is_scheduled_open(now):
        return False
    occupancy, status = parse_club_record(fetcher(SOURCE_URL))
    stamp = now.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return append_reading(target, stamp, occupancy, status)
```

`main()` must fetch through `urllib.request.urlopen` with a 20-second timeout and descriptive User-Agent, write `docs/data/readings.csv`, print `recorded` or `unchanged`, and exit non-zero on parse/network errors.

- [ ] **Step 4: Write the closed-hours test and verify RED**

```python
from datetime import datetime
from zoneinfo import ZoneInfo
from scripts.collector import is_scheduled_open

def test_rejects_sunday_before_opening(self):
    instant = datetime(2026, 8, 16, 7, 59, tzinfo=ZoneInfo("America/New_York"))
    self.assertFalse(is_scheduled_open(instant))
```

Run: `python3 -m unittest tests.test_collector -v`.

Expected: FAIL only because `is_scheduled_open` does not exist.

- [ ] **Step 5: Implement hours, run GREEN, initialize data, commit**

Use exact local hours: Monday–Thursday 05:00–23:00, Friday 05:00–22:00, Saturday 07:00–21:00, Sunday 08:00–21:00; close is exclusive. Create `docs/data/readings.csv` with exactly `timestamp_utc,occupancy,status`. Run `python3 -m unittest tests.test_collector -v`; expected PASS.

```bash
git add scripts/collector.py tests/test_collector.py docs/data/readings.csv
git commit -m "feat: persist Crunch occupancy readings"
```

### Task 3: Build baseline and weather-association output

**Files:**
- Create: `tests/test_analyze.py`
- Create: `scripts/analyze.py`
- Create: `docs/data/classes.csv`
- Create: `docs/data/insights.json`

- [ ] **Step 1: Write the failing baseline test**

```python
import unittest
from scripts.analyze import slot_key, median_baseline

class AnalysisTests(unittest.TestCase):
    def test_baseline_groups_equal_weekday_ten_minute_slots(self):
        readings = [
            {"local": "2026-08-03T18:07:00-04:00", "occupancy": 80},
            {"local": "2026-08-10T18:08:00-04:00", "occupancy": 100},
            {"local": "2026-08-17T18:09:00-04:00", "occupancy": 120},
        ]
        key = slot_key(readings[0]["local"])
        self.assertEqual(key, "0-18:00")
        self.assertEqual(median_baseline(readings)[key], {"median": 100, "n": 3})
```

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest tests.test_analyze.AnalysisTests.test_baseline_groups_equal_weekday_ten_minute_slots -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.analyze'`.

- [ ] **Step 3: Implement the deterministic baseline**

Implement `slot_key(local_iso)` with `datetime.fromisoformat` and ten-minute slots. Implement `median_baseline(readings)` using `statistics.median`, returning JSON-safe `{"median": number, "n": integer}` records.

- [ ] **Step 4: Write the failing evidence test and verify RED**

```python
from scripts.analyze import association

def test_refuses_to_claim_a_weather_effect_with_small_samples(self):
    rows = [{"residual": -10, "rain": True} for _ in range(19)]
    self.assertEqual(association(rows, "rain", True), {"status": "insufficient_data"})
```

Run: `python3 -m unittest tests.test_analyze -v`

Expected: FAIL because `association` is not defined.

- [ ] **Step 5: Implement weather enrichment and evidence threshold**

Request hourly `temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code` from Open-Meteo for 40.7736,-73.9592 in `America/New_York`. Inject its JSON fetcher for tests. Join readings by local hour and define rain as precipitation >= 0.1.

Implement `association(rows, field, value)`: unless both condition and comparison populations contain 20 residuals, return `{"status": "insufficient_data"}`. Otherwise calculate mean residual difference and a two-sided normal-approximation 95% confidence interval; return `observed` only when that interval excludes zero, else `insufficient_data`. The JSON label must be `observed association`, never a causal claim.

`main()` reads `docs/data/readings.csv`, atomically writes `docs/data/insights.json`, and writes a valid empty state before sufficient data exists. Initialize `classes.csv` with `weekday,start_local,end_local,class_name`; classes are dashboard annotations, not causal evidence.

- [ ] **Step 6: Run GREEN and commit**

Run: `python3 -m unittest tests.test_analyze -v`

Expected: PASS.

```bash
git add scripts/analyze.py tests/test_analyze.py docs/data/classes.csv docs/data/insights.json
git commit -m "feat: analyze occupancy baselines and weather"
```

### Task 4: Build the public dashboard

**Files:**
- Create: `docs/index.html`
- Modify: `scripts/analyze.py`
- Modify: `tests/test_analyze.py`

- [ ] **Step 1: Write the failing dashboard contract test**

```python
from scripts.analyze import empty_insights

def test_empty_insights_keeps_live_and_correlation_states_explicit(self):
    result = empty_insights()
    self.assertEqual(result["correlations"], {"status": "insufficient_data"})
    self.assertIn("generated_at", result)
```

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest tests.test_analyze -v`

Expected: FAIL because `empty_insights` is not defined.

- [ ] **Step 3: Implement the contract and dashboard**

Implement `empty_insights()` with `generated_at`, `latest`, `baselines`, `recommendations`, and `correlations` keys.

Create a dependency-free responsive `docs/index.html` that fetches `./data/readings.csv` and `./data/insights.json`, renders a latest measured count and timestamp, 24-hour SVG line chart, weekday/time heatmap, three quietest historical windows, and a weather panel that says either `Observed association` or `Not enough evidence yet`. Use `Intl.DateTimeFormat` with `America/New_York`; visibly distinguish live measurement from estimate; show an empty state instead of inventing a current count. Include a source/method limitation: it is a public Crunch count, not a guaranteed physical headcount, and correlation is not causation.

- [ ] **Step 4: Run GREEN, inspect, commit**

Run: `python3 -m unittest discover -v`; expected PASS.

Run: `python3 -m http.server 4173 --directory docs`; inspect `http://localhost:4173` and stop the server. Then:

```bash
git add docs/index.html scripts/analyze.py tests/test_analyze.py docs/data/insights.json
git commit -m "feat: add public crowd dashboard"
```

### Task 5: Schedule, document, and publish

**Files:**
- Create: `.github/workflows/collect.yml`
- Create: `.github/workflows/analyze.yml`
- Create: `README.md`

- [ ] **Step 1: Add collector workflow**

```yaml
name: Collect Crunch occupancy
on:
  schedule:
    - cron: '7,17,27,37,47,57 * * * *'
  workflow_dispatch:
permissions:
  contents: write
jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: python -m unittest discover -v
      - run: python scripts/collector.py
      - run: |
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add docs/data/readings.csv
          git diff --cached --quiet || git commit -m 'data: record Crunch occupancy'
          git push
```

- [ ] **Step 2: Add daily analysis workflow**

At `23:23 UTC` plus manual dispatch, use the same checkout, Python setup, test, and `contents: write` steps. Run `python scripts/analyze.py`; commit only `docs/data/insights.json` with message `data: refresh crowd insights`.

- [ ] **Step 3: Add README and verify locally**

Document source URL, public-data intent, CSV schema, manual execution, Pages source (`main` / `docs`), excluded `max_occupancy`, and evidence limits.

Run:

```bash
python3 -m unittest discover -v
git diff --check
git grep -nEi '(gh[opsu]_[A-Za-z0-9]|authorization:|api[_-]?key|secret)' || true
git status --short --branch
```

Expected: all tests pass, no whitespace errors, no credential content, clean branch after commit.

- [ ] **Step 4: Commit, create the public repo, and verify external behavior**

```bash
git add .github/workflows README.md
git commit -m "ci: schedule public crowd collection"
gh repo create crunch-81st-crowd --public --source=. --remote=origin --push --description 'Public historical crowd tracker for Crunch E 81st, NYC'
gh workflow run 'Collect Crunch occupancy'
gh workflow run 'Analyze crowd insights'
```

Enable GitHub Pages from the `main` branch / `docs` folder. Inspect both manually dispatched runs with `gh run list` and `gh run view --log-failed` if needed. Open the final public Pages URL and confirm the latest count timestamp matches the committed CSV. Report actual repo URL, dashboard URL, and run outcomes without claiming an unobserved scheduled run.

