import csv
import html
import json
import re
import sys
from datetime import datetime, time, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


READING_FIELDS = ("timestamp_utc", "occupancy", "status")
NEW_YORK = ZoneInfo("America/New_York")
WEEKLY_HOURS = {
    0: (time(5), time(23)),
    1: (time(5), time(23)),
    2: (time(5), time(23)),
    3: (time(5), time(23)),
    4: (time(5), time(22)),
    5: (time(7), time(21)),
    6: (time(8), time(21)),
}
CRUNCH_E_81ST_URL = "https://www.crunch.com/locations/e-81st-st"
DEFAULT_TARGET = Path(__file__).resolve().parents[1] / "docs" / "data" / "readings.csv"


def is_scheduled_open(now: datetime) -> bool:
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")

    local_now = now.astimezone(NEW_YORK)
    opens_at, closes_at = WEEKLY_HOURS[local_now.weekday()]
    return opens_at <= local_now.timetz().replace(tzinfo=None) < closes_at


def collect(now: datetime, fetcher, target: Path) -> bool:
    if not is_scheduled_open(now):
        return False
    occupancy, status = parse_club_record(fetcher(CRUNCH_E_81ST_URL))
    timestamp_utc = (
        now.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
    return append_reading(target, timestamp_utc, occupancy, status)


def fetch_page(url: str) -> str:
    request = Request(url, headers={"User-Agent": "crunch-81st-crowd-collector/1.0"})
    with urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8")


def main(now: datetime | None = None) -> int:
    try:
        changed = collect(now or datetime.now(timezone.utc), fetch_page, DEFAULT_TARGET)
    except (OSError, UnicodeDecodeError, ValueError) as error:
        print(f"collector failed: {error}", file=sys.stderr)
        return 1
    print("recorded" if changed else "unchanged")
    return 0


def append_reading(path: Path, timestamp_utc: str, occupancy: int, status: str) -> bool:
    path = Path(path)
    if path.exists():
        with path.open(newline="") as file:
            if any(row["timestamp_utc"] == timestamp_utc for row in csv.DictReader(file)):
                return False
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=READING_FIELDS)
        if file.tell() == 0:
            writer.writeheader()
        writer.writerow(
            {"timestamp_utc": timestamp_utc, "occupancy": occupancy, "status": status}
        )
    return True


def parse_club_record(page: str) -> tuple[int, str]:
    match = re.search(r'data-react-props="([^"]*)"', page)
    if match is None:
        raise ValueError("missing data-react-props")

    try:
        props = json.loads(html.unescape(match.group(1)))
        club = props["club"]
        occupancy = club["current_occupancy"]
        status = club["occupancy_status"]
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise ValueError("invalid club record") from error

    if isinstance(occupancy, bool) or not isinstance(occupancy, int) or occupancy < 0:
        raise ValueError("invalid occupancy")
    if not isinstance(status, str) or not status:
        raise ValueError("invalid occupancy status")

    return occupancy, status


if __name__ == "__main__":
    raise SystemExit(main())
