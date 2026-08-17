import html
import json
import re


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
