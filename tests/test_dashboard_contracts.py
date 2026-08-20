import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DashboardQuietWorkoutContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "docs" / "index.html").read_text()
        cls.readme = (ROOT / "README.md").read_text()

    def test_quiet_workout_regions_keep_the_page_compact(self):
        for contract in (
            'id="last24-heading">Last 24 recorded hours',
            'Recorded occupancy over the last 24 hours',
            "function chartRangeLabel(start, end)",
            'id="quiet-heading">Best quiet workout windows',
            'id="pattern-heading">Week / hour pattern',
            'id="factors-heading">What may matter',
            'id="schedule-context"',
            'id="stability-strip"',
        ):
            self.assertIn(contract, self.page)
        self.assertNotIn('id="class-list"', self.page)
        self.assertNotIn('function renderClassAnnotations', self.page)

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
            "function validClassSchedule(insights)",
            'source.protocol !== "https:"',
            'source.hostname !== "class-prod.crunch.com"',
            "function renderQuietPlanner(insights)",
            "function renderMonthlyStability(insights)",
            "function renderFactors(insights)",
            "function renderScheduleContext(insights)",
            "function renderUnavailable()",
            "renderQuietPlanner(insights);",
            "renderMonthlyStability(insights);",
            "renderFactors(insights);",
            "renderScheduleContext(insights);",
        ):
            self.assertIn(contract, self.page)

    def test_planner_copy_is_evidence_bound_and_non_causal(self):
        for contract in (
            "independent local dates",
            "historical range",
            "independent local weeks",
            "Observed association, not proof",
            "Tracking: ${progress.matchingDates} / 4 matching weekday-time observations.",
            "Tracking: ${weather.rainyDates} rainy / 20 and ${weather.dryDates} dry / 20 independent dates.",
            "retained schedule may be out of date",
            "Weather context is unavailable; no weather comparison is shown.",
        ):
            self.assertIn(contract, self.page)

    def test_readme_describes_the_quiet_workout_evidence_standard(self):
        for contract in (
            "quiet-workout planner",
            "latest\nrecorded state",
            "last 24 recorded hours",
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
            '$("schedule-source").replaceChildren();',
            '$("schedule-context").hidden = true;',
        ):
            self.assertIn(contract, unavailable)


if __name__ == "__main__":
    unittest.main()
