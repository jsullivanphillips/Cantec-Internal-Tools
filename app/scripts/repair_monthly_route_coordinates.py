from __future__ import annotations

import argparse
import json
import math
import os
from urllib import error as url_error, parse as url_parse, request as url_request

from sqlalchemy import or_, select

from app import create_app, db
from app.db_models import MonthlyRouteLocation
VICTORIA_PROXIMITY_LNG = -123.3656
VICTORIA_PROXIMITY_LAT = 48.4284
VICTORIA_BBOX = (-123.75, 48.25, -123.10, 48.75)
VICTORIA_MAX_DISTANCE_KM = 80.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Repair clearly swapped monthly route coordinates where latitude is out of range "
            "but longitude is a valid latitude."
        )
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
        help="Optional max rows to inspect in this run (0 = no limit).",
    )
    parser.add_argument(
        "--regeocode-outliers",
        action="store_true",
        help="Re-geocode coordinates that are valid but outside Greater Victoria.",
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
    req = url_request.Request(url, headers={"User-Agent": "schedule-assist-coordinate-repair/1.0"})
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


def run_repair(*, dry_run: bool, limit: int, regeocode_outliers: bool) -> None:
    stmt = (
        select(MonthlyRouteLocation)
        .where(
            or_(
                MonthlyRouteLocation.latitude.is_not(None),
                MonthlyRouteLocation.longitude.is_not(None),
            )
        )
        .order_by(MonthlyRouteLocation.id.asc())
    )
    if limit > 0:
        stmt = stmt.limit(limit)

    rows = db.session.execute(stmt).scalars().all()
    inspected = len(rows)
    swapped = 0
    regeocoded = 0
    unchanged = 0
    token = os.getenv("MAPBOX_ACCESS_TOKEN") if regeocode_outliers else None

    for loc in rows:
        lat = loc.latitude
        lon = loc.longitude
        if lat is None or lon is None:
            unchanged += 1
            continue

        # Clearly swapped if latitude is outside valid range, and longitude looks like latitude.
        is_swapped = abs(lat) > 90 and abs(lat) <= 180 and abs(lon) <= 90
        if is_swapped:
            loc.latitude, loc.longitude = lon, lat
            swapped += 1
            continue

        if regeocode_outliers and token and not _is_victoria_area(lat, lon):
            coords = _geocode_mapbox(_build_query(loc), token)
            if coords:
                new_lat, new_lon = coords
                loc.latitude = new_lat
                loc.longitude = new_lon
                regeocoded += 1
            else:
                unchanged += 1
        else:
            unchanged += 1

    print(
        "[monthly-coords-repair] Summary — "
        f"inspected: {inspected}, swapped: {swapped}, regeocoded: {regeocoded}, unchanged: {unchanged}",
        flush=True,
    )

    if dry_run:
        db.session.rollback()
        print("[monthly-coords-repair] Dry run complete. Database unchanged.", flush=True)
    else:
        db.session.commit()
        print("[monthly-coords-repair] Changes committed.", flush=True)


def main() -> None:
    args = parse_args()
    app = create_app()
    with app.app_context():
        run_repair(
            dry_run=not args.commit,
            limit=max(args.limit, 0),
            regeocode_outliers=args.regeocode_outliers,
        )


if __name__ == "__main__":
    main()
