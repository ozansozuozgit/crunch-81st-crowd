import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DashboardContextContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "docs" / "index.html").read_text()

    def test_fresh_and_stale_schedule_metadata_are_validated_before_annotations_render(self):
        for contract in (
            "function validClassSchedule(insights)",
            '["fresh", "stale"].includes(schedule.status)',
            'source.protocol !== "https:"',
            "source.username || source.password",
            'source.hostname !== "class-prod.crunch.com"',
            "isTimezoneAwareTimestamp(schedule.fetched_at)",
            "isTimezoneAwareTimestamp(schedule.last_attempt_at)",
            "function renderClassAnnotations(insights)",
            "const schedule = validClassSchedule(insights);",
            "const annotations = schedule ? validClassAnnotations(insights) : [];",
            'schedule.status === "stale"',
            "Refresh failed",
            "retained schedule may be out of date",
        ):
            self.assertIn(contract, self.page)

    def test_malformed_context_cannot_render_as_a_weather_or_quiet_claim(self):
        for contract in (
            "function validWeatherProgress(insights)",
            "Number.isInteger(rainyDates)",
            "Number.isInteger(dryDates)",
            "function validRecommendationProgress(insights)",
            "Number.isInteger(matchingDates)",
            "Tracking: ${progress.rainyDates} rainy / 20 and ${progress.dryDates} dry / 20 independent dates.",
            "Tracking: ${progress.matchingDates} / 4 matching weekday-time observations.",
            "function renderWeather(insights)",
            "if (!observed) {",
            "typeof correlation.effect === \"number\"",
            "Number.isInteger(correlation.condition_n)",
        ):
            self.assertIn(contract, self.page)

    def test_readings_unavailable_scrubs_every_downstream_context_section(self):
        start = self.page.index("function renderUnavailable()")
        end = self.page.index("function svgEl", start)
        unavailable = self.page[start:end]
        for contract in (
            '$("quiet-list").replaceChildren();',
            '$("class-list").replaceChildren();',
            '$("class-source").hidden = true;',
            '$("weather-state").textContent = "Data unavailable";',
            '$("weather-copy").textContent = "Weather evidence is unavailable while the public readings file is unavailable.";',
        ):
            self.assertIn(contract, unavailable)


if __name__ == "__main__":
    unittest.main()
