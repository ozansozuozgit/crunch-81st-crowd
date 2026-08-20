# Live Context Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically populate E 81st class annotations and expose honest weather/recommendation collection progress before statistical conclusions are ready.

**Architecture:** A pinned PDF parser downloads the public club-40 weekly schedule, reconstructs validated day/time/class rows, and preserves the last known-good data on failure. The nightly workflow syncs this input before analysis; analysis publishes source freshness plus weather and recommendation progress. The static dashboard renders these explicit states.

**Tech Stack:** Python 3.12, pypdf, unittest, GitHub Actions, HTML/CSS/vanilla JavaScript.

---

### Task 1: Create a resilient public class-schedule sync

**Files:**
- Create: `requirements.txt`
- Create: `scripts/sync_classes.py`
- Create: `docs/data/classes_meta.json`
- Modify: `tests/test_analyze.py`
- Create: `tests/test_sync_classes.py`

- [ ] **Step 1: Write a failing coordinate-to-schedule parser test**

Use positioned page-text records that model two weekday columns and assert `parse_schedule_lines(records)` returns normalized rows:

```python
records = [
    (48, 531, "Chisel - GF*"),
    (48, 520, "7:30 - 45m Patrick R"),
    (153, 531, "Party Ride - GF*"),
    (153, 520, "6:30 - 45m Chloe T"),
]
self.assertEqual(parse_schedule_lines(records), [
    {"weekday": 0, "start_local": "07:30", "end_local": "08:15", "class_name": "Chisel"},
    {"weekday": 1, "start_local": "06:30", "end_local": "07:15", "class_name": "Party Ride"},
])
```

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest tests.test_sync_classes -v`

Expected: FAIL because `scripts.sync_classes` is absent.

- [ ] **Step 3: Implement the minimal parser and source fetcher**

Create `requirements.txt` with a pinned `pypdf` version. In `scripts/sync_classes.py` define:
- `SCHEDULE_URL = "https://class-prod.crunch.com/week_schedule.pdf?button_location=web&club_id=40&options=group"`
- `extract_positioned_text(pdf_bytes)` using pypdf’s visitor-text callback;
- `parse_schedule_lines(records)`, mapping page x-coordinate bands to weekdays, pairing a class text line with a following `HH:MM - NNm` line, removing instructor/suffix text, and rejecting duplicate or invalid rows;
- `sync(fetch_bytes, classes_path, meta_path, now)`, which writes a temporary CSV/meta JSON then replaces both only after a non-empty valid parse.

The metadata document must contain `status: "fresh"`, `source_url`, and `fetched_at`.

- [ ] **Step 4: Add failure-retention tests and verify GREEN**

Test that an HTTP/PDF/parse error returns a stale result, preserves a pre-existing valid `classes.csv`, and writes metadata with `status: "stale"` and an error-safe message. Run `python3 -m unittest tests.test_sync_classes -v`; expected PASS.

- [ ] **Step 5: Add the CLI and commit**

The CLI uses `urllib.request.urlopen` with timeout and User-Agent, reads/writes only `docs/data/classes.csv` and `docs/data/classes_meta.json`, prints its resulting status, and exits zero when it retains a last valid schedule after a refresh failure.

Run:

```bash
python3 -m unittest tests.test_sync_classes -v
git add requirements.txt scripts/sync_classes.py docs/data/classes_meta.json tests/test_sync_classes.py
git commit -m "feat: sync public Crunch class schedule"
```

### Task 2: Publish contextual evidence progress

**Files:**
- Modify: `scripts/analyze.py`
- Modify: `tests/test_analyze.py`
- Modify: `docs/data/insights.json`

- [ ] **Step 1: Write failing progress tests**

Add a `weather_progress(rows)` test whose weather-enriched rows yield independent rain/dry date counts and the exact threshold:

```python
self.assertEqual(weather_progress(rows), {
    "rainy_dates": 2, "dry_dates": 3, "required_dates_per_group": 20,
    "status": "collecting",
})
```

Add a recommendation-progress test with repeated samples from one date plus two other dates that asserts only three independent matching local dates count toward the four-date requirement.

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest tests.test_analyze -v`

Expected: FAIL because the progress helpers/fields do not exist.

- [ ] **Step 3: Implement evidence fields**

Add to `empty_insights()` and every `main()` result:
- `weather_progress`: independent all-rain and all-dry local-date counts, required `20`, and `collecting` / `eligible` status;
- `recommendation_progress`: greatest independent matching weekday/time observation count, required `4`, and `collecting` / `ready` status;
- `class_schedule`: copied validated metadata status, fetched time, and source URL.

Fetch/archive weather whenever readings exist; on a weather failure retain baselines and emit `weather_progress.status = "unavailable"`. Do not alter the existing association or recommendation thresholds.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
python3 -m unittest tests.test_analyze -v
git add scripts/analyze.py tests/test_analyze.py docs/data/insights.json
git commit -m "feat: publish collection progress"
```

### Task 3: Wire nightly sync and dashboard states

**Files:**
- Modify: `.github/workflows/analyze.yml`
- Modify: `docs/index.html`
- Modify: `README.md`
- Modify: `tests/test_workflows.py`

- [ ] **Step 1: Write the failing workflow/dashboard contract tests**

Assert that the analysis workflow installs `requirements.txt`, runs `scripts/sync_classes.py` before `scripts/analyze.py`, and stages only `classes.csv`, `classes_meta.json`, and `insights.json`.

Add static/dashboard fixture checks for:
- fresh classes render rows plus source freshness;
- stale classes render prior rows with a visible stale warning;
- weather progress renders actual counts without causal language;
- recommendation progress renders `n / 4` when not ready.

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest discover -v`

Expected: workflow and dashboard contract tests fail.

- [ ] **Step 3: Implement workflow and UI**

In `analyze.yml`, install pinned dependencies, run class sync first, then analysis, and include all three generated data files in the existing safe commit/rebase protocol.

In `docs/index.html`, use only strict primitive validation. Render:
- class schedule freshness/source state next to annotations;
- `Tracking: X rainy / 20 and Y dry / 20 independent dates`, or unavailable;
- quiet-window progress `X / 4 matching weekday-time observations`.

No screen may infer a recommendation or association from progress data.

- [ ] **Step 4: Verify locally and commit**

Run:

```bash
python3 -m unittest discover -v
python3 -m py_compile scripts/sync_classes.py scripts/analyze.py
git diff --check
python3 -m http.server 4173 --directory docs
```

Inspect fresh, stale, and no-evidence fixtures; stop the server. Then:

```bash
git add .github/workflows/analyze.yml docs/index.html README.md tests/test_workflows.py
git commit -m "feat: show live context progress"
```

### Task 4: Publish and prove live inputs

**Files:**
- Modify: remote `main` and generated public data only

- [ ] **Step 1: Run final local verification**

```bash
python3 -m unittest discover -v
git diff --check
git grep -nEi '(gh[opsu]_[A-Za-z0-9]|authorization:|api[_-]?key|secret)' || true
git status --short --branch
```

Expected: all tests pass, no whitespace errors, no credential content, clean branch.

- [ ] **Step 2: Push and dispatch nightly analysis**

Push `main`, manually dispatch `Analyze crowd insights`, and inspect its completed run. Confirm the refreshed public `classes.csv`, class metadata, and `insights.json` are committed.

- [ ] **Step 3: Verify the deployed dashboard**

Wait for the Pages build, fetch the dashboard and its three data files, then verify:
- a public E 81st schedule row appears or a truthful stale/unavailable state is visible;
- weather and recommendation progress show numeric evidence counts;
- no causal statement appears before the association threshold.

Report the actual dashboard/run URLs and any source parsing limitation.

