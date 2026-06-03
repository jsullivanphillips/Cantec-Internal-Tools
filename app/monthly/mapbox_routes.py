from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from urllib import error as url_error, parse as url_parse, request as url_request

from sqlalchemy.exc import IntegrityError

from app.db_models import (
    MonthlyRouteCalculatedPath,
    MonthlyRouteLocation,
    db,
)


MAPBOX_DIRECTIONS_PROFILE = "driving"
MAPBOX_DIRECTIONS_PROVIDER = "mapbox"
MAPBOX_DIRECTIONS_MAX_WAYPOINTS = 25


class MapboxRouteError(RuntimeError):
    """Raised when Mapbox Directions cannot return a usable route."""


def ordered_route_locations(route_id: int) -> list[MonthlyRouteLocation]:
    return (
        MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id)
        .order_by(
            MonthlyRouteLocation.route_stop_order.asc().nulls_last(),
            MonthlyRouteLocation.address.asc(),
            MonthlyRouteLocation.id.asc(),
        )
        .all()
    )


def serialize_route_stop(loc: MonthlyRouteLocation) -> dict[str, object]:
    from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy
    from app.monthly.testing_site_display import (
        billing_address_for_location,
        location_row_display_labels,
        testing_site_billing_subline,
    )

    ts_rows = sync_testing_sites_from_legacy(loc)
    billing = billing_address_for_location(loc, int(loc.id))
    location_label, testing_site_labels = location_row_display_labels(loc, ts_rows)
    primary = ts_rows[0] if len(ts_rows) == 1 else None
    if primary is not None:
        popup_title = location_label
        popup_subline = testing_site_billing_subline(location_label, loc)
    else:
        popup_title = billing
        popup_subline = None
    return {
        "id": int(loc.id),
        "label": popup_title,
        "primary_label": popup_title,
        "billing_address_subline": popup_subline,
        "testing_site_count": len(ts_rows),
        "testing_site_labels": testing_site_labels,
        "address": loc.address,
        "display_address": loc.display_address,
        "building": loc.building,
        "latitude": float(loc.latitude) if loc.latitude is not None else None,
        "longitude": float(loc.longitude) if loc.longitude is not None else None,
        "route_stop_order": int(loc.route_stop_order) if loc.route_stop_order is not None else None,
        "has_coordinates": _valid_coordinates(loc.latitude, loc.longitude),
    }


def stop_signature_for_locations(locations: list[MonthlyRouteLocation]) -> str:
    signature_rows = []
    for ordinal, loc in enumerate(locations):
        signature_rows.append(
            {
                "ordinal": ordinal,
                "id": int(loc.id),
                "lat": _rounded_coordinate(loc.latitude),
                "lng": _rounded_coordinate(loc.longitude),
            }
        )
    encoded = json.dumps(signature_rows, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def invalidate_monthly_route_path(route_id: int | None) -> None:
    if route_id is None:
        return
    MonthlyRouteCalculatedPath.query.filter_by(monthly_route_id=route_id).delete(
        synchronize_session=False
    )


def calculated_path_payload(
    route_id: int,
    *,
    refresh: bool = False,
    profile: str = MAPBOX_DIRECTIONS_PROFILE,
) -> dict[str, object]:
    locations = ordered_route_locations(route_id)
    stops_payload = [serialize_route_stop(loc) for loc in locations]
    missing_coordinate_stops = [stop for stop in stops_payload if not stop["has_coordinates"]]
    valid_locations = [
        loc for loc in locations if _valid_coordinates(loc.latitude, loc.longitude)
    ]
    signature = stop_signature_for_locations(locations)

    base_payload: dict[str, object] = {
        "profile": profile,
        "provider": MAPBOX_DIRECTIONS_PROVIDER,
        "stop_signature": signature,
        "stops": stops_payload,
        "missing_coordinate_stops": missing_coordinate_stops,
        "waypoint_count": len(valid_locations),
    }

    if len(valid_locations) < 2:
        return {
            **base_payload,
            "status": "not_enough_coordinates",
            "cache_status": "not_applicable",
            "geometry": None,
            "distance_meters": None,
            "duration_seconds": None,
            "calculated_at": None,
        }

    cache = MonthlyRouteCalculatedPath.query.filter_by(
        monthly_route_id=route_id,
        profile=profile,
    ).one_or_none()
    if (
        cache is not None
        and not refresh
        and cache.stop_signature == signature
        and cache.geometry_geojson
    ):
        return {
            **base_payload,
            "status": "ok",
            "cache_status": "hit",
            "geometry": cache.geometry_geojson,
            "distance_meters": cache.distance_meters,
            "duration_seconds": cache.duration_seconds,
            "calculated_at": cache.calculated_at.isoformat() if cache.calculated_at else None,
        }

    access_token = os.getenv("MAPBOX_ACCESS_TOKEN")
    if not access_token:
        return {
            **base_payload,
            "status": "mapbox_token_missing",
            "cache_status": "miss",
            "geometry": None,
            "distance_meters": None,
            "duration_seconds": None,
            "calculated_at": None,
        }

    try:
        result = _directions_for_locations(valid_locations, access_token, profile=profile)
    except MapboxRouteError as exc:
        return {
            **base_payload,
            "status": "mapbox_error",
            "error": str(exc),
            "cache_status": "miss",
            "geometry": None,
            "distance_meters": None,
            "duration_seconds": None,
            "calculated_at": None,
        }

    now = datetime.now(timezone.utc)
    cache = _persist_calculated_path(
        cache,
        route_id=route_id,
        profile=profile,
        signature=signature,
        result=result,
        waypoint_count=len(valid_locations),
        calculated_at=now,
    )

    return {
        **base_payload,
        "status": "ok",
        "cache_status": "refreshed" if refresh else "miss",
        "geometry": cache.geometry_geojson,
        "distance_meters": cache.distance_meters,
        "duration_seconds": cache.duration_seconds,
        "calculated_at": cache.calculated_at.isoformat() if cache.calculated_at else None,
    }


def _persist_calculated_path(
    cache: MonthlyRouteCalculatedPath | None,
    *,
    route_id: int,
    profile: str,
    signature: str,
    result: dict[str, object],
    waypoint_count: int,
    calculated_at: datetime,
) -> MonthlyRouteCalculatedPath:
    if cache is None:
        cache = MonthlyRouteCalculatedPath(
            monthly_route_id=route_id,
            profile=profile,
            provider=MAPBOX_DIRECTIONS_PROVIDER,
        )
        db.session.add(cache)

    _apply_calculated_path_values(
        cache,
        signature=signature,
        result=result,
        waypoint_count=waypoint_count,
        calculated_at=calculated_at,
    )
    try:
        db.session.commit()
    except IntegrityError:
        # React StrictMode / fast double-clicks can trigger two cold-cache GETs.
        # If another request inserted this route/profile first, update that row
        # instead of surfacing a 500 from the unique constraint.
        db.session.rollback()
        cache = MonthlyRouteCalculatedPath.query.filter_by(
            monthly_route_id=route_id,
            profile=profile,
        ).one_or_none()
        if cache is None:
            raise
        _apply_calculated_path_values(
            cache,
            signature=signature,
            result=result,
            waypoint_count=waypoint_count,
            calculated_at=calculated_at,
        )
        db.session.commit()
    return cache


def _apply_calculated_path_values(
    cache: MonthlyRouteCalculatedPath,
    *,
    signature: str,
    result: dict[str, object],
    waypoint_count: int,
    calculated_at: datetime,
) -> None:
    cache.stop_signature = signature
    cache.geometry_geojson = result["geometry"]
    cache.distance_meters = result["distance_meters"]
    cache.duration_seconds = result["duration_seconds"]
    cache.waypoint_count = waypoint_count
    cache.provider_response_summary = result["provider_response_summary"]
    cache.calculated_at = calculated_at


def _directions_for_locations(
    locations: list[MonthlyRouteLocation],
    access_token: str,
    *,
    profile: str,
) -> dict[str, object]:
    total_distance = 0.0
    total_duration = 0.0
    merged_coordinates: list[list[float]] = []
    chunk_count = 0

    for chunk in _overlapping_chunks(locations, MAPBOX_DIRECTIONS_MAX_WAYPOINTS):
        chunk_count += 1
        route = _request_mapbox_directions(chunk, access_token, profile=profile)
        geometry = route.get("geometry")
        coords = geometry.get("coordinates") if isinstance(geometry, dict) else None
        if not isinstance(coords, list) or not coords:
            raise MapboxRouteError("Mapbox response did not include route geometry.")
        if merged_coordinates:
            merged_coordinates.extend(coords[1:])
        else:
            merged_coordinates.extend(coords)
        total_distance += float(route.get("distance") or 0)
        total_duration += float(route.get("duration") or 0)

    if len(merged_coordinates) < 2:
        raise MapboxRouteError("Mapbox response did not include enough route coordinates.")

    return {
        "geometry": {
            "type": "LineString",
            "coordinates": merged_coordinates,
        },
        "distance_meters": total_distance,
        "duration_seconds": total_duration,
        "provider_response_summary": {
            "chunks": chunk_count,
            "profile": profile,
        },
    }


def _request_mapbox_directions(
    locations: list[MonthlyRouteLocation],
    access_token: str,
    *,
    profile: str,
) -> dict[str, object]:
    coord_text = ";".join(f"{float(loc.longitude)},{float(loc.latitude)}" for loc in locations)
    endpoint = f"https://api.mapbox.com/directions/v5/mapbox/{url_parse.quote(profile)}/{coord_text}"
    query = url_parse.urlencode(
        {
            "access_token": access_token,
            "geometries": "geojson",
            "overview": "full",
            "steps": "false",
        }
    )
    req = url_request.Request(
        f"{endpoint}?{query}",
        headers={"User-Agent": "schedule-assist-monthly-route-directions/1.0"},
    )
    try:
        with url_request.urlopen(req, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (url_error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise MapboxRouteError("Unable to calculate route with Mapbox.") from exc

    routes = payload.get("routes") if isinstance(payload, dict) else None
    if not isinstance(routes, list) or not routes:
        message = payload.get("message") if isinstance(payload, dict) else None
        raise MapboxRouteError(str(message or "Mapbox did not return a route."))
    route = routes[0]
    if not isinstance(route, dict):
        raise MapboxRouteError("Mapbox route response was invalid.")
    return route


def _overlapping_chunks(
    locations: list[MonthlyRouteLocation],
    max_waypoints: int,
) -> list[list[MonthlyRouteLocation]]:
    if len(locations) <= max_waypoints:
        return [locations]

    chunks: list[list[MonthlyRouteLocation]] = []
    start = 0
    while start < len(locations) - 1:
        end = min(start + max_waypoints, len(locations))
        chunk = locations[start:end]
        if len(chunk) >= 2:
            chunks.append(chunk)
        if end >= len(locations):
            break
        start = end - 1
    return chunks


def _valid_coordinates(lat: object, lng: object) -> bool:
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return False
    return -90 <= float(lat) <= 90 and -180 <= float(lng) <= 180


def _rounded_coordinate(value: object) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return round(float(value), 6)
