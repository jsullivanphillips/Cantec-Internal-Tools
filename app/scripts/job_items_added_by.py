"""
List ServiceTrade job items for a job and who added each.

Uses the same API patterns as app/routes/performance_summary.py (jobitem + user).

Requires PROCESSING_USERNAME and PROCESSING_PASSWORD in the environment.

Examples (repo root):

    python app/scripts/job_items_added_by.py 2526076993604097
    python app/scripts/job_items_added_by.py --job-id 2526076993604097 --json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
DEFAULT_TIMEZONE = "America/Vancouver"

api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})


def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    response = api_session.post(auth_url, json={"username": username, "password": password})
    response.raise_for_status()


def get_json(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{SERVICE_TRADE_API_BASE}/{path.lstrip('/')}"
    response = api_session.get(url, params=params or {})
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, dict):
        return payload
    return {}


def fetch_job(job_id: int) -> dict[str, Any] | None:
    try:
        return get_json(f"job/{job_id}").get("data") or None
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return None
        raise


def fetch_job_items(job_id: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page = 1
    while True:
        data = get_json("jobitem", {"jobId": job_id, "page": page}).get("data", {}) or {}
        batch = data.get("jobItems") or []
        if not isinstance(batch, list):
            break
        items.extend(batch)
        total_pages = int(data.get("totalPages") or 1)
        if page >= total_pages:
            break
        page += 1
    return items


def format_timestamp(ts: object, tz_name: str) -> str:
    if not isinstance(ts, (int, float)) or ts <= 0:
        return ""
    dt = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(ZoneInfo(tz_name))
    return dt.strftime("%Y-%m-%d %H:%M %Z")


def resolve_added_by(item: dict[str, Any], user_cache: dict[int, str]) -> dict[str, Any]:
    """
    Match performance_summary.update_job_item_by_id: prefer item.user, else tech source.
    """
    user_obj = item.get("user") or {}
    if isinstance(user_obj, dict) and user_obj.get("name"):
        return {
            "user_id": user_obj.get("id"),
            "user_name": str(user_obj["name"]),
            "resolved_via": "jobitem.user",
        }

    user_id = user_obj.get("id") if isinstance(user_obj, dict) else None
    source = item.get("source") or {}
    if not user_id and isinstance(source, dict) and source.get("type") == "tech":
        user_id = source.get("userId")
        resolved_via = "source.tech"
    else:
        resolved_via = "user.api" if user_id else None

    if not user_id:
        return {
            "user_id": None,
            "user_name": "(unknown)",
            "resolved_via": resolved_via,
        }

    uid = int(user_id)
    if uid not in user_cache:
        try:
            user_data = get_json(f"user/{uid}").get("data", {}) or {}
            user_cache[uid] = str(user_data.get("name") or f"user #{uid}")
        except requests.HTTPError:
            user_cache[uid] = f"user #{uid}"

    return {
        "user_id": uid,
        "user_name": user_cache[uid],
        "resolved_via": resolved_via or "user.api",
    }


def build_rows(
    job_id: int,
    items: list[dict[str, Any]],
    tz_name: str,
) -> list[dict[str, Any]]:
    user_cache: dict[int, str] = {}
    rows: list[dict[str, Any]] = []

    for item in sorted(items, key=lambda row: (row.get("orderIndex") is None, row.get("orderIndex", 0), row.get("id", 0))):
        who = resolve_added_by(item, user_cache)
        source = item.get("source") if isinstance(item.get("source"), dict) else None
        rows.append(
            {
                "job_item_id": item.get("id"),
                "name": item.get("name") or "",
                "quantity": item.get("quantity"),
                "cost": item.get("cost"),
                "added_by": who["user_name"],
                "added_by_user_id": who["user_id"],
                "resolved_via": who["resolved_via"],
                "created": format_timestamp(item.get("created"), tz_name),
                "updated": format_timestamp(item.get("updated"), tz_name),
                "source_type": source.get("type") if source else None,
                "source": source,
                "order_index": item.get("orderIndex"),
                "job_id": (item.get("job") or {}).get("id") or job_id,
            }
        )

    return rows


def print_report(
    job_id: int,
    job: dict[str, Any] | None,
    rows: list[dict[str, Any]],
    tz_name: str,
) -> None:
    print()
    print("ServiceTrade job items — who added each")
    print("=" * 72)
    print(f"Job ID:     {job_id}")
    if job:
        print(f"Job number: {job.get('number', '')}")
        print(f"Job name:   {job.get('name', '')}")
        print(f"Status:     {job.get('displayStatus') or job.get('status', '')}")
        loc = job.get("location") or {}
        addr = (loc.get("address") or {}).get("street") or loc.get("name") or ""
        if addr:
            print(f"Location:   {addr}")
    print(f"Timezone:   {tz_name}")
    print(f"Items:      {len(rows)}")
    print()

    if not rows:
        print("No job items returned for this job.")
        return

    col_widths = {
        "id": 18,
        "name": 36,
        "qty": 6,
        "added_by": 22,
        "created": 22,
    }

    header = (
        f"{'Job item ID':<{col_widths['id']}}  "
        f"{'Name':<{col_widths['name']}}  "
        f"{'Qty':>{col_widths['qty']}}  "
        f"{'Added by':<{col_widths['added_by']}}  "
        f"{'Created':<{col_widths['created']}}"
    )
    print(header)
    print("-" * len(header))

    for row in rows:
        name = row["name"]
        if len(name) > col_widths["name"]:
            name = name[: col_widths["name"] - 1] + "…"
        qty = row["quantity"]
        qty_s = "" if qty is None else str(qty)
        print(
            f"{str(row['job_item_id']):<{col_widths['id']}}  "
            f"{name:<{col_widths['name']}}  "
            f"{qty_s:>{col_widths['qty']}}  "
            f"{row['added_by']:<{col_widths['added_by']}}  "
            f"{row['created']:<{col_widths['created']}}"
        )

    print()
    print("Detail (source / resolution)")
    print("-" * 72)
    for row in rows:
        uid = row["added_by_user_id"]
        uid_s = str(uid) if uid is not None else "—"
        via = row["resolved_via"] or "—"
        src = row["source_type"] or "—"
        print(f"  {row['job_item_id']}  uid={uid_s}  via={via}  source.type={src}")
        if row.get("source"):
            print(f"           source={json.dumps(row['source'], separators=(',', ':'))}")
    print()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="List job items on a ServiceTrade job and who added each.",
    )
    parser.add_argument(
        "job_id",
        nargs="?",
        type=int,
        help="ServiceTrade job ID (e.g. from https://app.servicetrade.com/jobs/<id>).",
    )
    parser.add_argument(
        "--job-id",
        dest="job_id_flag",
        type=int,
        metavar="ID",
        help="Same as positional job_id.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full result as JSON instead of a text table.",
    )
    parser.add_argument(
        "--timezone",
        default=DEFAULT_TIMEZONE,
        help=f"Timezone for created/updated display (default: {DEFAULT_TIMEZONE}).",
    )
    return parser.parse_args()


def main() -> None:
    load_dotenv()
    args = parse_args()

    job_id = args.job_id if args.job_id is not None else args.job_id_flag
    if job_id is None:
        raise SystemExit("Provide a job ID: python app/scripts/job_items_added_by.py <job_id>")

    username = os.getenv("PROCESSING_USERNAME")
    password = os.getenv("PROCESSING_PASSWORD")
    if not username or not password:
        raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")

    authenticate(username, password)

    job = fetch_job(job_id)
    items = fetch_job_items(job_id)
    rows = build_rows(job_id, items, args.timezone)

    result = {
        "job_id": job_id,
        "job": job,
        "timezone": args.timezone,
        "item_count": len(rows),
        "items": rows,
    }

    if args.json:
        print(json.dumps(result, indent=2, default=str))
        return

    if job is None and not rows:
        raise SystemExit(f"Job {job_id} not found and no job items returned.")

    print_report(job_id, job, rows, args.timezone)


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        body = (exc.response.text or "")[:500] if exc.response is not None else ""
        print(f"ServiceTrade API error (HTTP {status}): {body}", file=sys.stderr)
        raise SystemExit(1) from exc
