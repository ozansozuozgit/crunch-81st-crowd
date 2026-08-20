"""Fetch and normalize the public Crunch E 81st weekly class schedule."""

from datetime import datetime, timedelta, timezone
from io import BytesIO
import csv
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.request import Request, urlopen

import pypdf


SOURCE_URL = "https://class-prod.crunch.com/week_schedule.pdf?button_location=web&club_id=40&options=group"
CLASS_FIELDS = ("weekday", "start_local", "end_local", "class_name")
DEFAULT_CLASSES_PATH = Path(__file__).resolve().parents[1] / "docs" / "data" / "classes.csv"
DEFAULT_META_PATH = Path(__file__).resolve().parents[1] / "docs" / "data" / "classes_meta.json"
_DAY_NAMES = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_TIME_LINE = re.compile(
    r"^(?P<hour>\d{1,2}):(?P<minute>[0-5]\d)\s*-\s*(?P<duration>\d{1,3})m\b",
    re.I,
)


class ScheduleParseError(ValueError):
    """The public PDF did not contain a safe, usable weekly schedule."""


def extract_positioned_text(pdf_bytes: bytes) -> list[dict]:
    """Extract non-empty text fragments and their PDF text-matrix positions."""
    records = []

    for page_number, page in enumerate(pypdf.PdfReader(BytesIO(pdf_bytes)).pages):
        def visitor(text, _cm, tm, _font_dict, _font_size, page_number=page_number):
            if text.strip():
                records.append(
                    {"text": text, "x": float(tm[4]), "y": float(tm[5]), "page": page_number}
                )

        page.extract_text(visitor_text=visitor)
    return records


def _clean_name(value: str) -> str:
    value = re.sub(r"\s*-\s*(?:GF\b.*|Y\*.*)$", "", value, flags=re.I)
    value = re.sub(r"\s+(?:with|w/)\s+.+$", "", value, flags=re.I)
    value = re.sub(r"^\s*-\s*", "", value)
    value = re.sub(r"\s*&\s*-\s*", " & ", value)
    return " ".join(value.split())


def _time_range(value: str, is_pm: bool = False) -> tuple[str, str] | None:
    match = _TIME_LINE.match(" ".join(value.split()))
    if not match:
        return None
    hour = int(match["hour"])
    if hour > 23:
        return None
    if is_pm and hour < 12:
        hour += 12
    start = f"{hour:02d}:{match['minute']}"
    duration = int(match["duration"])
    if duration <= 0:
        return None
    start_at = datetime.strptime(start, "%H:%M")
    end_at = start_at + timedelta(minutes=duration)
    if end_at.date() != start_at.date():
        return None
    return start, end_at.strftime("%H:%M")


def _add_twelve_hours(time_range: tuple[str, str]) -> tuple[str, str]:
    return tuple(
        (datetime.strptime(value, "%H:%M") + timedelta(hours=12)).strftime("%H:%M")
        for value in time_range
    )


def parse_weekly_schedule(records: list[dict]) -> list[dict]:
    """Turn positioned PDF text into normalized weekly class annotations."""
    headers_by_page: dict[int, list[tuple[float, int]]] = {}
    for record in records:
        text = " ".join(str(record.get("text", "")).split()).casefold()
        for weekday, day in enumerate(_DAY_NAMES):
            if re.match(rf"^{day}\b", text):
                page = int(record.get("page", 0))
                headers_by_page.setdefault(page, []).append((float(record["x"]), weekday))
                break
    if not headers_by_page:
        raise ScheduleParseError("missing weekday columns")
    schedule_page = max(headers_by_page, key=lambda page: len(headers_by_page[page]))
    headers = headers_by_page[schedule_page]
    headers.sort()
    schedule_header_y = max(
        float(record["y"])
        for record in records
        if int(record.get("page", 0)) == schedule_page
        and any(
            re.match(rf"^{day}\b", " ".join(str(record.get("text", "")).split()), re.I)
            for day in _DAY_NAMES
        )
    )
    midday_y = next(
        (
            float(record["y"])
            for record in records
            if int(record.get("page", 0)) == schedule_page
            and " ".join(str(record.get("text", "")).split()).upper() == "MID-DAY"
        ),
        None,
    )

    lines_by_weekday: dict[int, list[dict]] = {weekday: [] for _, weekday in headers}
    for record in records:
        if int(record.get("page", 0)) != schedule_page:
            continue
        text = " ".join(str(record.get("text", "")).split())
        if not text or any(re.match(rf"^{day}\b", text, re.I) for day in _DAY_NAMES):
            continue
        x, y = float(record["x"]), float(record["y"])
        if y >= schedule_header_y:
            continue
        _, weekday = min(headers, key=lambda header: abs(header[0] - x))
        matching_line = next(
            (line for line in lines_by_weekday[weekday] if abs(line["y"] - y) < 2), None
        )
        if matching_line is None:
            matching_line = {"y": y, "fragments": []}
            lines_by_weekday[weekday].append(matching_line)
        matching_line["fragments"].append((x, text))

    rows = []
    for weekday in sorted(lines_by_weekday):
        pending_name_lines = []
        previous_start_minutes = None
        for line in sorted(lines_by_weekday[weekday], key=lambda line: line["y"], reverse=True):
            text = " ".join(text for _, text in sorted(line["fragments"]))
            time_range = _time_range(text, is_pm=midday_y is not None and line["y"] < midday_y)
            if time_range is None:
                if not text.isupper():
                    pending_name_lines.append(text)
                continue
            name = _clean_name(" ".join(pending_name_lines))
            pending_name_lines = []
            if not name:
                continue
            start, end = time_range
            start_minutes = datetime.strptime(start, "%H:%M").hour * 60 + datetime.strptime(
                start, "%H:%M"
            ).minute
            if previous_start_minutes is not None and start_minutes < previous_start_minutes:
                start, end = _add_twelve_hours((start, end))
                start_minutes += 12 * 60
            previous_start_minutes = start_minutes
            rows.append(
                {"weekday": weekday, "start_local": start, "end_local": end, "class_name": name}
            )

    seen = set()
    unique_rows = []
    for row in rows:
        key = tuple(row[field] for field in CLASS_FIELDS)
        if key not in seen:
            seen.add(key)
            unique_rows.append(row)
    if not unique_rows:
        raise ScheduleParseError("no valid class rows")
    return unique_rows


def _timestamp(now: datetime) -> str:
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as file:
        file.write(content)
        temporary_path = Path(file.name)
    os.replace(temporary_path, path)


def _csv_content(rows: list[dict]) -> str:
    from io import StringIO

    output = StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CLASS_FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def _existing_class_count(path: Path) -> int:
    try:
        with path.open(newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            if tuple(reader.fieldnames or ()) != CLASS_FIELDS:
                return 0
            rows = list(reader)
    except (OSError, UnicodeDecodeError, csv.Error):
        return 0
    try:
        return len(_validated_rows(rows))
    except ScheduleParseError:
        return 0


def _validated_rows(rows: list[dict]) -> list[dict]:
    valid = []
    seen = set()
    for row in rows:
        try:
            weekday = int(row["weekday"])
            start = datetime.strptime(row["start_local"], "%H:%M")
            end = datetime.strptime(row["end_local"], "%H:%M")
            name = str(row["class_name"]).strip()
            if not 0 <= weekday <= 6 or start >= end or not name:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise ScheduleParseError("invalid class row") from None
        normalized = {
            "weekday": weekday,
            "start_local": start.strftime("%H:%M"),
            "end_local": end.strftime("%H:%M"),
            "class_name": name,
        }
        key = tuple(normalized[field] for field in CLASS_FIELDS)
        if key not in seen:
            seen.add(key)
            valid.append(normalized)
    if not valid:
        raise ScheduleParseError("no valid class rows")
    return valid


def _safe_error(error: Exception) -> dict[str, str]:
    return {
        "class": type(error).__name__,
        "message": " ".join(str(error).split())[:240] or "schedule refresh failed",
    }


def sync(fetch_bytes, classes_path: Path, meta_path: Path, now: datetime) -> dict:
    """Refresh the known-good schedule; safely retain it if refresh fails."""
    classes_path = Path(classes_path)
    meta_path = Path(meta_path)
    fetched_at = _timestamp(now)
    try:
        rows = _validated_rows(parse_weekly_schedule(extract_positioned_text(fetch_bytes())))
        _atomic_write(classes_path, _csv_content(rows))
        _atomic_write(
            meta_path,
            json.dumps(
                {"status": "fresh", "source_url": SOURCE_URL, "fetched_at": fetched_at},
                indent=2,
            )
            + "\n",
        )
        return {"status": "fresh", "class_count": len(rows)}
    except Exception as error:
        retained_count = _existing_class_count(classes_path)
        _atomic_write(
            meta_path,
            json.dumps(
                {
                    "status": "stale",
                    "source_url": SOURCE_URL,
                    "fetched_at": fetched_at,
                    "error": _safe_error(error),
                },
                indent=2,
            )
            + "\n",
        )
        return {"status": "stale", "class_count": retained_count}


def _fetch_public_schedule() -> bytes:
    request = Request(
        SOURCE_URL,
        headers={"User-Agent": "crunch-81st-crowd-schedule-sync/1.0"},
    )
    with urlopen(request, timeout=20) as response:
        return response.read()


def main() -> int:
    result = sync(_fetch_public_schedule, DEFAULT_CLASSES_PATH, DEFAULT_META_PATH, datetime.now(timezone.utc))
    print(f"Class schedule sync: {result['status']} ({result['class_count']} classes)")
    return 1 if result["status"] == "stale" and result["class_count"] == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
