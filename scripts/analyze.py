import csv
import json
import os
import tempfile
from datetime import datetime
from math import sqrt
from pathlib import Path
from statistics import fmean, median, variance
from urllib.parse import urlencode
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


def slot_key(local_iso: str) -> str:
    local = datetime.fromisoformat(local_iso)
    minute = local.minute - (local.minute % 10)
    return f"{local.weekday()}-{local.hour:02d}:{minute:02d}"


def median_baseline(readings: list[dict]) -> dict[str, dict[str, int | float]]:
    occupancies_by_slot: dict[str, list[int | float]] = {}
    for reading in readings:
        key = slot_key(reading["local"])
        occupancies_by_slot.setdefault(key, []).append(reading["occupancy"])

    return {
        key: {"median": median(occupancies), "n": len(occupancies)}
        for key, occupancies in sorted(occupancies_by_slot.items())
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
    return association(independent_dates, "rain", True)


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
        "correlations": {"status": "insufficient_data"},
    }


def main(
    readings_path: Path = DEFAULT_READINGS_PATH,
    insights_path: Path = DEFAULT_INSIGHTS_PATH,
    fetch_json=None,
    generated_at: str | None = None,
) -> int:
    readings = _read_readings(readings_path)
    insights = empty_insights()
    insights["generated_at"] = generated_at or datetime.now().astimezone().isoformat()
    if readings:
        insights["latest"] = readings[-1]
        insights["baselines"] = median_baseline(readings)
    if len(readings) >= 20:
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
        except (OSError, TypeError, ValueError, KeyError):
            pass
    _write_json_atomically(insights_path, insights)
    return 0


def _read_readings(path: Path) -> list[dict]:
    if not Path(path).exists():
        return []

    readings = []
    with Path(path).open(newline="") as file:
        for row in csv.DictReader(file):
            timestamp = datetime.fromisoformat(row["timestamp_utc"].replace("Z", "+00:00"))
            readings.append(
                {
                    "timestamp_utc": row["timestamp_utc"],
                    "local": timestamp.astimezone(NEW_YORK).replace(microsecond=0).isoformat(),
                    "occupancy": int(row["occupancy"]),
                    "status": row["status"],
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
