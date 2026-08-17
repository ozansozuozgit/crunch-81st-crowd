import unittest
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from unittest import mock
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from scripts import analyze
from scripts.analyze import (
    association,
    empty_insights,
    holiday_context,
    load_class_schedule,
    load_weather,
    main,
    median_baseline,
    quiet_window_recommendations,
    slot_key,
    weather_association,
)


class SlotAndBaselineTests(unittest.TestCase):
    def test_groups_monday_readings_into_the_same_ten_minute_slot(self):
        readings = [
            {"local": "2026-08-17T18:07:00-04:00", "occupancy": 80},
            {"local": "2026-08-17T18:08:00-04:00", "occupancy": 100},
            {"local": "2026-08-17T18:09:00-04:00", "occupancy": 120},
        ]

        self.assertEqual(slot_key(readings[0]["local"]), "0-18:00")
        self.assertEqual(
            median_baseline(readings),
            {"0-18:00": {"median": 100, "n": 3}},
        )


class HolidayTests(unittest.TestCase):
    def test_marks_fixed_and_observed_federal_holidays(self):
        self.assertEqual(
            holiday_context("2026-07-04"),
            {"holiday": True, "holiday_label": "Independence Day"},
        )
        self.assertEqual(
            holiday_context("2026-07-03"),
            {"holiday": True, "holiday_label": "Independence Day (observed)"},
        )

    def test_marks_standard_movable_federal_holidays(self):
        self.assertEqual(
            holiday_context("2026-11-26"),
            {"holiday": True, "holiday_label": "Thanksgiving Day"},
        )
        self.assertEqual(
            holiday_context("2026-05-25"),
            {"holiday": True, "holiday_label": "Memorial Day"},
        )


class ClassScheduleTests(unittest.TestCase):
    def test_loads_valid_class_rows_as_non_causal_annotations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "classes.csv"
            path.write_text(
                "weekday,start_local,end_local,class_name\n"
                "0,18:00,19:00,HIIT\n"
            )

            self.assertEqual(
                load_class_schedule(path),
                {
                    "status": "available",
                    "items": [
                        {
                            "weekday": 0,
                            "start_local": "18:00",
                            "end_local": "19:00",
                            "class_name": "HIIT",
                        }
                    ],
                },
            )

    def test_rejects_invalid_class_rows_without_raising(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "classes.csv"
            path.write_text(
                "weekday,start_local,end_local,class_name\n"
                "8,19:00,18:00,\n"
            )

            self.assertEqual(load_class_schedule(path), {"status": "unavailable", "items": []})


class RecommendationTests(unittest.TestCase):
    def test_does_not_treat_adjacent_samples_on_one_date_as_independent(self):
        readings = [
            {"local": f"2026-08-17T18:{minute:02d}:00-04:00", "occupancy": 20}
            for minute in (1, 2, 3, 4)
        ]

        self.assertEqual(
            quiet_window_recommendations(readings),
            {"status": "insufficient_data", "items": []},
        )

    def test_rejects_three_one_sample_slots_as_insufficient_evidence(self):
        readings = [
            {"local": "2026-08-17T18:07:00-04:00", "occupancy": 20},
            {"local": "2026-08-17T18:17:00-04:00", "occupancy": 22},
            {"local": "2026-08-17T18:27:00-04:00", "occupancy": 24},
        ]

        self.assertEqual(
            quiet_window_recommendations(readings),
            {"status": "insufficient_data", "items": []},
        )

    def test_recommends_a_low_slot_after_four_independent_local_dates(self):
        readings = [
            {"local": "2026-08-17T18:07:00-04:00", "occupancy": 20},
            {"local": "2026-08-24T18:07:00-04:00", "occupancy": 30},
            {"local": "2026-08-31T18:07:00-04:00", "occupancy": 20},
            {"local": "2026-09-07T18:07:00-04:00", "occupancy": 30},
        ]

        self.assertEqual(
            quiet_window_recommendations(readings),
            {
                "status": "available",
                "items": [
                    {
                        "slot": "0-18:00",
                        "baseline_occupancy": 25.0,
                        "independent_dates": 4,
                    }
                ],
            },
        )


class AssociationTests(unittest.TestCase):
    def test_requires_twenty_rows_for_each_population(self):
        rows = ([{"residual": 10, "rain": True}] * 19) + ([{"residual": 0, "rain": False}] * 20)

        self.assertEqual(association(rows, "rain", True), {"status": "insufficient_data"})

    def test_reports_a_decisive_observed_association(self):
        rows = ([{"residual": 10, "rain": True}] * 20) + ([{"residual": 0, "rain": False}] * 20)

        self.assertEqual(
            association(rows, "rain", True),
            {
                "status": "observed",
                "effect": 10,
                "condition_n": 20,
                "comparison_n": 20,
                "confidence_low": 10,
                "confidence_high": 10,
            },
        )

    def test_weather_association_requires_twenty_independent_local_dates_per_condition(self):
        # Forty interval samples are not forty independent observations: these are only
        # one rainy local date and one dry local date, so weather evidence is insufficient.
        rows = ([{"local": "2026-08-17T18:00:00-04:00", "residual": 10, "rain": True}] * 20) + (
            [{"local": "2026-08-18T18:00:00-04:00", "residual": 0, "rain": False}] * 20
        )

        self.assertEqual(weather_association(rows), {"status": "insufficient_data"})


class WeatherTests(unittest.TestCase):
    def test_loads_open_meteo_weather_by_local_hour_and_marks_rain(self):
        requested = []

        def fetch_json(url):
            requested.append(url)
            return {
                "hourly": {
                    "time": ["2026-08-17T18:00", "2026-08-17T19:00"],
                    "temperature_2m": [25.0, 24.0],
                    "apparent_temperature": [26.0, 24.0],
                    "precipitation": [0.1, 0.0],
                    "wind_speed_10m": [8.0, 5.0],
                    "weather_code": [61, 0],
                }
            }

        weather = load_weather(
            [
                {"local": "2026-08-17T18:07:00-04:00"},
                {"local": "2026-08-17T19:45:00-04:00"},
            ],
            fetch_json,
        )

        self.assertEqual(
            weather,
            {
                "2026-08-17T18:00": {
                    "temperature_2m": 25.0,
                    "apparent_temperature": 26.0,
                    "precipitation": 0.1,
                    "wind_speed_10m": 8.0,
                    "weather_code": 61,
                    "rain": True,
                },
                "2026-08-17T19:00": {
                    "temperature_2m": 24.0,
                    "apparent_temperature": 24.0,
                    "precipitation": 0.0,
                    "wind_speed_10m": 5.0,
                    "weather_code": 0,
                    "rain": False,
                },
            },
        )
        query = parse_qs(urlparse(requested[0]).query)
        self.assertEqual(query["latitude"], ["40.7736"])
        self.assertEqual(query["longitude"], ["-73.9592"])
        self.assertEqual(query["timezone"], ["America/New_York"])
        self.assertEqual(query["hourly"], ["temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code"])


class MainTests(unittest.TestCase):
    def test_empty_insights_is_an_explicit_valid_state(self):
        self.assertEqual(
            empty_insights(),
            {
                "generated_at": None,
                "latest": None,
                "baselines": {},
                "recommendations": [],
                "recommendations_status": "insufficient_data",
                "correlations": {"status": "insufficient_data"},
                "class_annotations": {"status": "unavailable", "items": []},
            },
        )

    def test_script_entrypoint_writes_the_initial_insights_file(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "project"
            script_path = project / "scripts" / "analyze.py"
            readings_path = project / "docs" / "data" / "readings.csv"
            script_path.parent.mkdir(parents=True)
            readings_path.parent.mkdir(parents=True)
            shutil.copy2(analyze.__file__, script_path)
            readings_path.write_text("timestamp_utc,occupancy,status\n")

            subprocess.run([sys.executable, str(script_path)], check=True)

            self.assertTrue((project / "docs" / "data" / "insights.json").exists())

    def test_main_writes_an_empty_state_without_fetching_weather(self):
        def fetch_json(_url):
            self.fail("weather must not be fetched with fewer than twenty readings")

        with tempfile.TemporaryDirectory() as directory:
            readings_path = Path(directory) / "readings.csv"
            insights_path = Path(directory) / "insights.json"
            readings_path.write_text("timestamp_utc,occupancy,status\n")

            exit_code = main(readings_path, insights_path, fetch_json, "2026-08-17T12:00:00Z")

            self.assertEqual(exit_code, 0)
            self.assertEqual(
                json.loads(insights_path.read_text()),
                {
                    "generated_at": "2026-08-17T12:00:00Z",
                    "latest": None,
                    "baselines": {},
                    "recommendations": [],
                    "recommendations_status": "insufficient_data",
                    "correlations": {"status": "insufficient_data"},
                    "class_annotations": {"status": "empty", "items": []},
                },
            )

    def test_main_enriches_latest_reading_and_exposes_class_annotations(self):
        with tempfile.TemporaryDirectory() as directory:
            readings_path = Path(directory) / "readings.csv"
            insights_path = Path(directory) / "insights.json"
            classes_path = Path(directory) / "classes.csv"
            readings_path.write_text("timestamp_utc,occupancy,status\n2026-07-03T22:07:00Z,34,light\n")
            classes_path.write_text(
                "weekday,start_local,end_local,class_name\n"
                "4,18:00,19:00,HIIT\n"
            )

            main(
                readings_path,
                insights_path,
                generated_at="2026-07-03T23:00:00Z",
                classes_path=classes_path,
            )

            insights = json.loads(insights_path.read_text())
            self.assertEqual(insights["latest"]["holiday"], True)
            self.assertEqual(insights["latest"]["holiday_label"], "Independence Day (observed)")
            self.assertEqual(insights["class_annotations"]["status"], "available")
            self.assertEqual(insights["recommendations"], [])
            self.assertEqual(insights["recommendations_status"], "insufficient_data")

    def test_invalid_class_file_does_not_stop_baseline_publishing(self):
        with tempfile.TemporaryDirectory() as directory:
            readings_path = Path(directory) / "readings.csv"
            insights_path = Path(directory) / "insights.json"
            classes_path = Path(directory) / "classes.csv"
            readings_path.write_text("timestamp_utc,occupancy,status\n2026-08-17T22:07:00Z,34,light\n")
            classes_path.write_text("wrong,header\n")

            main(readings_path, insights_path, generated_at="2026-08-17T23:00:00Z", classes_path=classes_path)

            insights = json.loads(insights_path.read_text())
            self.assertEqual(insights["baselines"], {"0-18:00": {"median": 34, "n": 1}})
            self.assertEqual(insights["class_annotations"], {"status": "unavailable", "items": []})

    def test_main_loads_weather_once_there_are_twenty_readings(self):
        requested = []

        def fetch_json(url):
            requested.append(url)
            return {
                "hourly": {
                    "time": ["2026-08-17T18:00"],
                    "temperature_2m": [25.0],
                    "apparent_temperature": [26.0],
                    "precipitation": [0.1],
                    "wind_speed_10m": [8.0],
                    "weather_code": [61],
                }
            }

        with tempfile.TemporaryDirectory() as directory:
            readings_path = Path(directory) / "readings.csv"
            insights_path = Path(directory) / "insights.json"
            readings_path.write_text(
                "timestamp_utc,occupancy,status\n"
                + "2026-08-17T22:07:00Z,34,light\n" * 20
            )

            main(readings_path, insights_path, fetch_json, "2026-08-17T23:00:00Z")

            insights = json.loads(insights_path.read_text())
            self.assertEqual(len(requested), 1)
            self.assertEqual(insights["correlations"], {"status": "insufficient_data"})

    def test_main_publishes_baselines_when_weather_loading_fails(self):
        def fetch_json(_url):
            raise OSError("weather service unavailable")

        with tempfile.TemporaryDirectory() as directory:
            readings_path = Path(directory) / "readings.csv"
            insights_path = Path(directory) / "insights.json"
            readings_path.write_text(
                "timestamp_utc,occupancy,status\n"
                + "2026-08-17T22:07:00Z,34,light\n" * 20
            )

            exit_code = main(readings_path, insights_path, fetch_json, "2026-08-17T23:00:00Z")

            self.assertEqual(exit_code, 0)
            insights = json.loads(insights_path.read_text())
            self.assertEqual(insights["generated_at"], "2026-08-17T23:00:00Z")
            self.assertEqual(insights["latest"]["occupancy"], 34)
            self.assertEqual(insights["baselines"], {"0-18:00": {"median": 34.0, "n": 20}})
            self.assertEqual(insights["correlations"], {"status": "insufficient_data"})

    def test_main_uses_the_standard_library_weather_fetcher_by_default(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(
                    {
                        "hourly": {
                            "time": ["2026-08-17T18:00"],
                            "temperature_2m": [25.0],
                            "apparent_temperature": [26.0],
                            "precipitation": [0.1],
                            "wind_speed_10m": [8.0],
                            "weather_code": [61],
                        }
                    }
                ).encode()

        with tempfile.TemporaryDirectory() as directory:
            readings_path = Path(directory) / "readings.csv"
            insights_path = Path(directory) / "insights.json"
            readings_path.write_text(
                "timestamp_utc,occupancy,status\n"
                + "2026-08-17T22:07:00Z,34,light\n" * 20
            )
            with mock.patch.object(analyze, "urlopen", return_value=Response()) as urlopen:
                main(readings_path, insights_path, generated_at="2026-08-17T23:00:00Z")

            self.assertEqual(urlopen.call_args.kwargs, {"timeout": 20})

    def test_main_labels_a_statistically_decisive_result_as_an_observed_association(self):
        new_york = ZoneInfo("America/New_York")
        first_local = datetime(2026, 1, 5, 18, 7, tzinfo=new_york)
        readings = []
        weather_times = []
        precipitation = []
        for index in range(40):
            local = first_local + timedelta(weeks=index)
            readings.append(
                f"{local.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')},{100 if index < 20 else 0},light\n"
            )
            weather_times.append(local.strftime("%Y-%m-%dT%H:00"))
            precipitation.append(0.2 if index < 20 else 0.0)

        def fetch_json(_url):
            return {
                "hourly": {
                    "time": weather_times,
                    "temperature_2m": [25.0] * 40,
                    "apparent_temperature": [26.0] * 40,
                    "precipitation": precipitation,
                    "wind_speed_10m": [8.0] * 40,
                    "weather_code": [61] * 40,
                }
            }

        with tempfile.TemporaryDirectory() as directory:
            readings_path = Path(directory) / "readings.csv"
            insights_path = Path(directory) / "insights.json"
            readings_path.write_text("timestamp_utc,occupancy,status\n" + "".join(readings))

            main(readings_path, insights_path, fetch_json, "2026-10-05T23:00:00Z")

            correlation = json.loads(insights_path.read_text())["correlations"]
            self.assertEqual(correlation["status"], "observed")
            self.assertEqual(correlation["label"], "observed association")


if __name__ == "__main__":
    unittest.main()
