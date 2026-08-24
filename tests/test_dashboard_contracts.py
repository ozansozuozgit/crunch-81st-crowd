import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DashboardQuietWorkoutContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "docs" / "index.html").read_text()
        cls.readme = (ROOT / "README.md").read_text()

    def test_go_now_regions_keep_the_page_compact(self):
        for contract in (
            'id="verdict-line"',
            'id="today-heading">Go today',
            'id="last24-heading">Today vs a normal day',
            'id="stat-now"',
            'id="stat-peak"',
            'id="stat-quiet"',
            'id="quiet-heading">Usually quietest',
            'id="pattern-heading">When it gets crowded',
            'id="factors-heading">What changes the crowds',
            'id="stability-strip"',
            'id="day-strip"',
        ):
            self.assertIn(contract, self.page)

    def test_live_crowd_data_uses_the_credit_independent_worker_origin(self):
        self.assertIn(
            'const LIVE_DATA_ORIGIN = "https://crunch-81st-crowd-api.ozanpochette.workers.dev/v1";',
            self.page,
        )
        self.assertIn('fetchText(`${LIVE_DATA_ORIGIN}/readings.csv?days=90`)', self.page)
        self.assertIn('fetchText(`${LIVE_DATA_ORIGIN}/insights.json?days=90`)', self.page)
        self.assertNotIn('id="class-list"', self.page)
        self.assertNotIn('function renderClassAnnotations', self.page)
        self.assertNotIn('id="schedule-context"', self.page)
        self.assertNotIn("function renderScheduleContext", self.page)
        self.assertNotIn("function validClassSchedule", self.page)
        self.assertNotIn("function renderChart", self.page)
        self.assertNotIn("function chartRangeLabel", self.page)

    def test_validated_evidence_contracts_guard_public_claims(self):
        for contract in (
            "function validQuietDetails(insights)",
            'details.status !== "ready"',
            "Number.isInteger(independentDates)",
            "independentDates < 4",
            "Number.isInteger(independentWeeks)",
            "independentWeeks < 1",
            "function validMonthlyStability(insights, quietDetails)",
            "function validFactorContext(insights)",
            "function validTodayPlan(insights)",
            "function validWeekdayProfile(insights)",
            "function validBaselineFor(insights, key)",
            "function renderQuietPlanner(insights)",
            "function renderMonthlyStability(insights)",
            "function renderFactors(insights)",
            "function renderTodayPlan(insights)",
            "function renderDayStrip(insights)",
            "function renderVerdict(readings, insights)",
            "function renderNowDelta(readings, insights)",
            "function renderStatChips(readings, insights)",
            "function renderTodayVsTypical(readings)",
            "function renderUnavailable()",
            "renderQuietPlanner(insights);",
            "renderMonthlyStability(insights);",
            "renderFactors(insights);",
            "renderTodayPlan(insights);",
            "renderDayStrip(insights);",
            "renderVerdict(readings, insights);",
            "renderNowDelta(readings, insights);",
            "renderStatChips(readings, insights);",
            "renderTodayVsTypical(readings);",
        ):
            self.assertIn(contract, self.page)

    def test_planner_copy_is_evidence_bound_and_non_causal(self):
        for contract in (
            "days of data",
            "between weeks",
            "Observed association, not proof",
            "Seen on ${progress.matchingDates} of 4 days needed — check back soon.",
            "Rainy days recorded: ${weather.rainyDates} of 20 · dry days: ${weather.dryDates} of 20. Then we can compare.",
            "Early data — these picks are based on fewer than 4 days and can still shift.",
            "Go around ${best.label.replace",
            "reliably quiet",
            "Dashed line = a normal ${days[weekdayIndex]}",
        ):
            self.assertIn(contract, self.page)

    def test_readme_describes_the_quiet_workout_evidence_standard(self):
        for contract in (
            "quiet-workout planner",
            "latest\nrecorded state",
            "today against the typical day for its weekday",
            "week-to-week stability",
            "progress instead of a recommendation",
            "independent local dates",
            "historical range",
            "Observed association, not proof",
            "contextual annotations,\nnot causal explanations",
            "explicit empty state only when no valid readings exist",
            "measured data and insufficient evidence",
        ):
            self.assertIn(contract, self.readme)

    def test_unavailable_readings_clear_all_downstream_regions(self):
        start = self.page.index("function renderUnavailable()")
        end = self.page.index("function svgEl", start)
        unavailable = self.page[start:end]
        for contract in (
            '$("quiet-list").replaceChildren();',
            '$("stability-strip").replaceChildren();',
            '$("factor-weather").replaceChildren();',
            '$("factor-holidays").replaceChildren();',
            '$("now-delta").hidden = true;',
            '$("stat-now").textContent = "—";',
            '$("stat-peak").textContent = "—";',
            '$("stat-quiet").textContent = "—";',
        ):
            self.assertIn(contract, unavailable)


if __name__ == "__main__":
    unittest.main()
