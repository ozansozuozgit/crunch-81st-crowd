import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DashboardQuietWorkoutContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "docs" / "index.html").read_text()

    def test_quiet_workout_regions_keep_the_page_compact(self):
        for contract in (
            'id="today-heading">Today\'s recorded rhythm',
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
        ):
            self.assertIn(contract, self.page)

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
