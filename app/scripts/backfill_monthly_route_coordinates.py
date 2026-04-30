from __future__ import annotations

import argparse
import json
import math
import os
import time
from urllib import error as url_error, parse as url_parse, request as url_request

from sqlalchemy import select

from app import create_app, db
from app.db_models import MonthlyRouteLocation

PROGRESS_EVERY = 25
VICTORIA_PROXIMITY_LNG = -123.3656
VICTORIA_PROXIMITY_LAT = 48.4284
VICTORIA_BBOX = (-123.75, 48.25, -123.10, 48.75)
VICTORIA_MAX_DISTANCE_KM = 80.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill missing latitude/longitude for MonthlyRouteLocation using Mapbox geocoding."
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Persist changes. If omitted, script runs in dry-run mode.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional max rows to process in this run (0 = no limit).",
    )
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=120,
        help="Delay between geocode requests in milliseconds (default: 120).",
    )
    return parser.parse_args()


def _build_query(loc: MonthlyRouteLocation) -> str:
    parts = [loc.address, loc.building, loc.property_management_company]
    tokens = [str(part).strip() for part in parts if part and str(part).strip()]
    tokens.append("Victoria, BC, Canada")
    return ", ".join(tokens)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    )
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _is_victoria_area(lat: float, lng: float) -> bool:
    west, south, east, north = VICTORIA_BBOX
    if west <= lng <= east and south <= lat <= north:
        return True
    return _haversine_km(VICTORIA_PROXIMITY_LAT, VICTORIA_PROXIMITY_LNG, lat, lng) <= VICTORIA_MAX_DISTANCE_KM


def _geocode_mapbox(query: str, access_token: str) -> tuple[float, float] | None:
    endpoint = "https://api.mapbox.com/geocoding/v5/mapbox.places/"
    url = (
        f"{endpoint}{url_parse.quote(query)}.json"
        f"?access_token={url_parse.quote(access_token)}"
        f"&limit=1&autocomplete=false&country=ca&types=address"
        f"&proximity={VICTORIA_PROXIMITY_LNG},{VICTORIA_PROXIMITY_LAT}"
        f"&bbox={VICTORIA_BBOX[0]},{VICTORIA_BBOX[1]},{VICTORIA_BBOX[2]},{VICTORIA_BBOX[3]}"
    )
    req = url_request.Request(url, headers={"User-Agent": "schedule-assist-coordinate-backfill/1.0"})
    try:
        with url_request.urlopen(req, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (url_error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    features = payload.get("features") if isinstance(payload, dict) else None
    if not features:
        return None
    center = features[0].get("center")
    if (
        not isinstance(center, list)
        or len(center) < 2
        or not isinstance(center[0], (int, float))
        or not isinstance(center[1], (int, float))
    ):
        return None
    lat, lng = float(center[1]), float(center[0])
    if not _is_victoria_area(lat, lng):
        return None
    return lat, lng


def run_backfill(*, dry_run: bool, limit: int, sleep_ms: int) -> None:
    token = os.getenv("MAPBOX_ACCESS_TOKEN")
    if not token:
        raise SystemExit("MAPBOX_ACCESS_TOKEN is required in environment.")

    stmt = select(MonthlyRouteLocation).where(
        (MonthlyRouteLocation.latitude.is_(None)) | (MonthlyRouteLocation.longitude.is_(None))
    ).order_by(MonthlyRouteLocation.id.asc())
    if limit > 0:
        stmt = stmt.limit(limit)

    rows = db.session.execute(stmt).scalars().all()
    total = len(rows)
    if total == 0:
        print("[monthly-coords-backfill] Nothing to backfill.", flush=True)
        return

    print(
        f"[monthly-coords-backfill] Starting {'dry-run' if dry_run else 'commit'} for {total} row(s).",
        flush=True,
    )

    updated = 0
    failed = 0
    for idx, loc in enumerate(rows, start=1):
        query = _build_query(loc)
        coords = _geocode_mapbox(query, token)
        if coords:
            lat, lon = coords
            loc.latitude = lat
            loc.longitude = lon
            updated += 1
        else:
            failed += 1

        if idx == 1 or idx == total or idx % PROGRESS_EVERY == 0:
            pct = (100 * idx // total) if total else 100
            print(
                f"[monthly-coords-backfill] Progress: {idx}/{total} ({pct}%) — updated: {updated}, failed: {failed}",
                flush=True,
            )
        if sleep_ms > 0 and idx < total:
            time.sleep(sleep_ms / 1000)

    if dry_run:
        db.session.rollback()
        print("[monthly-coords-backfill] Dry run complete. Database unchanged.", flush=True)
    else:
        db.session.commit()
        print("[monthly-coords-backfill] Changes committed.", flush=True)


def main() -> None:
    args = parse_args()
    app = create_app()
    with app.app_context():
        run_backfill(dry_run=not args.commit, limit=max(args.limit, 0), sleep_ms=max(args.sleep_ms, 0))


if __name__ == "__main__":
    main()
