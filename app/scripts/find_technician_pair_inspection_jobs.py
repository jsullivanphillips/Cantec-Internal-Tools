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
import sys
from datetime import datetime, timezone
from typing import Any, Iterator

import requests
from dotenv import load_dotenv

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
SERVICE_TRADE_JOB_LINK_BASE = "https://app.servicetrade.com/jobs"
DEFAULT_TECH_A = "Seth Ealing"
DEFAULT_TECH_B = "Korby Odegaard"
DEFAULT_PAGE_SIZE = 100

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


def fetch_completed_inspection_jobs_page(page: int, limit: int) -> tuple[list[dict[str, Any]], int | None]:
    payload = call_service_trade_api(
        "job",
        params={
            "status": "completed",
            "type": "inspection",
            "limit": limit,
            "page": page,
        },
    )
    data = _data_section(payload)
    jobs = data.get("jobs", []) or []
    total_pages_raw = data.get("totalPages")
    total_pages = int(total_pages_raw) if total_pages_raw is not None else None
    return jobs, total_pages


def iter_completed_inspection_jobs(limit: int) -> Iterator[dict[str, Any]]:
    page = 1
    while True:
        jobs, total_pages = fetch_completed_inspection_jobs_page(page, limit)
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


def _customer_name(job: dict[str, Any]) -> str:
    customer = job.get("customer")
    if isinstance(customer, dict):
        return str(customer.get("name") or "")
    return str(job.get("customerName") or "")


def _location_display(job: dict[str, Any]) -> str:
    location = job.get("location")
    if not isinstance(location, dict):
        return ""

    name = str(location.get("name") or "").strip()
    address = location.get("address")
    street = ""
    if isinstance(address, dict):
        street = str(address.get("street") or "").strip()

    return " - ".join(part for part in (name, street) if part)


def job_to_result(job: dict[str, Any]) -> dict[str, Any]:
    job_id = job.get("id")
    return {
        "job_id": job_id,
        "job_link": f"{SERVICE_TRADE_JOB_LINK_BASE}/{job_id}",
        "completed_on": _completed_on_display(job),
        "customer": _customer_name(job),
        "location": _location_display(job),
        "technicians": sorted(technician_names_for_job(job)),
    }


def find_matching_jobs(tech_a: str, tech_b: str, page_size: int) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    scanned = 0

    for job in iter_completed_inspection_jobs(page_size):
        scanned += 1
        if scanned % page_size == 0:
            print(f"Scanned {scanned} completed inspection jobs...", file=sys.stderr)
        if job_has_technician_pair(job, tech_a, tech_b):
            results.append(job_to_result(job))

    print(f"Scanned {scanned} completed inspection jobs total.", file=sys.stderr)
    return results


def print_text_report(results: list[dict[str, Any]], tech_a: str, tech_b: str) -> None:
    print(f"Completed inspection jobs with {tech_a} and {tech_b}: {len(results)}")
    print()

    for row in results:
        print(f"job_id={row['job_id']} link={row['job_link']}")
        details = [
            f"completed_on={row['completed_on']}" if row.get("completed_on") else "",
            f"customer={row['customer']!r}" if row.get("customer") else "",
            f"location={row['location']!r}" if row.get("location") else "",
        ]
        detail_line = " ".join(part for part in details if part)
        if detail_line:
            print(f"  {detail_line}")


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
    parser.add_argument("--json", action="store_true", help="Print matching jobs as JSON.")
    return parser.parse_args()


def main() -> None:
    load_dotenv()
    args = parse_args()

    if args.page_size < 1:
        raise SystemExit("--page-size must be greater than 0.")

    username = os.getenv("PROCESSING_USERNAME")
    password = os.getenv("PROCESSING_PASSWORD")
    if not username or not password:
        raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")

    authenticate(username, password)
    results = find_matching_jobs(args.tech_a, args.tech_b, args.page_size)

    if args.json:
        print(json.dumps(results, indent=2))
        return

    print_text_report(results, args.tech_a, args.tech_b)


if __name__ == "__main__":
    main()
