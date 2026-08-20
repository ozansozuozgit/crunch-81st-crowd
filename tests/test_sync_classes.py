import unittest
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from scripts import sync_classes


class ScheduleParsingTests(unittest.TestCase):
    def test_parses_two_day_columns_and_calculates_end_time(self):
        records = [
            {"text": "Monday", "x": 100, "y": 700},
            {"text": "Tuesday", "x": 250, "y": 700},
            {"text": "Yoga Flow - GF Alex", "x": 100, "y": 620},
            {"text": "09:15 - 45m", "x": 100, "y": 605},
            {"text": "HIIT with Taylor", "x": 250, "y": 620},
            {"text": "18:30 - 60m", "x": 250, "y": 605},
        ]

        self.assertEqual(
            sync_classes.parse_weekly_schedule(records),
            [
                {
                    "weekday": 0,
                    "start_local": "09:15",
                    "end_local": "10:00",
                    "class_name": "Yoga Flow",
                },
                {
                    "weekday": 1,
                    "start_local": "18:30",
                    "end_local": "19:30",
                    "class_name": "HIIT",
                },
            ],
        )

    def test_rejects_schedule_when_no_valid_time_line_is_present(self):
        records = [
            {"text": "Monday", "x": 100, "y": 700},
            {"text": "Yoga Flow", "x": 100, "y": 620},
            {"text": "25:15 - 45m", "x": 100, "y": 605},
        ]

        with self.assertRaises(sync_classes.ScheduleParseError):
            sync_classes.parse_weekly_schedule(records)

    def test_handles_dated_headers_fragmented_class_names_and_instructors(self):
        records = [
            {"text": "MONDAY , 08/17 /26", "x": 100, "y": 700},
            {"text": "TUESDAY , 08/18/26", "x": 250, "y": 700},
            {"text": "HALFSIES: Ride +", "x": 100, "y": 620},
            {"text": "Absolution", "x": 100, "y": 609},
            {"text": " -  GF*", "x": 175, "y": 609},
            {"text": "06:30 - 45m Yesenia D", "x": 100, "y": 598},
            {"text": "Party Ride", "x": 250, "y": 620},
            {"text": " - GF*", "x": 320, "y": 620},
            {"text": "18:30 - 45m Chloe T", "x": 250, "y": 609},
        ]

        self.assertEqual(
            sync_classes.parse_weekly_schedule(records),
            [
                {
                    "weekday": 0,
                    "start_local": "06:30",
                    "end_local": "07:15",
                    "class_name": "HALFSIES: Ride + Absolution",
                },
                {
                    "weekday": 1,
                    "start_local": "18:30",
                    "end_local": "19:15",
                    "class_name": "Party Ride",
                },
            ],
        )

    def test_ignores_class_description_pages_after_the_weekly_grid(self):
        records = [
            {"text": "MONDAY , 08/17 /26", "x": 100, "y": 700, "page": 0},
            {"text": "Yoga", "x": 100, "y": 620, "page": 0},
            {"text": "09:15 - 45m Alex", "x": 100, "y": 605, "page": 0},
            {"text": "Long class description", "x": 100, "y": 620, "page": 1},
            {"text": "18:30 - 45m", "x": 100, "y": 605, "page": 1},
        ]

        self.assertEqual(
            sync_classes.parse_weekly_schedule(records),
            [{"weekday": 0, "start_local": "09:15", "end_local": "10:00", "class_name": "Yoga"}],
        )

    def test_uses_midday_section_label_to_normalize_afternoon_times(self):
        records = [
            {"text": "MONDAY , 08/17 /26", "x": 100, "y": 700},
            {"text": "MID-DAY", "x": 40, "y": 500},
            {"text": "Yoga", "x": 100, "y": 480},
            {"text": "5:00 - 60m Alex", "x": 100, "y": 465},
        ]

        self.assertEqual(
            sync_classes.parse_weekly_schedule(records),
            [{"weekday": 0, "start_local": "17:00", "end_local": "18:00", "class_name": "Yoga"}],
        )

    def test_ignores_page_titles_above_weekday_headers(self):
        records = [
            {"text": "Week of 08/17/26", "x": 100, "y": 750},
            {"text": "MONDAY , 08/17 /26", "x": 100, "y": 700},
            {"text": "Yoga", "x": 100, "y": 620},
            {"text": "09:15 - 45m Alex", "x": 100, "y": 605},
        ]

        self.assertEqual(
            sync_classes.parse_weekly_schedule(records),
            [{"weekday": 0, "start_local": "09:15", "end_local": "10:00", "class_name": "Yoga"}],
        )

    def test_removes_fragmentation_artifacts_from_class_names(self):
        records = [
            {"text": "MONDAY", "x": 100, "y": 700},
            {"text": "- B.L.T. Butt, Legs & - Thighs", "x": 100, "y": 620},
            {"text": "09:15 - 45m Alex", "x": 100, "y": 605},
        ]

        self.assertEqual(
            sync_classes.parse_weekly_schedule(records),
            [
                {
                    "weekday": 0,
                    "start_local": "09:15",
                    "end_local": "10:00",
                    "class_name": "B.L.T. Butt, Legs & Thighs",
                }
            ],
        )

    def test_infers_pm_after_a_noon_class_when_pdf_omits_meridiem(self):
        records = [
            {"text": "SATURDAY", "x": 100, "y": 700},
            {"text": "Noon class", "x": 100, "y": 620},
            {"text": "12:00 - 45m Alex", "x": 100, "y": 605},
            {"text": "Afternoon class", "x": 100, "y": 590},
            {"text": "1:00 - 30m Alex", "x": 100, "y": 575},
        ]

        self.assertEqual(
            sync_classes.parse_weekly_schedule(records),
            [
                {"weekday": 5, "start_local": "12:00", "end_local": "12:45", "class_name": "Noon class"},
                {"weekday": 5, "start_local": "13:00", "end_local": "13:30", "class_name": "Afternoon class"},
            ],
        )

    def test_extracts_positioned_text_with_pypdf_visitor(self):
        class FakePage:
            def extract_text(self, visitor_text):
                visitor_text("Yoga", [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 123, 456], None, 12)

        class FakeReader:
            pages = [FakePage()]

        with mock.patch("pypdf.PdfReader", return_value=FakeReader()):
            self.assertEqual(
                sync_classes.extract_positioned_text(b"not-a-real-pdf"),
                [{"text": "Yoga", "x": 123.0, "y": 456.0, "page": 0}],
            )


class ScheduleSyncTests(unittest.TestCase):
    def test_replaces_schedule_and_marks_metadata_fresh_after_valid_fetch(self):
        records = [
            {"text": "Monday", "x": 100, "y": 700},
            {"text": "Yoga", "x": 100, "y": 620},
            {"text": "09:15 - 45m", "x": 100, "y": 605},
        ]
        now = datetime(2026, 8, 20, 12, 30, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            sync_classes, "extract_positioned_text", return_value=records
        ):
            classes_path = Path(directory) / "classes.csv"
            meta_path = Path(directory) / "classes_meta.json"
            classes_path.write_text("weekday,start_local,end_local,class_name\n0,08:00,09:00,Old class\n")

            self.assertEqual(
                sync_classes.sync(lambda: b"pdf", classes_path, meta_path, now),
                {"status": "fresh", "class_count": 1},
            )
            self.assertEqual(
                classes_path.read_text(),
                "weekday,start_local,end_local,class_name\n0,09:15,10:00,Yoga\n",
            )
            self.assertEqual(
                json.loads(meta_path.read_text()),
                {
                    "status": "fresh",
                    "source_url": sync_classes.SOURCE_URL,
                    "fetched_at": "2026-08-20T12:30:00Z",
                },
            )

    def test_retains_existing_schedule_and_marks_metadata_stale_on_fetch_failure(self):
        now = datetime(2026, 8, 20, 12, 30, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            classes_path = Path(directory) / "classes.csv"
            meta_path = Path(directory) / "classes_meta.json"
            known_good = "weekday,start_local,end_local,class_name\n0,08:00,09:00,Old class\n"
            classes_path.write_text(known_good)

            result = sync_classes.sync(
                lambda: (_ for _ in ()).throw(TimeoutError("upstream unavailable")),
                classes_path,
                meta_path,
                now,
            )

            self.assertEqual(result, {"status": "stale", "class_count": 1})
            self.assertEqual(classes_path.read_text(), known_good)
            metadata = json.loads(meta_path.read_text())
            self.assertEqual(metadata["status"], "stale")
            self.assertEqual(metadata["source_url"], sync_classes.SOURCE_URL)
            self.assertEqual(metadata["fetched_at"], "2026-08-20T12:30:00Z")
            self.assertEqual(metadata["error"], {"class": "TimeoutError", "message": "upstream unavailable"})


class CommandLineTests(unittest.TestCase):
    def test_fetches_public_pdf_with_timeout_and_descriptive_user_agent(self):
        with mock.patch.object(sync_classes, "urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.read.return_value = b"pdf"

            self.assertEqual(sync_classes._fetch_public_schedule(), b"pdf")

        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, sync_classes.SOURCE_URL)
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 20)
        self.assertIn("crunch-81st-crowd", request.get_header("User-agent"))

    def test_exits_zero_when_a_stale_schedule_was_retained(self):
        with mock.patch.object(
            sync_classes, "sync", return_value={"status": "stale", "class_count": 1}
        ) as sync:
            self.assertEqual(sync_classes.main(), 0)

        self.assertEqual(sync.call_args.args[1:3], (sync_classes.DEFAULT_CLASSES_PATH, sync_classes.DEFAULT_META_PATH))

    def test_exits_nonzero_when_no_schedule_exists_after_a_stale_refresh(self):
        with mock.patch.object(
            sync_classes, "sync", return_value={"status": "stale", "class_count": 0}
        ):
            self.assertEqual(sync_classes.main(), 1)


if __name__ == "__main__":
    unittest.main()
