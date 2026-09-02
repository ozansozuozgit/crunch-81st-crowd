import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DashboardQuietWorkoutContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "docs" / "index.html").read_text()
        cls.readme = (ROOT / "README.md").read_text()

    def test_page_regions_are_present(self):
        for contract in (
            'id="headline"',
            'id="support"',
            'id="l-count"',
            'id="l-hour"',
            'id="l-record"',
            'id="chart-heading">Today, hour by hour',
            'id="parts-heading">Best time in each part of the day',
            'id="week-heading">A typical week',
            'id="days-heading">Quietest and busiest hour, by weekday',
            'id="fine-1"',
            'id="fine-2"',
        ):
            self.assertIn(contract, self.page)

    def test_live_crowd_data_uses_the_credit_independent_worker_origin(self):
        self.assertIn(
            'const LIVE_DATA_ORIGIN = "https://crunch-81st-crowd-api.ozanpochette.workers.dev/v1";',
            self.page,
        )
        self.assertIn('fetchText(`${LIVE_DATA_ORIGIN}/readings.csv?days=90`)', self.page)
        self.assertIn('fetchText(`${LIVE_DATA_ORIGIN}/insights.json?days=90`)', self.page)

    def test_view_model_is_separated_from_rendering(self):
        for contract in (
            "function buildViewModel(readings, insights, now)",
            "function hourlyVisits(readings)",
            "globalThis.__CROWD_DESK_V2__ = { buildViewModel, parseCSV, hourlyVisits };",
            "function renderAnswer(vm)",
            "function renderLedger(vm)",
            "function renderChart(vm)",
            "function renderParts(vm)",
            "function renderWeek(vm)",
            "function renderDays(vm)",
            "function renderFine(vm)",
            "function renderUnavailable()",
        ):
            self.assertIn(contract, self.page)

    def test_every_number_is_walk_ins_per_hour(self):
        self.assertNotIn("typical_daily_visits", self.page)
        self.assertNotIn("check-ins that day", self.page)
        self.assertIn("walk-ins per hour", self.page)

    def test_copy_is_evidence_bound_and_non_causal(self):
        for contract in (
            "Based on ${plural(",
            "opening hour left out",
            "Quietest ${when} after the opening hour",
            "An hour is only called reliably quiet after it has been quiet on 4 separate days.",
            "Observed association, not proof",
            "Context, not causes.",
            "not people in the room",
            "yesterday’s total",
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

    def test_unavailable_readings_clear_every_region(self):
        start = self.page.index("function renderUnavailable()")
        end = self.page.index("globalThis.__CROWD_DESK_V2__", start)
        unavailable = self.page[start:end]
        for contract in (
            '$("headline").textContent = "The record couldn’t load";',
            '$("chart-empty").hidden = false;',
            '$("heat-empty").hidden = false;',
            '$("parts-empty").hidden = false;',
            '$("days-empty").hidden = false;',
        ):
            self.assertIn(contract, unavailable)


if __name__ == "__main__":
    unittest.main()
