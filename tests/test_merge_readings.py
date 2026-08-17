import unittest

from scripts.merge_readings import resolve_conflict


HEADER = "timestamp_utc,occupancy,status"


class ResolveConflictTests(unittest.TestCase):
    def test_unions_and_sorts_unique_valid_rows_from_both_sides(self):
        conflict = "\n".join(
            (
                HEADER,
                "<<<<<<< HEAD",
                "2026-08-17T12:20:00Z,42,moderate",
                "2026-08-17T12:30:00Z,48,moderate",
                "=======",
                "2026-08-17T12:10:00Z,35,light",
                "2026-08-17T12:20:00Z,42,moderate",
                ">>>>>>> collector commit",
                "",
            )
        )

        self.assertEqual(
            resolve_conflict(conflict),
            "\n".join(
                (
                    HEADER,
                    "2026-08-17T12:10:00Z,35,light",
                    "2026-08-17T12:20:00Z,42,moderate",
                    "2026-08-17T12:30:00Z,48,moderate",
                    "",
                )
            ),
        )

    def test_accepts_a_header_on_each_conflict_side(self):
        conflict = "\n".join(
            (
                "<<<<<<< HEAD",
                HEADER,
                "2026-08-17T12:20:00Z,42,moderate",
                "=======",
                HEADER,
                "2026-08-17T12:10:00Z,35,light",
                ">>>>>>> collector commit",
                "",
            )
        )

        self.assertEqual(
            resolve_conflict(conflict),
            "\n".join(
                (
                    HEADER,
                    "2026-08-17T12:10:00Z,35,light",
                    "2026-08-17T12:20:00Z,42,moderate",
                    "",
                )
            ),
        )

    def test_rejects_malformed_or_ambiguous_conflict_input(self):
        cases = {
            "no conflict markers": HEADER + "\n2026-08-17T12:10:00Z,35,light\n",
            "malformed row": "\n".join(
                (
                    HEADER,
                    "<<<<<<< HEAD",
                    "2026-08-17T12:20:00Z,not-a-number,moderate",
                    "=======",
                    "2026-08-17T12:10:00Z,35,light",
                    ">>>>>>> collector commit",
                )
            ),
            "conflicting duplicate timestamp": "\n".join(
                (
                    HEADER,
                    "<<<<<<< HEAD",
                    "2026-08-17T12:20:00Z,42,moderate",
                    "=======",
                    "2026-08-17T12:20:00Z,55,full",
                    ">>>>>>> collector commit",
                )
            ),
        }

        for label, conflict in cases.items():
            with self.subTest(label=label):
                with self.assertRaises(ValueError):
                    resolve_conflict(conflict)


if __name__ == "__main__":
    unittest.main()
