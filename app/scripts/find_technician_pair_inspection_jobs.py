"""
Find completed ServiceTrade inspection jobs where two technicians were assigned.

Requires PROCESSING_USERNAME and PROCESSING_PASSWORD in the environment.

Example (repo root):

    python app/scripts/find_technician_pair_inspection_jobs.py
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, time, timezone
from typing import Any, Iterator
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from tqdm import tqdm

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
DEFAULT_TECH_A = "Seth Ealing"
DEFAULT_TECH_B = "Korby Odegaard"
DEFAULT_PAGE_SIZE = 100
DEFAULT_START_DATE = "2025-01-01"
DEFAULT_END_DATE = "2026-12-31"
DEFAULT_TIMEZONE = "America/Vancouver"
SERVICE_CATEGORIES: tuple[tuple[str, str, tuple[re.Pattern[str], ...]], ...] = (
    (
        "ext",
        "Extinguishers",
        (
            re.compile(r"\bextinguisher(?:s)?\b", re.IGNORECASE),
            re.compile(r"\bportable\s+extinguishers?\b", re.IGNORECASE),
        ),
    ),
    (
        "elu",
        "Emergency / Exit Lights",
        (
            re.compile(r"\bemergency\s+lights?\b", re.IGNORECASE),
            re.compile(r"\bexit\s+lights?\b", re.IGNORECASE),
            re.compile(r"\bemergency\s*/\s*exit\s+lights?\b", re.IGNORECASE),
            re.compile(r"\belu\b", re.IGNORECASE),
        ),
    ),
    (
        "fire_alarm",
        "Full Fire Alarm",
        (
            re.compile(r"\bfire\s+alarm\b", re.IGNORECASE),
            re.compile(r"\balarm\s+systems?\b", re.IGNORECASE),
        ),
    ),
)
UNKNOWN_CATEGORY = ("unknown", "Other / Unknown")
CATEGORY_CODE_BY_KEY = {
    "ext": "FE",
    "fire_alarm": "FA",
    "elu": "ELU",
    "unknown": "UNKNOWN",
}
CATEGORY_OUTPUT_ORDER = ("ext", "fire_alarm", "elu", "unknown")
SUMMARY_CATEGORY_KEYS = ("fire_alarm", "elu", "ext")
SUMMARY_LABEL_BY_KEY = {
    "fire_alarm": "FA",
    "elu": "ELU",
    "ext": "EXT",
}

api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})


def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    response = api_session.post(auth_url, json={"username": username, "password": password})
    response.raise_for_status()


def call_service_trade_api(endpoint: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{SERVICE_TRADE_API_BASE}/{endpoint}"
    response = api_session.get(url, params=params or {})
    response.raise_for_status()
    return response.json()


def _normalized_name(value: object) -> str:
    return " ".join(str(value or "").split()).casefold()


def technician_names_for_job(job: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for appointment in job.get("appointments", []) or []:
        for tech in appointment.get("techs", []) or []:
            name = tech.get("name")
            if name:
                names.add(" ".join(str(name).split()))
    return names


def job_has_technician_pair(job: dict[str, Any], tech_a: str, tech_b: str) -> bool:
    normalized_names = {_normalized_name(name) for name in technician_names_for_job(job)}
    return _normalized_name(tech_a) in normalized_names and _normalized_name(tech_b) in normalized_names


def _data_section(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    if isinstance(data, dict):
        return data
    return payload


def completed_on_range_unix(start_date: str, end_date: str, timezone_name: str) -> tuple[int, int]:
    tz = ZoneInfo(timezone_name)
    try:
        start_day = datetime.strptime(start_date, "%Y-%m-%d").date()
        end_day = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("Dates must use YYYY-MM-DD format.") from exc

    if end_day < start_day:
        raise ValueError("--end-date must be on or after --start-date.")

    start_local = datetime.combine(start_day, time.min, tzinfo=tz)
    end_local = datetime.combine(end_day, time.max.replace(microsecond=0), tzinfo=tz)
    return int(start_local.timestamp()), int(end_local.timestamp())


def fetch_completed_inspection_jobs_page(
    page: int,
    limit: int,
    completed_on_begin: int,
    completed_on_end: int,
) -> tuple[list[dict[str, Any]], int | None]:
    payload = call_service_trade_api(
        "job",
        params={
            "status": "completed",
            "type": "inspection",
            "completedOnBegin": completed_on_begin,
            "completedOnEnd": completed_on_end,
            "limit": limit,
            "page": page,
        },
    )
    data = _data_section(payload)
    jobs = data.get("jobs", []) or []
    total_pages_raw = data.get("totalPages")
    total_pages = int(total_pages_raw) if total_pages_raw is not None else None
    return jobs, total_pages


def iter_completed_inspection_jobs(
    limit: int,
    completed_on_begin: int,
    completed_on_end: int,
) -> Iterator[dict[str, Any]]:
    page = 1
    while True:
        jobs, total_pages = fetch_completed_inspection_jobs_page(
            page,
            limit,
            completed_on_begin,
            completed_on_end,
        )
        if not jobs:
            break

        yield from jobs

        if total_pages is not None:
            if page >= total_pages:
                break
        elif len(jobs) < limit:
            break

        page += 1


def _parse_service_trade_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        if raw.endswith("Z"):
            raw = f"{raw[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return None


def _completed_on_display(job: dict[str, Any]) -> str:
    parsed = _parse_service_trade_datetime(job.get("completedOn"))
    if parsed:
        return parsed.isoformat()
    return str(job.get("completedOn") or "")


def _inspection_date_display(job: dict[str, Any]) -> str:
    parsed = _parse_service_trade_datetime(job.get("completedOn"))
    if parsed:
        return parsed.date().isoformat()
    return _completed_on_display(job)


def _address_display(job: dict[str, Any]) -> str:
    location = job.get("location")
    if not isinstance(location, dict):
        return ""

    address = location.get("address")
    if isinstance(address, dict):
        street = str(address.get("street") or "").strip()
        city = str(address.get("city") or "").strip()
        state = str(address.get("state") or address.get("province") or "").strip()
        postal_code = str(address.get("postalCode") or address.get("postal_code") or address.get("zip") or "").strip()
        full_address = ", ".join(part for part in (street, city, state, postal_code) if part)
        if full_address:
            return full_address

    return str(location.get("name") or "").strip()


def _append_text(texts: list[str], value: object) -> None:
    if value is None:
        return
    text = " ".join(str(value).split())
    if text:
        texts.append(text)


def _collect_service_texts(entity: object, texts: list[str]) -> None:
    if not isinstance(entity, dict):
        return

    for key in ("description", "name", "summary"):
        _append_text(texts, entity.get(key))

    service_line = entity.get("serviceLine")
    if isinstance(service_line, dict):
        _append_text(texts, service_line.get("name"))

    for list_key in ("serviceRequests", "services", "serviceItems", "items"):
        values = entity.get(list_key)
        if not isinstance(values, list):
            continue
        for value in values:
            _collect_service_texts(value, texts)


def service_texts_for_job(job: dict[str, Any], *, include_appointment_details: bool) -> list[str]:
    texts: list[str] = []
    _collect_service_texts(job, texts)

    fetched_appointment_ids: set[str] = set()
    for appointment in job.get("appointments", []) or []:
        _collect_service_texts(appointment, texts)

        appointment_id = appointment.get("id")
        if not include_appointment_details or not appointment_id:
            continue

        appointment_id_key = str(appointment_id)
        if appointment_id_key in fetched_appointment_ids:
            continue

        fetched_appointment_ids.add(appointment_id_key)
        appointment_payload = call_service_trade_api(f"appointment/{appointment_id_key}")
        _collect_service_texts(_data_section(appointment_payload), texts)

    return sorted(set(texts))


def service_categories_for_texts(service_texts: list[str]) -> list[str]:
    haystack = "\n".join(service_texts)
    categories: list[str] = []
    for category_key, _label, patterns in SERVICE_CATEGORIES:
        if any(pattern.search(haystack) for pattern in patterns):
            categories.append(category_key)
    return categories or [UNKNOWN_CATEGORY[0]]


def category_codes_for_row(row: dict[str, Any]) -> list[str]:
    categories = set(row.get("categories") or [])
    return [CATEGORY_CODE_BY_KEY[key] for key in CATEGORY_OUTPUT_ORDER if key in categories]


def category_totals(results: list[dict[str, Any]]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for category_key in SUMMARY_CATEGORY_KEYS:
        totals[SUMMARY_LABEL_BY_KEY[category_key]] = sum(
            1 for row in results if category_key in (row.get("categories") or [])
        )
    return totals


def job_to_result(job: dict[str, Any], service_texts: list[str] | None = None) -> dict[str, Any]:
    resolved_service_texts = service_texts if service_texts is not None else service_texts_for_job(job, include_appointment_details=False)
    return {
        "inspection_date": _inspection_date_display(job),
        "address": _address_display(job),
        "categories": service_categories_for_texts(resolved_service_texts),
        "service_descriptions": resolved_service_texts,
    }


def find_matching_jobs(
    tech_a: str,
    tech_b: str,
    page_size: int,
    completed_on_begin: int,
    completed_on_end: int,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    scanned = 0

    with tqdm(
        desc="Scanning completed inspection jobs",
        unit="job",
        file=sys.stderr,
        dynamic_ncols=True,
    ) as progress:
        for job in iter_completed_inspection_jobs(page_size, completed_on_begin, completed_on_end):
            scanned += 1
            progress.update(1)
            if job_has_technician_pair(job, tech_a, tech_b):
                service_texts = service_texts_for_job(job, include_appointment_details=True)
                results.append(job_to_result(job, service_texts))

        progress.set_postfix(scanned=scanned, matched=len(results))

    return results


def print_text_report(
    results: list[dict[str, Any]],
    tech_a: str,
    tech_b: str,
    start_date: str,
    end_date: str,
    timezone_name: str,
) -> None:
    print(f"Completed inspection jobs with {tech_a} and {tech_b}: {len(results)}")
    print(f"Completed-on range: {start_date} through {end_date} ({timezone_name})")
    print()

    for row in results:
        codes = category_codes_for_row(row)
        category_display = ", ".join(codes) if codes else "UNKNOWN"
        print(
            f"{row.get('address') or 'unknown address'} | "
            f"{row.get('inspection_date') or 'unknown date'} | "
            f"{category_display}"
        )

    totals = category_totals(results)
    print()
    print("Summary")
    print(f"FA jobs: {totals['FA']}")
    print(f"ELU jobs: {totals['ELU']}")
    print(f"EXT jobs: {totals['EXT']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "List completed ServiceTrade inspection jobs where two technicians both appear "
            "on the job's appointments."
        ),
    )
    parser.add_argument("--tech-a", default=DEFAULT_TECH_A, help=f"First technician name (default: {DEFAULT_TECH_A}).")
    parser.add_argument("--tech-b", default=DEFAULT_TECH_B, help=f"Second technician name (default: {DEFAULT_TECH_B}).")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE, help="ServiceTrade job API page size.")
    parser.add_argument("--start-date", default=DEFAULT_START_DATE, help=f"Completed-on start date YYYY-MM-DD (default: {DEFAULT_START_DATE}).")
    parser.add_argument("--end-date", default=DEFAULT_END_DATE, help=f"Completed-on end date YYYY-MM-DD (default: {DEFAULT_END_DATE}).")
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE, help=f"Timezone for date boundaries (default: {DEFAULT_TIMEZONE}).")
    parser.add_argument("--json", action="store_true", help="Print matching jobs as JSON.")
    return parser.parse_args()


def main() -> None:
    load_dotenv()
    args = parse_args()

    if args.page_size < 1:
        raise SystemExit("--page-size must be greater than 0.")
    try:
        completed_on_begin, completed_on_end = completed_on_range_unix(
            args.start_date,
            args.end_date,
            args.timezone,
        )
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    username = os.getenv("PROCESSING_USERNAME")
    password = os.getenv("PROCESSING_PASSWORD")
    if not username or not password:
        raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")

    authenticate(username, password)
    results = find_matching_jobs(
        args.tech_a,
        args.tech_b,
        args.page_size,
        completed_on_begin,
        completed_on_end,
    )

    if args.json:
        print(json.dumps(results, indent=2))
        return

    print_text_report(results, args.tech_a, args.tech_b, args.start_date, args.end_date, args.timezone)


if __name__ == "__main__":
    main()
