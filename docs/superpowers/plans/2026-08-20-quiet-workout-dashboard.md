# Quiet Workout Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Make the public dashboard a concise, evidence-gated planner for quiet Crunch E 81st workouts.

**Architecture:** The nightly analyzer publishes independent-date quiet-window detail and local-week stability summaries without changing existing evidence gates. The static dashboard renders a go-now-first experience from validated public readings and insights; schedule rows become a single source note, and factors stay explicitly non-causal.

**Tech Stack:** Python 3.12 standard library, unittest, static HTML/CSS/vanilla JavaScript, Node checks, GitHub Pages.

---

### Task 1: Publish quiet-window details and factor context

**Files:**
- Modify: \`scripts/analyze.py\`
- Modify: \`tests/test_analyze.py\`
- Modify: \`docs/data/insights.json\`

- [ ] **Step 1: Add failing independent-evidence tests**

Import \`quiet_window_details\`, \`monthly_stability\`, and \`factor_context\` in \`tests/test_analyze.py\`. Use four Monday 18:00 local dates, including two same-date samples.

\`\`\`python
readings = [
    {"local": "2026-08-17T18:01:00-04:00", "occupancy": 20},
    {"local": "2026-08-17T18:09:00-04:00", "occupancy": 24},
    {"local": "2026-08-24T18:01:00-04:00", "occupancy": 30},
    {"local": "2026-08-31T18:01:00-04:00", "occupancy": 20},
    {"local": "2026-09-07T18:01:00-04:00", "occupancy": 30},
]
detail = quiet_window_details(readings)
self.assertEqual(detail["status"], "ready")
self.assertEqual(detail["items"][0]["independent_dates"], 4)
self.assertEqual(detail["items"][0]["baseline_occupancy"], 25.0)
self.assertEqual(detail["items"][0]["spread"], 10.0)
\`\`\`

Assert the 2026-08-17 observations are one date with a daily mean of 22, not two independent dates. Assert \`monthly_stability(readings, detail)\` returns four independent ISO local weeks and finite \`week_spread\`. Assert \`factor_context([])\` returns zero holiday and non-holiday dates.

- [ ] **Step 2: Run the focused RED test**

Run: \`python3 -m unittest tests.test_analyze -v\`

Expected: FAIL because the three new functions do not exist.

- [ ] **Step 3: Implement one shared date-independent grouping helper**

Add this private helper in \`scripts/analyze.py\` and replace duplicated quiet-window grouping with it.

\`\`\`python
def _occupancies_by_slot_and_date(readings: list[dict]) -> dict[str, dict[str, list[int | float]]]:
    grouped: dict[str, dict[str, list[int | float]]] = {}
    for reading in readings:
        local = datetime.fromisoformat(reading["local"])
        grouped.setdefault(slot_key(reading["local"]), {}).setdefault(
            local.date().isoformat(), []
        ).append(reading["occupancy"])
    return grouped
\`\`\`

Implement \`quiet_window_details(readings)\`: reduce each local date to \`fmean\`, require the existing four independent dates, calculate a median baseline and \`max(daily_values) - min(daily_values)\` spread, sort by baseline then slot, and retain five candidates. Keep \`quiet_window_recommendations()\` as a compatibility projection from the detailed items so its threshold and output do not change.

- [ ] **Step 4: Implement stable week and factor summaries**

Implement \`monthly_stability(readings, details)\` from the same per-date values. Group an eligible slot by \`date.fromisoformat(local_date).isocalendar()[:2]\`, reduce to one mean per ISO local week, and publish only finite \`independent_weeks\` and \`week_spread\`.

Implement \`factor_context(readings, class_schedule_status, weather_state)\` with only holiday/non-holiday unique local-date counts, the weather progress/status already calculated, and class schedule status. It must not estimate effects for holidays/classes or use causal labels.

- [ ] **Step 5: Publish and test the insight contract**

Add these stable defaults to \`empty_insights()\` and populate them in \`main()\`.

\`\`\`python
"quiet_window_details": {"status": "insufficient_data", "items": []},
"monthly_stability": {"status": "insufficient_data", "items": []},
"factor_context": {
    "holiday_dates": 0,
    "non_holiday_dates": 0,
    "weather_progress": {"status": "collecting", "rainy_dates": 0,
                         "dry_dates": 0, "required_dates_per_group": 20},
    "class_schedule_status": "unavailable",
},
\`\`\`

On weather failure, publish the existing unavailable weather state both at top level and inside factor context. Do not change the weather association test or its 20 rainy/20 dry independent-date requirement.

Run:

\`\`\`bash
python3 -m unittest tests.test_analyze -v
python3 scripts/analyze.py
git diff --check
\`\`\`

Expected: PASS; regenerated \`docs/data/insights.json\` contains only finite primitive detail fields.

- [ ] **Step 6: Commit Task 1**

\`\`\`bash
git add scripts/analyze.py tests/test_analyze.py docs/data/insights.json
git commit -m "feat: publish quiet workout evidence"
\`\`\`

### Task 2: Build the compact quiet-workout dashboard

**Files:**
- Modify: \`docs/index.html\`
- Modify: \`tests/test_dashboard_contracts.py\`
- Modify: \`tests/dashboard_context_runtime.js\`
- Modify: \`tests/test_dashboard_runtime.py\`

- [ ] **Step 1: Add failing dashboard contracts**

Add Python static-contract and Node runtime tests for these functions: \`validQuietDetails\`, \`validMonthlyStability\`, \`validFactorContext\`, \`renderQuietPlanner\`, \`renderMonthlyStability\`, \`renderFactors\`, and \`renderScheduleContext\`.

\`\`\`javascript
const details = hooks.validQuietDetails({
  quiet_window_details: {
    status: "ready",
    items: [{slot: "0-18:00", baseline_occupancy: 25,
             independent_dates: 4, spread: 10}],
  },
});
assert.equal(details[0].spread, 10);
hooks.renderQuietPlanner({
  quiet_window_details: {status: "insufficient_data", items: []},
  recommendation_progress: {status: "collecting", matching_dates: 3,
                            required_dates: 4},
});
assert.match(elements["quiet-empty"].textContent, /3 \/ 4/);
\`\`\`

Add fixtures for valid monthly stability, malformed details, stale schedule, and unavailable readings. Assert the class list does not exist or render, early data produces progress rather than ranking, stability wording includes independent local weeks, and unavailable clears all dependent regions.

- [ ] **Step 2: Run the focused RED test**

Run: \`python3 -m unittest tests.test_dashboard_contracts tests.test_dashboard_runtime -v\`

Expected: FAIL because the planner functions and regions do not exist.

- [ ] **Step 3: Replace the lower-page markup with five concise regions**

Keep the existing masthead, latest-recorded strip, and responsive dark editorial system. Replace the class-forward layout with these semantic regions:

\`\`\`html
<section aria-labelledby="today-heading">…today's recorded rhythm…</section>
<section aria-labelledby="quiet-heading">…best quiet workout windows…</section>
<section aria-labelledby="pattern-heading">…week/hour field and month stability…</section>
<section aria-labelledby="factors-heading">…what may matter…</section>
<aside id="schedule-context">…public schedule freshness/source…</aside>
\`\`\`

Do not add filters, navigation, a forecast, or cards for every metric. Keep the source schedule to a link/freshness note; do not render class rows. Keep accessible SVG titles/descriptions, New York labels, the gap rule, and reduced-motion support.

- [ ] **Step 4: Implement strict rendering contracts**

\`validQuietDetails\` accepts only ready status, a valid slot, finite non-negative baseline/spread, and integer independent dates of at least four. \`renderQuietPlanner\` renders up to five valid rows with typical count, independent date count, and observed range. It must never rank raw CSV history; when not ready, it shows only validated matching-date progress.

\`validMonthlyStability\` accepts only items matching a validated detail slot, finite non-negative week spread, and integer independent weeks. \`renderMonthlyStability\` displays a narrow strip labelled “historical range” and “independent local weeks,” never a forecast.

\`validFactorContext\` accepts only non-negative integer date counts, recognized schedule states, and the existing validated weather state. \`renderFactors\` shows weather tracking/observed association, holiday date counts, and schedule context using “may matter”, “recorded”, and “observed association”. It must not use “cause”, “because”, “drives”, or forecast language.

Rename/refactor \`renderClassAnnotations\` into \`renderScheduleContext\`. It uses only the existing strictly validated official HTTPS source and actual verified/stale timestamps. Use \`textContent\` and \`replaceChildren\` for all public values. \`renderUnavailable\` clears the planner, stability, factor, and schedule-context regions.

- [ ] **Step 5: Run GREEN and inspect the actual states**

Run:

\`\`\`bash
python3 -m unittest tests.test_dashboard_contracts tests.test_dashboard_runtime -v
python3 - <<'PY' > /tmp/crowd-dashboard.js
from pathlib import Path
page = Path("docs/index.html").read_text()
print(page.split("<script>", 1)[1].split("</script>", 1)[0])
PY
node --check /tmp/crowd-dashboard.js
python3 -m http.server 4173 --directory docs
\`\`\`

Inspect desktop and narrow fixtures for young, qualified, stale, malformed, and unavailable states; stop the server. Run \`git diff --check\`.

- [ ] **Step 6: Commit Task 2**

\`\`\`bash
git add docs/index.html tests/test_dashboard_contracts.py tests/dashboard_context_runtime.js tests/test_dashboard_runtime.py
git commit -m "feat: focus dashboard on quiet workouts"
\`\`\`

### Task 3: Update the public explanation and publish

**Files:**
- Modify: \`README.md\`
- Modify: \`tests/test_dashboard_contracts.py\`

- [ ] **Step 1: Add a failing wording contract**

Add an exact static assertion for \`quiet workout\`, \`independent local dates\`, \`historical range\`, and \`observed association, not proof\` in the relevant page/method text.

- [ ] **Step 2: Verify RED**

Run: \`python3 -m unittest tests.test_dashboard_contracts -v\`

Expected: FAIL before the focused copy is added.

- [ ] **Step 3: Update only the necessary documentation/copy**

Replace schedule-forward README copy with:

\`\`\`markdown
The dashboard is a quiet-workout planner: latest recorded crowd state, today's recorded rhythm, evidence-qualified repeatable quiet windows, and week-to-week stability. It labels insufficient history as collection progress. Weather, holidays, and the public class schedule are context only; no causal claim is made.
\`\`\`

Preserve public source URLs, collector timing, stale schedule retention, workflow safety, and limitations.

- [ ] **Step 4: Verify, commit, and publish**

Run:

\`\`\`bash
python3 -m unittest discover -v
python3 -m py_compile scripts/collector.py scripts/sync_classes.py scripts/analyze.py
node --check /tmp/crowd-dashboard.js
git diff --check
git grep -nEi '(gh[opsu]_[A-Za-z0-9]|authorization:|api[_-]?key|secret)' || true
git status --short --branch
\`\`\`

Commit:

\`\`\`bash
git add README.md tests/test_dashboard_contracts.py
git commit -m "docs: explain quiet workout evidence"
\`\`\`

Merge the feature branch into \`main\`, rerun the full suite, push without force, dispatch \`Analyze crowd insights\`, wait for a successful run and Pages build, then fetch public \`index.html\`, \`data/readings.csv\`, and \`data/insights.json\`. Confirm the live dashboard has quiet/factor/month fields, no early causal claim, and a truthful fresh/stale schedule state.

