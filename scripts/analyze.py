import csv
import json
import os
import tempfile
from datetime import date, datetime, timedelta
from math import isfinite, sqrt
from pathlib import Path
from statistics import fmean, median, variance
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
WEATHER_FIELDS = (
    "temperature_2m",
    "apparent_temperature",
    "precipitation",
    "wind_speed_10m",
    "weather_code",
)
NEW_YORK = ZoneInfo("America/New_York")
DEFAULT_READINGS_PATH = Path(__file__).resolve().parents[1] / "docs" / "data" / "readings.csv"
DEFAULT_INSIGHTS_PATH = Path(__file__).resolve().parents[1] / "docs" / "data" / "insights.json"
DEFAULT_CLASSES_PATH = Path(__file__).resolve().parents[1] / "docs" / "data" / "classes.csv"
DEFAULT_CLASSES_META_PATH = Path(__file__).resolve().parents[1] / "docs" / "data" / "classes_meta.json"
CLASS_FIELDS = ("weekday", "start_local", "end_local", "class_name")
WEATHER_REQUIRED_DATES_PER_GROUP = 20
RECOMMENDATION_REQUIRED_DATES = 4


def slot_key(local_iso: str) -> str:
    local = datetime.fromisoformat(local_iso)
    minute = local.minute - (local.minute % 10)
    return f"{local.weekday()}-{local.hour:02d}:{minute:02d}"


def holiday_context(local_date: str) -> dict[str, bool | str | None]:
    target = date.fromisoformat(local_date)
    for year in range(target.year - 1, target.year + 2):
        for holiday_date, label in _fixed_federal_holidays(year).items():
            if target == holiday_date:
                return {"holiday": True, "holiday_label": label}
            observed = _observed_date(holiday_date)
            if target == observed:
                return {"holiday": True, "holiday_label": f"{label} (observed)"}

    for holiday_date, label in _movable_federal_holidays(target.year).items():
        if target == holiday_date:
            return {"holiday": True, "holiday_label": label}
    return {"holiday": False, "holiday_label": None}


def _fixed_federal_holidays(year: int) -> dict[date, str]:
    holidays = {
        date(year, 1, 1): "New Year's Day",
        date(year, 7, 4): "Independence Day",
        date(year, 11, 11): "Veterans Day",
        date(year, 12, 25): "Christmas Day",
    }
    if year >= 2021:
        holidays[date(year, 6, 19)] = "Juneteenth National Independence Day"
    return holidays


def _movable_federal_holidays(year: int) -> dict[date, str]:
    return {
        _nth_weekday(year, 1, 0, 3): "Martin Luther King Jr. Day",
        _nth_weekday(year, 2, 0, 3): "Washington's Birthday",
        _last_weekday(year, 5, 0): "Memorial Day",
        _nth_weekday(year, 9, 0, 1): "Labor Day",
        _nth_weekday(year, 10, 0, 2): "Columbus Day",
        _nth_weekday(year, 11, 3, 4): "Thanksgiving Day",
    }


def _nth_weekday(year: int, month: int, weekday: int, occurrence: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + (occurrence - 1) * 7)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    days_before = (next_month.weekday() - weekday) % 7
    return next_month - timedelta(days=days_before or 7)


def _observed_date(holiday: date) -> date:
    if holiday.weekday() == 5:
        return holiday - timedelta(days=1)
    if holiday.weekday() == 6:
        return holiday + timedelta(days=1)
    return holiday


def median_baseline(readings: list[dict]) -> dict[str, dict[str, int | float]]:
    occupancies_by_slot: dict[str, list[int | float]] = {}
    for reading in readings:
        key = slot_key(reading["local"])
        occupancies_by_slot.setdefault(key, []).append(reading["occupancy"])

    return {
        key: {"median": median(occupancies), "n": len(occupancies)}
        for key, occupancies in sorted(occupancies_by_slot.items())
    }


def load_class_schedule(path: Path) -> dict[str, list[dict] | str]:
    try:
        with Path(path).open(newline="") as file:
            reader = csv.DictReader(file)
            if tuple(reader.fieldnames or ()) != CLASS_FIELDS:
                return {"status": "unavailable", "items": []}
            source_rows = list(reader)
    except (OSError, UnicodeDecodeError, csv.Error):
        return {"status": "unavailable", "items": []}

    if not source_rows:
        return {"status": "empty", "items": []}

    items = []
    invalid_rows = False
    for row in source_rows:
        try:
            weekday = int(row["weekday"])
            start = datetime.strptime(row["start_local"], "%H:%M").time()
            end = datetime.strptime(row["end_local"], "%H:%M").time()
            class_name = row["class_name"].strip()
            if not 0 <= weekday <= 6 or start >= end or not class_name:
                raise ValueError("invalid class row")
        except (TypeError, ValueError):
            invalid_rows = True
            continue
        items.append(
            {
                "weekday": weekday,
                "start_local": row["start_local"],
                "end_local": row["end_local"],
                "class_name": class_name,
            }
        )

    if not items:
        return {"status": "unavailable", "items": []}
    return {"status": "partial" if invalid_rows else "available", "items": items}


def load_class_schedule_metadata(path: Path) -> dict[str, str]:
    try:
        metadata = json.loads(Path(path).read_text())
        status = metadata["status"]
        source_url = metadata["source_url"]
        fetched_at = metadata["fetched_at"]
        last_attempt_at = metadata.get("last_attempt_at")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, ValueError):
        return {"status": "unavailable"}

    if (
        status not in {"fresh", "stale"}
        or not isinstance(source_url, str)
        or not isinstance(fetched_at, str)
        or (last_attempt_at is not None and not isinstance(last_attempt_at, str))
    ):
        return {"status": "unavailable"}
    try:
        parsed_url = urlparse(source_url)
        fetched_datetime = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
        attempt_datetime = (
            datetime.fromisoformat(last_attempt_at.replace("Z", "+00:00"))
            if last_attempt_at is not None
            else None
        )
    except ValueError:
        return {"status": "unavailable"}
    if (
        parsed_url.scheme not in {"http", "https"}
        or not parsed_url.netloc
        or fetched_datetime.tzinfo is None
        or fetched_datetime.utcoffset() is None
        or (attempt_datetime is not None and (attempt_datetime.tzinfo is None or attempt_datetime.utcoffset() is None))
    ):
        return {"status": "unavailable"}
    schedule = {"status": status, "source_url": source_url, "fetched_at": fetched_at}
    if last_attempt_at is not None:
        schedule["last_attempt_at"] = last_attempt_at
    return schedule


def quiet_window_recommendations(readings: list[dict]) -> dict[str, list[dict] | str]:
    details = quiet_window_details(readings)
    if details["status"] != "ready":
        return {"status": "insufficient_data", "items": []}
    return {
        "status": "ready",
        "items": [
            {
                "slot": detail["slot"],
                "baseline_occupancy": detail["baseline_occupancy"],
                "independent_dates": detail["independent_dates"],
            }
            for detail in details["items"]
        ],
    }


def recommendation_progress(readings: list[dict]) -> dict[str, int | str]:
    grouped = _occupancies_by_slot_and_date(readings)
    matching_dates = max((len(dates) for dates in grouped.values()), default=0)
    return {
        "matching_dates": matching_dates,
        "required_dates": RECOMMENDATION_REQUIRED_DATES,
        "status": "ready" if matching_dates >= RECOMMENDATION_REQUIRED_DATES else "collecting",
    }


def _occupancies_by_slot_and_date(readings: list[dict]) -> dict[str, dict[str, list[int | float]]]:
    """Group interval observations into one independent local date per slot."""
    grouped: dict[str, dict[str, list[int | float]]] = {}
    for reading in readings:
        local = datetime.fromisoformat(reading["local"])
        grouped.setdefault(slot_key(reading["local"]), {}).setdefault(local.date().isoformat(), []).append(
            reading["occupancy"]
        )
    return grouped


def _finite_daily_values(occupancies_by_date: dict[str, list[int | float]]) -> dict[str, float]:
    daily_values = {}
    for local_date, values in occupancies_by_date.items():
        try:
            daily_value = fmean(values)
        except (TypeError, ValueError):
            continue
        if isfinite(daily_value):
            daily_values[local_date] = daily_value
    return daily_values


def _weekly_values(daily_values: dict[str, float]) -> list[float]:
    values_by_week: dict[tuple[int, int], list[float]] = {}
    for local_date, value in daily_values.items():
        iso_year, iso_week, _ = date.fromisoformat(local_date).isocalendar()
        values_by_week.setdefault((iso_year, iso_week), []).append(value)
    return [fmean(values) for values in values_by_week.values()]


def quiet_window_details(readings: list[dict]) -> dict[str, list[dict] | str]:
    candidates = []
    for slot, occupancies_by_date in _occupancies_by_slot_and_date(readings).items():
        # Adjacent samples from a single day are reduced to one daily mean.
        daily_values = _finite_daily_values(occupancies_by_date)
        if len(daily_values) < RECOMMENDATION_REQUIRED_DATES:
            continue
        values = list(daily_values.values())
        baseline = median(values)
        spread = max(values) - min(values)
        weekly_values = _weekly_values(daily_values)
        if not isfinite(baseline) or not isfinite(spread) or not all(isfinite(value) for value in weekly_values):
            continue
        candidates.append(
            {
                "slot": slot,
                "baseline_occupancy": baseline,
                "independent_dates": len(values),
                "independent_weeks": len(weekly_values),
                "spread": spread,
            }
        )

    if not candidates:
        return {"status": "insufficient_data", "items": []}
    return {
        "status": "ready",
        "items": sorted(candidates, key=lambda candidate: (candidate["baseline_occupancy"], candidate["slot"]))[:5],
    }


def monthly_stability(readings: list[dict], details: dict) -> dict[str, list[dict] | str]:
    if details.get("status") != "ready" or not isinstance(details.get("items"), list):
        return {"status": "insufficient_data", "items": []}

    grouped = _occupancies_by_slot_and_date(readings)
    items = []
    for detail in details["items"]:
        if not isinstance(detail, dict) or not isinstance(detail.get("slot"), str):
            continue
        daily_values = _finite_daily_values(grouped.get(detail["slot"], {}))
        weekly_values = _weekly_values(daily_values)
        if not weekly_values or not all(isfinite(value) for value in weekly_values):
            continue
        week_spread = max(weekly_values) - min(weekly_values)
        if not isfinite(week_spread):
            continue
        items.append(
            {
                "slot": detail["slot"],
                "independent_weeks": len(weekly_values),
                "week_spread": week_spread,
            }
        )

    if not items:
        return {"status": "insufficient_data", "items": []}
    return {"status": "ready", "items": items}


def _weather_progress_default(status: str = "collecting") -> dict[str, int | str]:
    return {
        "rainy_dates": 0,
        "dry_dates": 0,
        "required_dates_per_group": WEATHER_REQUIRED_DATES_PER_GROUP,
        "status": status,
    }


def _validated_weather_progress(weather_state: object) -> dict[str, int | str]:
    if not isinstance(weather_state, dict):
        return _weather_progress_default()
    status = weather_state.get("status")
    if status == "unavailable":
        return _weather_progress_default("unavailable")
    values = ("rainy_dates", "dry_dates", "required_dates_per_group")
    if (
        status not in {"collecting", "eligible"}
        or any(not isinstance(weather_state.get(key), int) or isinstance(weather_state.get(key), bool) for key in values)
        or weather_state["rainy_dates"] < 0
        or weather_state["dry_dates"] < 0
        or weather_state["required_dates_per_group"] < 1
    ):
        return _weather_progress_default()
    return {key: weather_state[key] for key in (*values, "status")}


def factor_context(
    readings: list[dict], class_schedule_status: str = "unavailable", weather_state: object = None
) -> dict[str, int | str | dict]:
    dates: dict[str, bool] = {}
    for reading in readings:
        local_date = datetime.fromisoformat(reading["local"]).date().isoformat()
        holiday = reading.get("holiday")
        dates[local_date] = holiday if isinstance(holiday, bool) else holiday_context(local_date)["holiday"]
    return {
        "holiday_dates": sum(dates.values()),
        "non_holiday_dates": len(dates) - sum(dates.values()),
        "weather_progress": _validated_weather_progress(weather_state),
        "class_schedule_status": class_schedule_status
        if class_schedule_status in {"fresh", "stale", "unavailable"}
        else "unavailable",
    }


def association(rows: list[dict], field: str, value: bool) -> dict[str, int | float | str]:
    condition = [row["residual"] for row in rows if row[field] == value]
    comparison = [row["residual"] for row in rows if row[field] != value]
    if len(condition) < 20 or len(comparison) < 20:
        return {"status": "insufficient_data"}

    effect = fmean(condition) - fmean(comparison)
    standard_error = sqrt((variance(condition) / len(condition)) + (variance(comparison) / len(comparison)))
    confidence_low = effect - (1.96 * standard_error)
    confidence_high = effect + (1.96 * standard_error)
    if confidence_low <= 0 <= confidence_high:
        return {"status": "insufficient_data"}

    return {
        "status": "observed",
        "effect": effect,
        "condition_n": len(condition),
        "comparison_n": len(comparison),
        "confidence_low": confidence_low,
        "confidence_high": confidence_high,
    }


def weather_association(rows: list[dict]) -> dict[str, int | float | str]:
    return association(_weather_independent_dates(rows), "rain", True)


def weather_progress(rows: list[dict]) -> dict[str, int | str]:
    independent_dates = _weather_independent_dates(rows)
    rainy_dates = sum(row["rain"] for row in independent_dates)
    dry_dates = len(independent_dates) - rainy_dates
    return {
        "rainy_dates": rainy_dates,
        "dry_dates": dry_dates,
        "required_dates_per_group": WEATHER_REQUIRED_DATES_PER_GROUP,
        "status": "eligible"
        if rainy_dates >= WEATHER_REQUIRED_DATES_PER_GROUP and dry_dates >= WEATHER_REQUIRED_DATES_PER_GROUP
        else "collecting",
    }


def _weather_independent_dates(rows: list[dict]) -> list[dict]:
    by_local_date: dict[str, list[dict]] = {}
    for row in rows:
        local_date = datetime.fromisoformat(row["local"]).date().isoformat()
        by_local_date.setdefault(local_date, []).append(row)

    independent_dates = []
    for date_rows in by_local_date.values():
        conditions = {row["rain"] for row in date_rows}
        if len(conditions) != 1:
            continue
        # The 20-observation threshold is enforced on daily averages, not the
        # adjacent ten-minute samples. A date with mixed rain/dry blocks is
        # excluded so it cannot count toward both independent populations.
        independent_dates.append(
            {
                "residual": fmean(row["residual"] for row in date_rows),
                "rain": conditions.pop(),
            }
        )
    return independent_dates


def load_weather(readings: list[dict], fetch_json) -> dict[str, dict[str, int | float | bool]]:
    if not readings:
        return {}

    local_dates = [datetime.fromisoformat(reading["local"]).date().isoformat() for reading in readings]
    query = urlencode(
        {
            "latitude": "40.7736",
            "longitude": "-73.9592",
            "start_date": min(local_dates),
            "end_date": max(local_dates),
            "hourly": ",".join(WEATHER_FIELDS),
            "timezone": "America/New_York",
        }
    )
    hourly = fetch_json(f"{OPEN_METEO_ARCHIVE_URL}?{query}")["hourly"]
    weather = {}
    for values in zip(*(hourly[field] for field in ("time", *WEATHER_FIELDS)), strict=True):
        local_hour, temperature, apparent, precipitation, wind_speed, weather_code = values
        weather[local_hour] = {
            "temperature_2m": temperature,
            "apparent_temperature": apparent,
            "precipitation": precipitation,
            "wind_speed_10m": wind_speed,
            "weather_code": weather_code,
            "rain": precipitation >= 0.1,
        }
    return weather


def empty_insights() -> dict:
    return {
        "generated_at": None,
        "latest": None,
        "baselines": {},
        "recommendations": [],
        "recommendations_status": "insufficient_data",
        "recommendation_progress": {
            "matching_dates": 0,
            "required_dates": RECOMMENDATION_REQUIRED_DATES,
            "status": "collecting",
        },
        "quiet_window_details": {"status": "insufficient_data", "items": []},
        "monthly_stability": {"status": "insufficient_data", "items": []},
        "correlations": {"status": "insufficient_data"},
        "weather_progress": _weather_progress_default(),
        "factor_context": {
            "holiday_dates": 0,
            "non_holiday_dates": 0,
            "weather_progress": _weather_progress_default(),
            "class_schedule_status": "unavailable",
        },
        "class_annotations": {"status": "unavailable", "items": []},
        "class_schedule": {"status": "unavailable"},
    }


def main(
    readings_path: Path = DEFAULT_READINGS_PATH,
    insights_path: Path = DEFAULT_INSIGHTS_PATH,
    fetch_json=None,
    generated_at: str | None = None,
    classes_path: Path = DEFAULT_CLASSES_PATH,
    classes_meta_path: Path = DEFAULT_CLASSES_META_PATH,
) -> int:
    readings = _read_readings(readings_path)
    insights = empty_insights()
    insights["generated_at"] = generated_at or datetime.now().astimezone().isoformat()
    insights["class_annotations"] = load_class_schedule(classes_path)
    insights["class_schedule"] = load_class_schedule_metadata(classes_meta_path)
    if readings:
        insights["latest"] = readings[-1]
        insights["baselines"] = median_baseline(readings)
    recommendations = quiet_window_recommendations(readings)
    insights["recommendations"] = recommendations["items"]
    insights["recommendations_status"] = recommendations["status"]
    insights["recommendation_progress"] = recommendation_progress(readings)
    insights["quiet_window_details"] = quiet_window_details(readings)
    insights["monthly_stability"] = monthly_stability(readings, insights["quiet_window_details"])
    if readings:
        try:
            weather_by_hour = load_weather(readings, fetch_json or fetch_open_meteo_json)
            rows = []
            for reading in readings:
                weather = weather_by_hour.get(_local_hour_key(reading["local"]))
                if weather is None:
                    continue
                baseline = insights["baselines"][slot_key(reading["local"])]["median"]
                rows.append(
                    {
                        "local": reading["local"],
                        "residual": reading["occupancy"] - baseline,
                        **weather,
                    }
                )
            correlation = weather_association(rows)
            if correlation["status"] == "observed":
                correlation["label"] = "observed association"
            insights["correlations"] = correlation
            insights["weather_progress"] = weather_progress(rows)
        except (OSError, TypeError, ValueError, KeyError):
            insights["weather_progress"] = _weather_progress_default("unavailable")
    insights["factor_context"] = factor_context(
        readings,
        insights["class_schedule"]["status"],
        insights["weather_progress"],
    )
    _write_json_atomically(insights_path, insights)
    return 0


def _read_readings(path: Path) -> list[dict]:
    if not Path(path).exists():
        return []

    readings = []
    with Path(path).open(newline="") as file:
        for row in csv.DictReader(file):
            timestamp = datetime.fromisoformat(row["timestamp_utc"].replace("Z", "+00:00"))
            local = timestamp.astimezone(NEW_YORK).replace(microsecond=0)
            readings.append(
                {
                    "timestamp_utc": row["timestamp_utc"],
                    "local": local.isoformat(),
                    "occupancy": int(row["occupancy"]),
                    "status": row["status"],
                    **holiday_context(local.date().isoformat()),
                }
            )
    return readings


def fetch_open_meteo_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": "crunch-81st-crowd-analysis/1.0"})
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def _write_json_atomically(path: Path, content: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as file:
        json.dump(content, file, indent=2, sort_keys=True)
        file.write("\n")
        temporary_path = file.name
    os.replace(temporary_path, path)


def _local_hour_key(local_iso: str) -> str:
    local = datetime.fromisoformat(local_iso)
    return local.strftime("%Y-%m-%dT%H:00")


if __name__ == "__main__":
    raise SystemExit(main())
