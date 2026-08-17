"""Resolve one append-only readings.csv conflict without dropping a reading."""

import csv
import io
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path


HEADER = ("timestamp_utc", "occupancy", "status")
HEADER_LINE = ",".join(HEADER)
DEFAULT_TARGET = Path(__file__).resolve().parents[1] / "docs" / "data" / "readings.csv"


def resolve_conflict(content: str) -> str:
    """Return a canonical readings CSV from one well-formed Git conflict block.

    The resolver accepts either the normal shared header or a header repeated on
    both conflict sides. Any malformed marker, record, or ambiguous duplicate
    timestamp is rejected so the workflow never silently invents a reading.
    """

    lines = content.splitlines()
    start, separator, end = _conflict_indexes(lines)
    prefix = lines[:start]
    ours = lines[start + 1 : separator]
    theirs = lines[separator + 1 : end]
    suffix = lines[end + 1 :]

    _validate_headers(prefix, ours, theirs, suffix)
    rows_by_timestamp: dict[str, tuple[datetime, tuple[str, str, str]]] = {}
    for line in [*prefix, *ours, *theirs, *suffix]:
        if line == HEADER_LINE:
            continue
        timestamp, row = _parse_row(line)
        existing = rows_by_timestamp.get(row[0])
        if existing is not None and existing[1] != row:
            raise ValueError(f"conflicting rows for timestamp {row[0]}")
        rows_by_timestamp[row[0]] = (timestamp, row)

    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(HEADER)
    for _, row in sorted(rows_by_timestamp.values(), key=lambda item: item[0]):
        writer.writerow(row)
    return output.getvalue()


def _conflict_indexes(lines: list[str]) -> tuple[int, int, int]:
    starts = [index for index, line in enumerate(lines) if line.startswith("<<<<<<<")]
    separators = [index for index, line in enumerate(lines) if line.startswith("=======")]
    ends = [index for index, line in enumerate(lines) if line.startswith(">>>>>>>")]
    if len(starts) != 1 or len(separators) != 1 or len(ends) != 1:
        raise ValueError("expected exactly one conflict block")

    start, separator, end = starts[0], separators[0], ends[0]
    if not (
        lines[start].startswith("<<<<<<< ")
        and lines[separator] == "======="
        and lines[end].startswith(">>>>>>> ")
        and start < separator < end
    ):
        raise ValueError("malformed conflict markers")
    return start, separator, end


def _validate_headers(prefix: list[str], ours: list[str], theirs: list[str], suffix: list[str]) -> None:
    common = [*prefix, *suffix]
    common_headers = common.count(HEADER_LINE)
    ours_headers = ours.count(HEADER_LINE)
    theirs_headers = theirs.count(HEADER_LINE)
    shared_header = common_headers == 1 and ours_headers == 0 and theirs_headers == 0
    duplicated_headers = common_headers == 0 and ours_headers == 1 and theirs_headers == 1
    if not (shared_header or duplicated_headers):
        raise ValueError("expected one shared header or one header on each conflict side")
    if shared_header and prefix[:1] != [HEADER_LINE]:
        raise ValueError("shared header must be the first line")
    if duplicated_headers and (ours[:1] != [HEADER_LINE] or theirs[:1] != [HEADER_LINE]):
        raise ValueError("side headers must be the first line on both conflict sides")


def _parse_row(line: str) -> tuple[datetime, tuple[str, str, str]]:
    try:
        values = next(csv.reader([line], strict=True))
    except csv.Error as error:
        raise ValueError("invalid CSV row") from error
    if len(values) != len(HEADER) or not all(values):
        raise ValueError("invalid readings row")

    timestamp_text, occupancy_text, status = values
    if not timestamp_text.endswith("Z"):
        raise ValueError("timestamp must be UTC Z format")
    try:
        timestamp = datetime.fromisoformat(timestamp_text.replace("Z", "+00:00"))
        occupancy = int(occupancy_text)
    except ValueError as error:
        raise ValueError("invalid readings row") from error
    if timestamp.tzinfo is None or occupancy < 0 or not status.strip():
        raise ValueError("invalid readings row")
    return timestamp, (timestamp_text, occupancy_text, status)


def main(target: Path = DEFAULT_TARGET) -> int:
    try:
        path = Path(target)
        resolved = resolve_conflict(path.read_text())
        with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as file:
            file.write(resolved)
            temporary_path = file.name
        os.replace(temporary_path, path)
    except (OSError, ValueError) as error:
        print(f"readings conflict resolver failed: {error}", file=sys.stderr)
        return 1
    print("resolved readings conflict")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
