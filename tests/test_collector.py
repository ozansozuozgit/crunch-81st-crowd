import csv
import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from pathlib import Path
from unittest import mock
from urllib.error import URLError
from zoneinfo import ZoneInfo

from scripts import collector
from scripts.collector import append_reading, collect, is_scheduled_open, main, parse_club_record


class ParseClubRecordTests(unittest.TestCase):
    def test_returns_occupancy_and_status_from_entity_encoded_react_props(self):
        page = '''
        <div
          data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:34,&quot;occupancy_status&quot;:&quot;light&quot;}}"
        ></div>
        '''

        self.assertEqual(parse_club_record(page), (34, "light"))

    def test_rejects_a_page_without_react_props(self):
        with self.assertRaises(ValueError):
            parse_club_record("<main>Crunch E 81st St</main>")

    def test_rejects_negative_occupancy(self):
        page = '''
        <div
          data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:-1,&quot;occupancy_status&quot;:&quot;light&quot;}}"
        ></div>
        '''

        with self.assertRaises(ValueError):
            parse_club_record(page)


class AppendReadingTests(unittest.TestCase):
    def test_creates_a_readings_file_with_header_and_one_row(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "readings.csv"

            changed = append_reading(path, "2026-08-17T12:00:00Z", 34, "light")

            self.assertTrue(changed)
            with path.open(newline="") as file:
                self.assertEqual(
                    list(csv.DictReader(file)),
                    [{"timestamp_utc": "2026-08-17T12:00:00Z", "occupancy": "34", "status": "light"}],
                )
            self.assertEqual(path.read_text().splitlines()[0], "timestamp_utc,occupancy,status")

    def test_does_not_change_existing_data_when_timestamp_already_exists(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "readings.csv"
            path.write_text(
                "timestamp_utc,occupancy,status\n"
                "2026-08-17T12:00:00Z,34,light\n"
                "2026-08-17T12:10:00Z,45,moderate\n"
            )
            original = path.read_bytes()

            changed = append_reading(path, "2026-08-17T12:00:00Z", 99, "full")

            self.assertFalse(changed)
            self.assertEqual(path.read_bytes(), original)


class ScheduledOpenTests(unittest.TestCase):
    def test_sunday_at_0759_new_york_time_is_closed(self):
        now = datetime(2026, 8, 16, 7, 59, tzinfo=ZoneInfo("America/New_York"))

        self.assertFalse(is_scheduled_open(now))


class CollectTests(unittest.TestCase):
    def test_skips_fetching_when_the_club_is_scheduled_closed(self):
        now = datetime(2026, 8, 16, 7, 59, tzinfo=ZoneInfo("America/New_York"))

        def fetcher(_url):
            self.fail("fetcher must not be called outside scheduled hours")

        with tempfile.TemporaryDirectory() as directory:
            changed = collect(now, fetcher, Path(directory) / "readings.csv")

        self.assertFalse(changed)

    def test_fetches_parses_and_persists_an_open_hour_reading_in_utc_seconds(self):
        now = datetime(2026, 8, 16, 9, 15, 42, 900000, tzinfo=ZoneInfo("America/New_York"))
        requested_urls = []

        def fetcher(url):
            requested_urls.append(url)
            return '''<div data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:34,&quot;occupancy_status&quot;:&quot;light&quot;}}"></div>'''

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "readings.csv"

            changed = collect(now, fetcher, path)

            self.assertTrue(changed)
            self.assertEqual(
                path.read_text(),
                "timestamp_utc,occupancy,status\n2026-08-16T13:15:42Z,34,light\n",
            )
        self.assertEqual(requested_urls, ["https://www.crunch.com/locations/e-81st-st"])


class MainTests(unittest.TestCase):
    def test_records_a_reading_using_a_descriptive_user_agent_and_twenty_second_timeout(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'<div data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:34,&quot;occupancy_status&quot;:&quot;light&quot;}}"></div>'

        now = datetime(2026, 8, 16, 9, 15, tzinfo=ZoneInfo("America/New_York"))
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "readings.csv"
            with (
                mock.patch.object(collector, "DEFAULT_TARGET", target),
                mock.patch.object(collector, "urlopen", return_value=Response()) as urlopen,
                redirect_stdout(io.StringIO()) as output,
            ):
                exit_code = main(now)

            self.assertEqual(exit_code, 0)
            self.assertEqual(output.getvalue(), "recorded\n")
            request = urlopen.call_args.args[0]
            self.assertEqual(urlopen.call_args.kwargs, {"timeout": 20})
            self.assertTrue(request.get_header("User-agent"))

    def test_returns_nonzero_for_a_network_error(self):
        now = datetime(2026, 8, 16, 9, 15, tzinfo=ZoneInfo("America/New_York"))
        with (
            mock.patch.object(collector, "urlopen", side_effect=URLError("offline")),
            redirect_stderr(io.StringIO()) as errors,
        ):
            exit_code = main(now)

        self.assertNotEqual(exit_code, 0)
        self.assertIn("collector failed", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
