from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import os
from urllib import error as url_error, parse as url_parse, request as url_request
import json
import math
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request, session
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import joinedload

from app.db_models import (
    Key,
    MonthlyRoute,
    MonthlyRouteComment,
    MonthlyRouteLocation,
    MonthlyRouteLocationComment,
    MonthlyRouteSnapshot,
    MonthlyRouteSpecialistMonth,
    MonthlyRouteTestHistory,
    MonthlyRouteWorksheetAuditEvent,
    db,
)
from app.monthly.key_resolve import sync_key_fk_for_location
from app.monthly.route_sync import sync_monthly_route_fk_for_location
monthly_routes_bp = Blueprint("monthly_routes", __name__)
# Max rows from ``monthly_route_specialist_month`` returned on route detail (align with script default lookback).
_ROUTE_DETAIL_SPECIALIST_MONTHS_LIMIT = int(os.getenv("MONTHLY_ROUTE_DETAIL_SPECIALIST_MONTHS", "24"))
PACIFIC_TZ = ZoneInfo("America/Vancouver")
VICTORIA_PROXIMITY_LNG = -123.3656
VICTORIA_PROXIMITY_LAT = 48.4284
# Approx Greater Victoria bounding box: west,south,east,north
VICTORIA_BBOX = (-123.75, 48.25, -123.10, 48.75)
VICTORIA_MAX_DISTANCE_KM = 80.0

# Web UI deep links for ``MonthlyRoute.service_trade_route_location_id`` (route pseudo-location).
SERVICE_TRADE_APP_LOCATIONS_BASE = os.getenv(
    "SERVICE_TRADE_APP_LOCATIONS_BASE",
    "https://app.servicetrade.com/locations",
).rstrip("/")


def _parse_month(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_positive_int(value: str | None, default: int) -> int:
    try:
        parsed = int((value or "").strip() or str(default))
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _month_range(start_month: date, end_month: date) -> list[date]:
    months: list[date] = []
    cursor = date(start_month.year, start_month.month, 1)
    boundary = date(end_month.year, end_month.month, 1)
    while cursor <= boundary:
        months.append(cursor)
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return months


def _clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_status(value: str | None) -> tuple[str, str | None]:
    cleaned = (value or "").strip()
    if not cleaned:
        return "unknown", None
    normalized = cleaned.lower().replace(" ", "_")
    if normalized in {"active", "cancelled", "on_hold", "waiting_keys"}:
        return normalized, cleaned
    return "unknown", cleaned


def _is_annual_month(month_date: date, annual_month: str | None) -> bool:
    annual = (annual_month or "").strip().lower()
    if not annual:
        return False
    full = month_date.strftime("%B").lower()
    short = month_date.strftime("%b").lower()
    return annual in {full, short}


def _parse_price(value: object) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("price_per_month must be a valid number or null")


def _build_geocode_query(loc: MonthlyRouteLocation) -> str:
    parts = [loc.address, loc.building, loc.property_management_company]
    tokens = [str(part).strip() for part in parts if part and str(part).strip()]
    tokens.append("Victoria, BC, Canada")
    return ", ".join(tokens)


def _get_monthly_location(location_id: int) -> MonthlyRouteLocation | None:
    return (
        MonthlyRouteLocation.query.options(
            joinedload(MonthlyRouteLocation.monthly_route),
            joinedload(MonthlyRouteLocation.linked_key),
        )
        .filter_by(id=location_id)
        .one_or_none()
    )


def _build_route_counts(locations: list[MonthlyRouteLocation]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for loc in locations:
        route = (loc.test_day or "").strip()
        if not route:
            continue
        counts[route] = counts.get(route, 0) + 1
    return counts


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


def _geocode_with_mapbox(query: str, access_token: str) -> tuple[float, float] | None:
    endpoint = "https://api.mapbox.com/geocoding/v5/mapbox.places/"
    url = (
        f"{endpoint}{url_parse.quote(query)}.json"
        f"?access_token={url_parse.quote(access_token)}"
        f"&limit=1&autocomplete=false&country=ca&types=address"
        f"&proximity={VICTORIA_PROXIMITY_LNG},{VICTORIA_PROXIMITY_LAT}"
        f"&bbox={VICTORIA_BBOX[0]},{VICTORIA_BBOX[1]},{VICTORIA_BBOX[2]},{VICTORIA_BBOX[3]}"
    )
    req = url_request.Request(url, headers={"User-Agent": "schedule-assist-monthly-routes/1.0"})
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
    return (lat, lng)


def _populate_missing_coordinates(locations: list[MonthlyRouteLocation]) -> None:
    access_token = os.getenv("MAPBOX_ACCESS_TOKEN")
    if not access_token:
        return

    updated = False
    for loc in locations:
        if loc.latitude is not None and loc.longitude is not None:
            continue
        query = _build_geocode_query(loc)
        coords = _geocode_with_mapbox(query, access_token)
        if not coords:
            continue
        loc.latitude, loc.longitude = coords
        updated = True
    if updated:
        db.session.commit()


def _english_ordinal(n: int) -> str:
    """1st, 2nd, … for monthly week occurrence (typically 1..5)."""
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _serialize_monthly_route_entity(
    mr: MonthlyRoute | None,
    *,
    location_count: int | None = None,
) -> dict[str, object] | None:
    """Nested route summary for API consumers (single source of truth: ``MonthlyRoute``)."""
    if mr is None:
        return None
    wd_names = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    wd = (
        wd_names[mr.weekday_iso]
        if isinstance(mr.weekday_iso, int) and 0 <= mr.weekday_iso <= 6
        else "?"
    )
    occ = int(mr.week_occurrence) if mr.week_occurrence is not None else 0
    nth = _english_ordinal(occ) if occ >= 1 else str(occ)
    label = f"R{mr.route_number} · {nth} {wd}"
    st_rid = mr.service_trade_route_location_id
    dn = (mr.display_name or "").strip()
    out: dict[str, object] = {
        "id": mr.id,
        "route_number": mr.route_number,
        "display_name": dn or None,
        "weekday_iso": mr.weekday_iso,
        "week_occurrence": mr.week_occurrence,
        "label": label,
        "service_trade_route_location_id": int(st_rid) if st_rid is not None else None,
        "service_trade_route_location_url": (
            f"{SERVICE_TRADE_APP_LOCATIONS_BASE}/{int(st_rid)}" if st_rid is not None else None
        ),
    }
    if location_count is not None:
        out["location_count"] = location_count
    return out


def _meta_monthly_routes_bundle() -> tuple[list[dict[str, object]], dict[int, int]]:
    """All route entities plus location counts keyed by ``monthly_route.id``."""
    mr_rows = MonthlyRoute.query.order_by(MonthlyRoute.route_number.asc()).all()
    count_rows = (
        db.session.query(
            MonthlyRouteLocation.monthly_route_id,
            func.count(MonthlyRouteLocation.id),
        )
        .filter(MonthlyRouteLocation.monthly_route_id.isnot(None))
        .group_by(MonthlyRouteLocation.monthly_route_id)
        .all()
    )
    count_map: dict[int, int] = {int(mid): int(n) for mid, n in count_rows if mid is not None}
    summaries: list[dict[str, object]] = []
    for r in mr_rows:
        entry = _serialize_monthly_route_entity(r, location_count=count_map.get(int(r.id), 0))
        if entry:
            summaries.append(entry)
    return summaries, count_map


def _serialize_linked_key(key: Key | None) -> dict[str, object] | None:
    if key is None:
        return None
    bc = key.barcode
    return {
        "id": int(key.id),
        "keycode": key.keycode,
        "barcode": int(bc) if bc is not None else None,
    }


def _months_payload_for_location(location_id: int) -> dict[str, dict[str, object]]:
    history_rows = (
        MonthlyRouteTestHistory.query.options(joinedload(MonthlyRouteTestHistory.test_monthly_route))
        .filter_by(location_id=location_id)
        .order_by(MonthlyRouteTestHistory.month_date.asc())
        .all()
    )
    out: dict[str, dict[str, object]] = {}
    for row in history_rows:
        out[row.month_date.isoformat()] = {
            "result_status": row.result_status,
            "skip_reason": row.skip_reason,
            "test_monthly_route": _serialize_monthly_route_entity(row.test_monthly_route),
        }
    return out


def _serialize_staff_comment(
    id_: int,
    body: str,
    author_username: str | None,
    created_at,
    updated_at,
) -> dict[str, object]:
    ts = created_at.isoformat() if created_at else None
    uts = updated_at.isoformat() if updated_at else None
    return {
        "id": id_,
        "body": body,
        "author_username": author_username,
        "created_at": ts,
        "updated_at": uts,
    }


def _serialize_monthly_location_comment(row: MonthlyRouteLocationComment) -> dict[str, object]:
    return _serialize_staff_comment(
        int(row.id),
        row.body,
        row.author_username,
        row.created_at,
        row.updated_at,
    )


def _serialize_monthly_route_comment(row: MonthlyRouteComment) -> dict[str, object]:
    return _serialize_staff_comment(
        int(row.id),
        row.body,
        row.author_username,
        row.created_at,
        row.updated_at,
    )


def _session_username_clean() -> str | None:
    raw = session.get("username")
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _comment_modify_allowed(author_username: str | None) -> bool:
    sess = _session_username_clean()
    if not sess:
        return False
    author = (author_username or "").strip()
    if not author:
        return False
    return author.casefold() == sess.casefold()


def _get_monthly_route(route_id: int) -> MonthlyRoute | None:
    return MonthlyRoute.query.filter_by(id=route_id).one_or_none()


def _filtered_specialists_for_st_route_location(st_route_location_id: int) -> dict[str, object]:
    """Snapshot row for this ST route location; ``top_technicians`` includes all attributed names (past + present)."""
    snap = MonthlyRouteSnapshot.query.filter_by(location_id=st_route_location_id).one_or_none()

    if snap is None:
        return {
            "location_id": st_route_location_id,
            "location_name": "",
            "completed_jobs_count": 0,
            "top_technicians": [],
            "last_updated_at": None,
        }

    return {
        "location_id": snap.location_id,
        "location_name": snap.location_name,
        "completed_jobs_count": snap.completed_jobs_count,
        "top_technicians": snap.top_technicians or [],
        "last_updated_at": (
            snap.last_updated_at.isoformat()
            if snap.last_updated_at
            else None
        ),
    }


def _sheet_skip_reason_is_annual(skip_reason: str | None) -> bool:
    """True for sheet-classified annual skips (CSV importer uses ``annual_booked``)."""
    s = (skip_reason or "").strip().lower()
    return s in {"annual", "annual_booked"}


def _skip_site_base(loc: MonthlyRouteLocation | None, location_id: int) -> dict:
    """``id`` + display label for skipped-site lists on route detail."""
    if loc is None:
        return {"id": location_id, "label": f"Location {location_id}"}
    label = (loc.display_address or loc.address or "").strip()
    if not label:
        label = f"Location {loc.id}"
    return {"id": int(loc.id), "label": label}


def _merged_route_test_history_rows(route_id: int) -> list[MonthlyRouteTestHistory]:
    """Attributed sheet-history rows for ``route_id`` (stamp wins over legacy per location+month)."""
    loc_ids = [
        lid
        for (lid,) in MonthlyRouteLocation.query.with_entities(MonthlyRouteLocation.id)
        .filter(MonthlyRouteLocation.monthly_route_id == route_id)
        .all()
    ]
    hist_attr = MonthlyRouteTestHistory.query.filter(
        MonthlyRouteTestHistory.test_monthly_route_id == route_id,
    ).all()
    hist_legacy: list[MonthlyRouteTestHistory] = []
    if loc_ids:
        hist_legacy = MonthlyRouteTestHistory.query.filter(
            MonthlyRouteTestHistory.test_monthly_route_id.is_(None),
            MonthlyRouteTestHistory.location_id.in_(loc_ids),
        ).all()
    merged: dict[tuple[int, date], MonthlyRouteTestHistory] = {}
    for row in hist_attr + hist_legacy:
        merged[(int(row.location_id), row.month_date)] = row
    return list(merged.values())


def _route_testing_by_month(route_id: int) -> dict[str, dict]:
    """Month keys (YYYY-MM-01): counts and skipped-site lists from ``monthly_route_test_history``.

    Rows explicitly stamped with ``test_monthly_route_id`` count toward that route even if the
    site moved later. Legacy rows with a NULL stamp still count only when the site is **currently**
    assigned to this route.
    """
    history_rows = _merged_route_test_history_rows(route_id)
    if not history_rows:
        return {}

    required_loc_ids = {int(r.location_id) for r in history_rows}
    loc_by_id = {
        loc.id: loc
        for loc in MonthlyRouteLocation.query.filter(MonthlyRouteLocation.id.in_(required_loc_ids)).all()
    }

    def _fresh_month() -> dict:
        return {
            "sites_tested_count": 0,
            "skipped_non_annual_count": 0,
            "skipped_annual_count": 0,
            "skipped_non_annual_sites": [],
            "skipped_annual_sites": [],
            "tested_revenue_total": 0.0,
            "tested_sites_missing_price_count": 0,
        }

    by_month: dict[str, dict] = {}
    for row in history_rows:
        key = row.month_date.isoformat()
        entry = by_month.setdefault(key, _fresh_month())
        status = (row.result_status or "").strip().lower()
        if status == "skipped":
            lid = int(row.location_id)
            base = _skip_site_base(loc_by_id.get(lid), lid)
            if _sheet_skip_reason_is_annual(row.skip_reason):
                entry["skipped_annual_count"] += 1
                entry["skipped_annual_sites"].append(base)
            else:
                reason = (row.skip_reason or "").strip()
                entry["skipped_non_annual_count"] += 1
                entry["skipped_non_annual_sites"].append({**base, "skip_reason": reason or None})
        elif status == "tested":
            entry["sites_tested_count"] += 1
            lid = int(row.location_id)
            loc = loc_by_id.get(lid)
            if loc is not None and loc.price_per_month is not None:
                entry["tested_revenue_total"] += float(loc.price_per_month)
            else:
                entry["tested_sites_missing_price_count"] += 1
        else:
            entry["sites_tested_count"] += 1

    for entry in by_month.values():
        na = entry["skipped_non_annual_sites"]
        na.sort(key=lambda s: (str(s["label"]).casefold(), int(s["id"])))
        ann = entry["skipped_annual_sites"]
        ann.sort(key=lambda s: (str(s["label"]).casefold(), int(s["id"])))

    return by_month


def _testing_history_rows_attributed_to_route_month(
    route_id: int, month_first: date
) -> list[MonthlyRouteTestHistory]:
    """Same attribution scope as ``_route_testing_by_month`` but for a single calendar month."""
    loc_ids = [
        lid
        for (lid,) in MonthlyRouteLocation.query.with_entities(MonthlyRouteLocation.id)
        .filter(MonthlyRouteLocation.monthly_route_id == route_id)
        .all()
    ]
    hist_attr = MonthlyRouteTestHistory.query.filter(
        MonthlyRouteTestHistory.test_monthly_route_id == route_id,
        MonthlyRouteTestHistory.month_date == month_first,
    ).all()
    hist_legacy: list[MonthlyRouteTestHistory] = []
    if loc_ids:
        hist_legacy = MonthlyRouteTestHistory.query.filter(
            MonthlyRouteTestHistory.test_monthly_route_id.is_(None),
            MonthlyRouteTestHistory.location_id.in_(loc_ids),
            MonthlyRouteTestHistory.month_date == month_first,
        ).all()
    merged: dict[tuple[int, date], MonthlyRouteTestHistory] = {}
    for row in hist_attr + hist_legacy:
        merged[(int(row.location_id), row.month_date)] = row
    return list(merged.values())


def _session_stop_sheet_notes_from_history_and_location(
    row: MonthlyRouteTestHistory,
    loc: MonthlyRouteLocation | None,
) -> tuple[str | None, str | None]:
    """Prefer month-specific history columns; fall back to current location for rows imported before those existed."""
    tp = (row.testing_procedures or "").strip() or None
    tn = (row.inspection_tech_notes or "").strip() or None
    if tp is None and loc is not None:
        tp = (loc.testing_procedures or "").strip() or None
    if tn is None and loc is not None:
        tn = (loc.inspection_tech_notes or "").strip() or None
    return tp, tn


def _worksheet_row_from_history(
    row: MonthlyRouteTestHistory,
    loc: MonthlyRouteLocation | None,
    *,
    route_id: int,
) -> dict[str, object]:
    display_address = ""
    if loc is not None:
        display_address = (loc.display_address or loc.address or "").strip()
    if not display_address:
        display_address = f"Location {int(row.location_id)}"

    monitoring_label: str | None = None
    if loc is not None and loc.monitoring_company is not None:
        monitoring_label = (loc.monitoring_company.name or "").strip() or None
    return {
        "location_id": int(row.location_id),
        "history_row_id": int(row.id),
        "month_date": row.month_date.isoformat(),
        "display_address": display_address,
        "building": (loc.building or "").strip() if loc else None,
        "property_management_company": (loc.property_management_company or "").strip() if loc else None,
        "annual_month": (loc.annual_month or "").strip() if loc else None,
        "ring": (loc.ring_detail or "").strip() if loc else None,
        "key_number": (loc.keys or "").strip() if loc else None,
        "facp": (loc.facp_detail or "").strip() if loc else None,
        "monitoring": monitoring_label,
        "result_status": row.result_status,
        "skip_reason": row.skip_reason,
        "testing_procedures": row.testing_procedures,
        "inspection_tech_notes": row.inspection_tech_notes,
        "time_in": row.sheet_time_in_raw,
        "time_out": row.sheet_time_out_raw,
        "version_updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _serialize_technician_worksheet_payload(route_id: int, month_first: date) -> dict[str, object] | None:
    mr = _get_monthly_route(route_id)
    if mr is None:
        return None
    rows = _testing_history_rows_attributed_to_route_month(route_id, month_first)
    location_count = MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id).count()
    if not rows:
        return {
            "route": _serialize_monthly_route_entity(mr, location_count=location_count),
            "month_date": month_first.isoformat(),
            "rows": [],
        }
    loc_by_id = {
        loc.id: loc
        for loc in MonthlyRouteLocation.query.options(joinedload(MonthlyRouteLocation.monitoring_company))
        .filter(MonthlyRouteLocation.id.in_({int(r.location_id) for r in rows}))
        .all()
    }
    out_rows = [_worksheet_row_from_history(r, loc_by_id.get(int(r.location_id)), route_id=route_id) for r in rows]
    out_rows.sort(key=lambda r: str(r["display_address"]).casefold())
    return {
        "route": _serialize_monthly_route_entity(mr, location_count=location_count),
        "month_date": month_first.isoformat(),
        "rows": out_rows,
    }


def _parse_iso_dt(value: object) -> datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _normalize_ws_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _next_worksheet_audit_event_id() -> int:
    """SQLite test DB does not auto-generate BIGINT PK reliably; assign defensively."""
    current = db.session.query(func.coalesce(func.max(MonthlyRouteWorksheetAuditEvent.id), 0)).scalar()
    return int(current or 0) + 1


def _serialize_testing_session_payload(route_id: int, month_first: date) -> dict[str, object] | None:
    mr = _get_monthly_route(route_id)
    if mr is None:
        return None
    rows = _testing_history_rows_attributed_to_route_month(route_id, month_first)
    if not rows:
        location_count = MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id).count()
        return {
            "route": _serialize_monthly_route_entity(mr, location_count=location_count),
            "month_date": month_first.isoformat(),
            "stops": [],
            "counts": {
                "sites_tested_count": 0,
                "skipped_non_annual_count": 0,
                "skipped_annual_count": 0,
            },
        }

    loc_by_id = {
        loc.id: loc
        for loc in MonthlyRouteLocation.query.filter(
            MonthlyRouteLocation.id.in_({int(r.location_id) for r in rows})
        ).all()
    }

    def label_address(loc: MonthlyRouteLocation | None, lid: int) -> str:
        if loc is None:
            return f"Location {lid}"
        s = (loc.display_address or loc.address or "").strip()
        return s or f"Location {lid}"

    stops_raw: list[dict[str, object]] = []
    tested_ct = 0
    skipped_na_ct = 0
    skipped_ann_ct = 0

    for row in rows:
        lid = int(row.location_id)
        loc = loc_by_id.get(lid)
        still = (
            loc is not None
            and loc.monthly_route_id is not None
            and int(loc.monthly_route_id) == int(route_id)
        )
        ro = int(loc.route_stop_order) if still and loc.route_stop_order is not None else None
        sess = row.session_route_stop_order
        status = (row.result_status or "").strip().lower()
        if status == "skipped":
            if _sheet_skip_reason_is_annual(row.skip_reason):
                skipped_ann_ct += 1
            else:
                skipped_na_ct += 1
        elif status == "tested":
            tested_ct += 1
        else:
            tested_ct += 1

        if sess is not None:
            sort_tier = 0
            sort_ord = int(sess)
        elif still and ro is not None:
            sort_tier = 1
            sort_ord = ro
        else:
            sort_tier = 2
            sort_ord = 10**9

        tp, tn = _session_stop_sheet_notes_from_history_and_location(row, loc)
        stops_raw.append(
            {
                "location_id": lid,
                "label_address": label_address(loc, lid),
                "building": (loc.building or "").strip() or None if loc else None,
                "result_status": row.result_status,
                "skip_reason": row.skip_reason,
                "source_value_raw": row.source_value_raw,
                "testing_procedures": tp,
                "inspection_tech_notes": tn,
                "time_in": row.sheet_time_in_raw,
                "time_out": row.sheet_time_out_raw,
                "still_on_route": still,
                "route_stop_order": ro,
                "session_route_stop_order": int(sess) if sess is not None else None,
                "_sort_tier": sort_tier,
                "_sort_ord": sort_ord,
                "_sort_addr": label_address(loc, lid).casefold(),
            }
        )

    stops_raw.sort(key=lambda s: (int(s["_sort_tier"]), int(s["_sort_ord"]), str(s["_sort_addr"])))
    stops_out = []
    for i, s in enumerate(stops_raw, start=1):
        stops_out.append(
            {
                "location_id": s["location_id"],
                "label_address": s["label_address"],
                "building": s["building"],
                "result_status": s["result_status"],
                "skip_reason": s["skip_reason"],
                "source_value_raw": s["source_value_raw"],
                "testing_procedures": s["testing_procedures"],
                "inspection_tech_notes": s["inspection_tech_notes"],
                "time_in": s["time_in"],
                "time_out": s["time_out"],
                "still_on_route": s["still_on_route"],
                "route_stop_order": s["route_stop_order"],
                "session_route_stop_order": s["session_route_stop_order"],
                "display_order": i,
            }
        )

    location_count = MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id).count()
    return {
        "route": _serialize_monthly_route_entity(mr, location_count=location_count),
        "month_date": month_first.isoformat(),
        "stops": stops_out,
        "counts": {
            "sites_tested_count": tested_ct,
            "skipped_non_annual_count": skipped_na_ct,
            "skipped_annual_count": skipped_ann_ct,
        },
    }


def _serialize_route_location_list_item(loc: MonthlyRouteLocation) -> dict[str, object]:
    """Lightweight row for route detail / reorder (no per-month grid)."""
    return {
        "id": loc.id,
        "address": loc.address,
        "display_address": loc.display_address,
        "building": loc.building,
        "status_normalized": loc.status_normalized,
        "annual_month": loc.annual_month,
        "route_stop_order": loc.route_stop_order,
        "monthly_route_id": loc.monthly_route_id,
    }


def _sync_route_stop_order_after_fk_change(
    loc: MonthlyRouteLocation,
    previous_monthly_route_id: int | None,
) -> None:
    """Set or clear ``route_stop_order`` when a site joins, leaves, or switches routes."""
    if loc.monthly_route_id is None:
        loc.route_stop_order = None
        return

    if previous_monthly_route_id != loc.monthly_route_id:
        loc.route_stop_order = None

    if loc.route_stop_order is None:
        mx = (
            db.session.query(func.coalesce(func.max(MonthlyRouteLocation.route_stop_order), -1))
            .filter(
                MonthlyRouteLocation.monthly_route_id == loc.monthly_route_id,
                MonthlyRouteLocation.id != loc.id,
            )
            .scalar()
        )
        loc.route_stop_order = int(mx) + 1


def _serialize_location_row(
    loc: MonthlyRouteLocation,
    months_payload: dict[str, dict[str, object]],
) -> dict[str, object]:
    mr = loc.monthly_route
    lk = loc.linked_key
    return {
        "id": loc.id,
        "address": loc.address,
        "display_address": loc.display_address,
        "property_management_company": loc.property_management_company,
        "building": loc.building,
        "notes": loc.notes,
        "barcode": loc.barcode,
        "price_per_month": float(loc.price_per_month) if loc.price_per_month is not None else None,
        "area": loc.area,
        "start_up_date": loc.start_up_date.isoformat() if loc.start_up_date else None,
        "status_normalized": loc.status_normalized,
        "status_raw": loc.status_raw,
        "keys": loc.keys,
        "key_id": loc.key_id,
        "key": _serialize_linked_key(lk),
        "test_day": loc.test_day,
        "annual_month": loc.annual_month,
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "monthly_route_id": loc.monthly_route_id,
        "route_stop_order": loc.route_stop_order,
        "monthly_route": _serialize_monthly_route_entity(mr),
        "months": months_payload,
    }


def _serialize_geocode_candidate(feature: dict[str, object]) -> dict[str, object] | None:
    center = feature.get("center")
    place_name = feature.get("place_name")
    if (
        not isinstance(center, list)
        or len(center) < 2
        or not isinstance(center[0], (int, float))
        or not isinstance(center[1], (int, float))
        or not isinstance(place_name, str)
    ):
        return None
    lat = float(center[1])
    lng = float(center[0])
    if not _is_victoria_area(lat, lng):
        return None
    return {
        "display_address": place_name,
        "latitude": lat,
        "longitude": lng,
    }


@monthly_routes_bp.get("/api/monthly_routes/library")
def monthly_routes_library():
    q = (request.args.get("q") or "").strip().casefold()
    route = (request.args.get("route") or "").strip()
    skipped_any = (request.args.get("skipped_any") or "").strip().lower() == "true"
    annual_tested_conflict = (request.args.get("annual_tested_conflict") or "").strip().lower() == "true"
    active_only = (request.args.get("active_only") or "").strip().lower() == "true"
    include_coordinates = (request.args.get("include_coordinates") or "").strip().lower() == "true"
    unpaginated = (request.args.get("unpaginated") or "").strip().lower() == "true"
    from_month = _parse_month(request.args.get("from_month"))
    to_month = _parse_month(request.args.get("to_month"))
    page = _parse_positive_int(request.args.get("page"), 1)
    page_size = min(_parse_positive_int(request.args.get("page_size"), 50), 200)

    range_conditions = []
    if from_month:
        range_conditions.append(MonthlyRouteTestHistory.month_date >= from_month)
    if to_month:
        range_conditions.append(MonthlyRouteTestHistory.month_date <= to_month)

    meta_month_query = (
        MonthlyRouteTestHistory.query.with_entities(
            func.min(MonthlyRouteTestHistory.month_date),
            func.max(MonthlyRouteTestHistory.month_date),
        )
    )
    min_month, max_month = meta_month_query.first() or (None, None)

    location_query = MonthlyRouteLocation.query.options(
        joinedload(MonthlyRouteLocation.monthly_route),
        joinedload(MonthlyRouteLocation.linked_key),
    )
    if active_only:
        location_query = location_query.filter(MonthlyRouteLocation.status_normalized == "active")
    if q:
        location_query = location_query.filter(
            or_(
                func.lower(func.coalesce(MonthlyRouteLocation.address, "")).contains(q),
                func.lower(func.coalesce(MonthlyRouteLocation.test_day, "")).contains(q),
                func.lower(func.coalesce(MonthlyRouteLocation.property_management_company, "")).contains(q),
                func.lower(func.coalesce(MonthlyRouteLocation.keys, "")).contains(q),
                func.lower(func.coalesce(MonthlyRouteLocation.annual_month, "")).contains(q),
            )
        )
    if route:
        location_query = location_query.filter(MonthlyRouteLocation.test_day == route)

    if route:
        ordered_location_query = location_query.order_by(
            MonthlyRouteLocation.route_stop_order.asc().nulls_last(),
            MonthlyRouteLocation.address.asc(),
        )
    else:
        ordered_location_query = location_query.order_by(MonthlyRouteLocation.address.asc())

    count_scope_locations: list[MonthlyRouteLocation]

    special_library_filters = skipped_any or annual_tested_conflict

    if special_library_filters:
        candidate_locations = ordered_location_query.all()
        candidate_ids = [loc.id for loc in candidate_locations]
        annual_by_location = {loc.id: loc.annual_month for loc in candidate_locations}

        id_sets: list[set[int]] = []

        if skipped_any:
            skipped_ids: set[int] = set()
            if candidate_ids:
                skipped_hist_query = MonthlyRouteTestHistory.query.filter(
                    MonthlyRouteTestHistory.location_id.in_(candidate_ids),
                    MonthlyRouteTestHistory.result_status == "skipped",
                )
                if range_conditions:
                    skipped_hist_query = skipped_hist_query.filter(and_(*range_conditions))
                for row in skipped_hist_query.all():
                    if not _is_annual_month(row.month_date, annual_by_location.get(row.location_id)):
                        skipped_ids.add(row.location_id)
            id_sets.append(skipped_ids)

        if annual_tested_conflict:
            conflict_ids: set[int] = set()
            if candidate_ids:
                tested_hist_query = MonthlyRouteTestHistory.query.filter(
                    MonthlyRouteTestHistory.location_id.in_(candidate_ids),
                    MonthlyRouteTestHistory.result_status == "tested",
                )
                if range_conditions:
                    tested_hist_query = tested_hist_query.filter(and_(*range_conditions))
                for row in tested_hist_query.all():
                    if _is_annual_month(row.month_date, annual_by_location.get(row.location_id)):
                        conflict_ids.add(row.location_id)
            id_sets.append(conflict_ids)

        matching_ids = set.intersection(*id_sets) if id_sets else set(candidate_ids)
        filtered_locations = [loc for loc in candidate_locations if loc.id in matching_ids]
        count_scope_locations = filtered_locations
        total_locations = len(filtered_locations)
        if unpaginated:
            locations = filtered_locations
            page = 1
            total_pages = 1
        else:
            total_pages = max((total_locations + page_size - 1) // page_size, 1)
            if page > total_pages:
                page = total_pages
            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size
            locations = filtered_locations[start_idx:end_idx]
    else:
        if unpaginated:
            locations = ordered_location_query.all()
            count_scope_locations = locations
            total_locations = len(locations)
            page = 1
            total_pages = 1
        else:
            count_scope_locations = ordered_location_query.all()
            total_locations = ordered_location_query.count()
            total_pages = max((total_locations + page_size - 1) // page_size, 1)
            if page > total_pages:
                page = total_pages
            locations = ordered_location_query.offset((page - 1) * page_size).limit(page_size).all()
    route_counts = _build_route_counts(count_scope_locations)
    monthly_routes_meta, _ = _meta_monthly_routes_bundle()

    location_ids = [l.id for l in locations]
    if not location_ids:
        route_options_query = (
            MonthlyRouteLocation.query.with_entities(MonthlyRouteLocation.test_day)
            .filter(MonthlyRouteLocation.test_day.isnot(None))
            .filter(MonthlyRouteLocation.test_day != "")
            .distinct()
            .order_by(MonthlyRouteLocation.test_day.asc())
        )
        route_options = [value for (value,) in route_options_query.all()]
        return jsonify(
            {
                "locations": [],
                "month_columns": [],
                "meta": {
                    "routes": route_options,
                    "monthly_routes": monthly_routes_meta,
                    "min_month": min_month.isoformat() if min_month else None,
                    "max_month": max_month.isoformat() if max_month else None,
                    "route_counts": route_counts,
                    "pagination": {
                        "page": page,
                        "page_size": page_size,
                        "total": total_locations,
                        "total_pages": total_pages,
                    },
                },
            }
        )

    hist_query = MonthlyRouteTestHistory.query.options(
        joinedload(MonthlyRouteTestHistory.test_monthly_route)
    ).filter(MonthlyRouteTestHistory.location_id.in_(location_ids))
    if range_conditions:
        hist_query = hist_query.filter(and_(*range_conditions))
    history_rows = hist_query.all()

    if include_coordinates:
        _populate_missing_coordinates(locations)

    if from_month and to_month:
        start = min(from_month, to_month)
        end = max(from_month, to_month)
        months = _month_range(start, end)
    else:
        months = sorted({r.month_date for r in history_rows})
    by_location: dict[int, dict[str, dict[str, object]]] = {}
    for row in history_rows:
        by_location.setdefault(row.location_id, {})[row.month_date.isoformat()] = {
            "result_status": row.result_status,
            "skip_reason": row.skip_reason,
            "test_monthly_route": _serialize_monthly_route_entity(row.test_monthly_route),
        }

    rows_payload = []
    for loc in locations:
        rows_payload.append(_serialize_location_row(loc, by_location.get(loc.id, {})))

    route_options_query = (
        MonthlyRouteLocation.query.with_entities(MonthlyRouteLocation.test_day)
        .filter(MonthlyRouteLocation.test_day.isnot(None))
        .filter(MonthlyRouteLocation.test_day != "")
        .distinct()
        .order_by(MonthlyRouteLocation.test_day.asc())
    )
    route_options = [value for (value,) in route_options_query.all()]

    return jsonify(
        {
            "locations": rows_payload,
            "month_columns": [m.isoformat() for m in months],
            "meta": {
                "routes": route_options,
                "monthly_routes": monthly_routes_meta,
                "min_month": min_month.isoformat() if min_month else None,
                "max_month": max_month.isoformat() if max_month else None,
                "route_counts": route_counts,
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total_locations,
                    "total_pages": total_pages,
                },
            },
        }
    )


@monthly_routes_bp.get("/api/monthly_routes/library/<int:location_id>")
def get_monthly_route_location(location_id: int):
    loc = _get_monthly_location(location_id)
    if loc is None:
        return jsonify({"error": "Location not found"}), 404

    months_by_location = _months_payload_for_location(location_id)
    comment_rows = (
        MonthlyRouteLocationComment.query.filter_by(location_id=location_id)
        .order_by(MonthlyRouteLocationComment.created_at.desc())
        .all()
    )
    comments_payload = [_serialize_monthly_location_comment(r) for r in comment_rows]
    return jsonify(
        {
            "location": _serialize_location_row(loc, months_by_location),
            "comments": comments_payload,
        }
    )


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>")
def get_monthly_route_detail(route_id: int):
    mr = _get_monthly_route(route_id)
    if mr is None:
        return jsonify({"error": "Route not found"}), 404

    location_count = MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id).count()
    comment_rows = (
        MonthlyRouteComment.query.filter_by(monthly_route_id=route_id)
        .order_by(MonthlyRouteComment.created_at.desc())
        .all()
    )
    comments_payload = [_serialize_monthly_route_comment(r) for r in comment_rows]
    testing_by_month = _route_testing_by_month(route_id)

    st_rid = mr.service_trade_route_location_id
    specialists_payload: dict[str, object] | None
    if st_rid is None:
        specialists_payload = None
    else:
        specialists_payload = _filtered_specialists_for_st_route_location(int(st_rid))

    specialist_month_rows = (
        MonthlyRouteSpecialistMonth.query.filter_by(monthly_route_id=route_id)
        .order_by(MonthlyRouteSpecialistMonth.month_first.desc())
        .limit(max(_ROUTE_DETAIL_SPECIALIST_MONTHS_LIMIT, 1))
        .all()
    )
    specialists_by_month: dict[str, dict[str, object]] = {
        row.month_first.isoformat(): {
            "top_technicians": row.top_technicians or [],
            "completed_jobs_attributed": row.completed_jobs_attributed,
            "route_tested_on": row.route_tested_on.isoformat() if row.route_tested_on else None,
            "last_updated_at": row.last_updated_at.isoformat() if row.last_updated_at else None,
        }
        for row in specialist_month_rows
    }

    route_locations = (
        MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id)
        .order_by(
            MonthlyRouteLocation.route_stop_order.asc().nulls_last(),
            MonthlyRouteLocation.address.asc(),
        )
        .all()
    )
    locations_payload = [_serialize_route_location_list_item(loc) for loc in route_locations]

    return jsonify(
        {
            "route": _serialize_monthly_route_entity(mr, location_count=location_count),
            "locations": locations_payload,
            "comments": comments_payload,
            "testing_by_month": testing_by_month,
            "specialists": specialists_payload,
            "specialists_by_month": specialists_by_month,
        }
    )


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>/testing_session")
def get_monthly_route_testing_session(route_id: int):
    """Full stop ledger for one sheet month (parity with ``testing_by_month`` attribution)."""
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400

    month_first = date(month_dt.year, month_dt.month, 1)
    payload = _serialize_testing_session_payload(route_id, month_first)
    if payload is None:
        return jsonify({"error": "Route not found"}), 404
    return jsonify(payload)


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>/worksheet")
def get_monthly_route_worksheet(route_id: int):
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400
    month_first = date(month_dt.year, month_dt.month, 1)
    payload = _serialize_technician_worksheet_payload(route_id, month_first)
    if payload is None:
        return jsonify({"error": "Route not found"}), 404
    return jsonify(payload)


@monthly_routes_bp.patch("/api/monthly_routes/routes/<int:route_id>/worksheet/rows/<int:location_id>")
def patch_monthly_route_worksheet_row(route_id: int, location_id: int):
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400
    month_first = date(month_dt.year, month_dt.month, 1)
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400
    changes = payload.get("changes")
    if not isinstance(changes, dict) or not changes:
        return jsonify({"error": "changes object is required"}), 400

    row = MonthlyRouteTestHistory.query.filter_by(
        location_id=location_id,
        month_date=month_first,
    ).one_or_none()
    if row is None:
        return jsonify({"error": "Worksheet row not found for location/month"}), 404
    if row.test_monthly_route_id is not None and int(row.test_monthly_route_id) != int(route_id):
        return jsonify({"error": "Worksheet row does not belong to this route"}), 404
    loc = _get_monthly_location(location_id)
    if loc is None:
        return jsonify({"error": "Location not found"}), 404

    expected = _normalize_ws_text(payload.get("expected_updated_at"))
    current_version = row.updated_at.isoformat() if row.updated_at else None
    # Client-wins policy: stale client versions do not block write.
    # We still keep ``current_version`` for audit/debug context if needed.
    _ = expected
    _ = current_version

    client_mutation_id = _normalize_ws_text(payload.get("client_mutation_id"))
    if client_mutation_id:
        existing_mutation = MonthlyRouteWorksheetAuditEvent.query.filter_by(
            client_mutation_id=client_mutation_id
        ).first()
        if existing_mutation is not None:
            return jsonify(
                {
                    "ok": True,
                    "deduped": True,
                    "row": _worksheet_row_from_history(row, loc, route_id=route_id),
                }
            )

    editable_location_fields = {
        "annual_month": "annual_month",
        "ring": "ring_detail",
        "key_number": "keys",
        "facp": "facp_detail",
    }
    editable_history_fields = {
        "result_status": "result_status",
        "skip_reason": "skip_reason",
        "testing_procedures": "testing_procedures",
        "inspection_tech_notes": "inspection_tech_notes",
        "time_in": "sheet_time_in_raw",
        "time_out": "sheet_time_out_raw",
    }
    known_fields = set(editable_location_fields.keys()) | set(editable_history_fields.keys())
    unknown = [k for k in changes.keys() if k not in known_fields]
    if unknown:
        return jsonify({"error": f"Unsupported worksheet fields: {', '.join(sorted(unknown))}"}), 400

    if "result_status" in changes:
        rs = _normalize_ws_text(changes.get("result_status"))
        if rs is None or rs not in {"tested", "skipped"}:
            return jsonify({"error": "result_status must be tested or skipped"}), 400
    if _normalize_ws_text(changes.get("result_status")) == "skipped":
        merged_skip = _normalize_ws_text(changes.get("skip_reason"))
        if merged_skip is None and row.skip_reason is None:
            return jsonify({"error": "skip_reason is required when result_status is skipped"}), 400

    actor_username = _session_username_clean()
    actor_name = actor_username
    source = _normalize_ws_text(payload.get("source")) or "technician_app"
    client_mutated_at = _parse_iso_dt(payload.get("client_mutated_at"))
    next_audit_id = _next_worksheet_audit_event_id()

    changed_any = False
    for field_name, attr_name in editable_location_fields.items():
        if field_name not in changes:
            continue
        old_val = getattr(loc, attr_name)
        new_val = _normalize_ws_text(changes.get(field_name))
        if old_val == new_val:
            continue
        setattr(loc, attr_name, new_val)
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=next_audit_id,
                monthly_route_id=route_id,
                location_id=location_id,
                history_row_id=row.id,
                month_date=month_first,
                field_name=field_name,
                old_value=old_val,
                new_value=new_val,
                source=source,
                changed_by_username=actor_username,
                changed_by_name=actor_name,
                client_mutation_id=client_mutation_id if len(changes) == 1 else None,
                changed_at_client=client_mutated_at,
            )
        )
        next_audit_id += 1
        changed_any = True

    for field_name, attr_name in editable_history_fields.items():
        if field_name not in changes:
            continue
        old_val = getattr(row, attr_name)
        if field_name == "result_status":
            new_val = _normalize_ws_text(changes.get(field_name))
        else:
            new_val = _normalize_ws_text(changes.get(field_name))
        if old_val == new_val:
            continue
        setattr(row, attr_name, new_val)
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=next_audit_id,
                monthly_route_id=route_id,
                location_id=location_id,
                history_row_id=row.id,
                month_date=month_first,
                field_name=field_name,
                old_value=old_val,
                new_value=new_val,
                source=source,
                changed_by_username=actor_username,
                changed_by_name=actor_name,
                client_mutation_id=client_mutation_id if len(changes) == 1 else None,
                changed_at_client=client_mutated_at,
            )
        )
        next_audit_id += 1
        changed_any = True

    # Enforce invariant after merged state updates.
    if (row.result_status or "").strip().lower() == "skipped" and not _normalize_ws_text(row.skip_reason):
        db.session.rollback()
        return jsonify({"error": "skip_reason is required when result_status is skipped"}), 400

    if (row.result_status or "").strip().lower() != "skipped":
        row.skip_reason = None

    if changed_any:
        db.session.commit()
    else:
        db.session.rollback()

    db.session.refresh(row)
    db.session.refresh(loc)
    return jsonify({"ok": True, "row": _worksheet_row_from_history(row, loc, route_id=route_id)})


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>/worksheet/rows/<int:location_id>/audit")
def get_monthly_route_worksheet_row_audit(route_id: int, location_id: int):
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400
    month_first = date(month_dt.year, month_dt.month, 1)
    rows = (
        MonthlyRouteWorksheetAuditEvent.query.filter_by(
            monthly_route_id=route_id,
            location_id=location_id,
            month_date=month_first,
        )
        .order_by(MonthlyRouteWorksheetAuditEvent.changed_at.desc())
        .all()
    )
    return jsonify(
        {
            "events": [
                {
                    "id": int(r.id),
                    "field_name": r.field_name,
                    "old_value": r.old_value,
                    "new_value": r.new_value,
                    "source": r.source,
                    "changed_by_username": r.changed_by_username,
                    "changed_by_name": r.changed_by_name,
                    "changed_at": r.changed_at.isoformat() if r.changed_at else None,
                }
                for r in rows
            ]
        }
    )


@monthly_routes_bp.put("/api/monthly_routes/routes/<int:route_id>/location_order")
def put_monthly_route_location_order(route_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"error": "Session username required"}), 401

    mr = _get_monthly_route(route_id)
    if mr is None:
        return jsonify({"error": "Route not found"}), 404

    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    raw_ids = payload.get("ordered_location_ids")
    if not isinstance(raw_ids, list):
        return jsonify({"error": "ordered_location_ids must be an array"}), 400

    ordered_ids: list[int] = []
    for item in raw_ids:
        try:
            ordered_ids.append(int(item))
        except (TypeError, ValueError):
            return jsonify({"error": "ordered_location_ids must contain integers"}), 400

    existing_rows = (
        MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id)
        .with_entities(MonthlyRouteLocation.id)
        .all()
    )
    existing_ids = {int(r[0]) for r in existing_rows}
    if not existing_ids:
        return jsonify({"error": "Route has no locations"}), 400
    if len(ordered_ids) != len(existing_ids) or set(ordered_ids) != existing_ids:
        return jsonify(
            {
                "error": "ordered_location_ids must list each location on this route exactly once",
            }
        ), 400

    for idx, lid in enumerate(ordered_ids):
        loc = db.session.get(MonthlyRouteLocation, lid)
        if loc is None or loc.monthly_route_id != route_id:
            db.session.rollback()
            return jsonify({"error": "Invalid location for this route"}), 400
        loc.route_stop_order = idx

    db.session.commit()

    route_locations = (
        MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id)
        .order_by(
            MonthlyRouteLocation.route_stop_order.asc().nulls_last(),
            MonthlyRouteLocation.address.asc(),
        )
        .all()
    )
    locations_payload = [_serialize_route_location_list_item(loc) for loc in route_locations]
    return jsonify({"locations": locations_payload})


@monthly_routes_bp.post("/api/monthly_routes/routes/<int:route_id>/comments")
def create_monthly_route_comment(route_id: int):
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    username = session.get("username")
    if not username:
        return jsonify({"error": "Session username required"}), 401

    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    body = _clean_text(payload.get("body"))
    if not body:
        return jsonify({"error": "body is required"}), 400

    row = MonthlyRouteComment(
        monthly_route_id=route_id,
        body=body,
        author_username=str(username).strip() or None,
    )
    db.session.add(row)
    db.session.commit()
    db.session.refresh(row)
    return jsonify({"comment": _serialize_monthly_route_comment(row)}), 201


@monthly_routes_bp.patch("/api/monthly_routes/routes/<int:route_id>/comments/<int:comment_id>")
def update_monthly_route_comment(route_id: int, comment_id: int):
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    row = MonthlyRouteComment.query.filter_by(
        id=comment_id, monthly_route_id=route_id
    ).one_or_none()
    if row is None:
        return jsonify({"error": "Comment not found"}), 404

    if not _comment_modify_allowed(row.author_username):
        return jsonify({"error": "You can only edit your own comments"}), 403

    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    body = _clean_text(payload.get("body"))
    if not body:
        return jsonify({"error": "body is required"}), 400

    row.body = body
    db.session.commit()
    db.session.refresh(row)
    return jsonify({"comment": _serialize_monthly_route_comment(row)})


@monthly_routes_bp.delete("/api/monthly_routes/routes/<int:route_id>/comments/<int:comment_id>")
def delete_monthly_route_comment(route_id: int, comment_id: int):
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    row = MonthlyRouteComment.query.filter_by(
        id=comment_id, monthly_route_id=route_id
    ).one_or_none()
    if row is None:
        return jsonify({"error": "Comment not found"}), 404

    if not _comment_modify_allowed(row.author_username):
        return jsonify({"error": "You can only delete your own comments"}), 403

    db.session.delete(row)
    db.session.commit()
    return ("", 204)


@monthly_routes_bp.post("/api/monthly_routes/library/<int:location_id>/comments")
def create_monthly_route_location_comment(location_id: int):
    loc = _get_monthly_location(location_id)
    if loc is None:
        return jsonify({"error": "Location not found"}), 404

    username = session.get("username")
    if not username:
        return jsonify({"error": "Session username required"}), 401

    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    body = _clean_text(payload.get("body"))
    if not body:
        return jsonify({"error": "body is required"}), 400

    row = MonthlyRouteLocationComment(
        location_id=location_id,
        body=body,
        author_username=str(username).strip() or None,
    )
    db.session.add(row)
    db.session.commit()
    db.session.refresh(row)
    return jsonify({"comment": _serialize_monthly_location_comment(row)}), 201


@monthly_routes_bp.patch("/api/monthly_routes/library/<int:location_id>/comments/<int:comment_id>")
def update_monthly_route_location_comment(location_id: int, comment_id: int):
    if _get_monthly_location(location_id) is None:
        return jsonify({"error": "Location not found"}), 404

    row = MonthlyRouteLocationComment.query.filter_by(id=comment_id, location_id=location_id).one_or_none()
    if row is None:
        return jsonify({"error": "Comment not found"}), 404

    if not _comment_modify_allowed(row.author_username):
        return jsonify({"error": "You can only edit your own comments"}), 403

    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    body = _clean_text(payload.get("body"))
    if not body:
        return jsonify({"error": "body is required"}), 400

    row.body = body
    db.session.commit()
    db.session.refresh(row)
    return jsonify({"comment": _serialize_monthly_location_comment(row)})


@monthly_routes_bp.delete("/api/monthly_routes/library/<int:location_id>/comments/<int:comment_id>")
def delete_monthly_route_location_comment(location_id: int, comment_id: int):
    if _get_monthly_location(location_id) is None:
        return jsonify({"error": "Location not found"}), 404

    row = MonthlyRouteLocationComment.query.filter_by(id=comment_id, location_id=location_id).one_or_none()
    if row is None:
        return jsonify({"error": "Comment not found"}), 404

    if not _comment_modify_allowed(row.author_username):
        return jsonify({"error": "You can only delete your own comments"}), 403

    db.session.delete(row)
    db.session.commit()
    return ("", 204)


@monthly_routes_bp.post("/api/monthly_routes/library")
def create_monthly_route_location():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    address = _clean_text(payload.get("address"))
    property_company = _clean_text(payload.get("property_management_company"))
    keys = _clean_text(payload.get("keys"))
    raw_status = _clean_text(payload.get("status_raw"))
    if raw_status is None:
        raw_status = _clean_text(payload.get("status_normalized"))

    if not address:
        return jsonify({"error": "address is required"}), 400
    if not property_company:
        return jsonify({"error": "property_management_company is required"}), 400
    if not raw_status:
        return jsonify({"error": "status_raw/status_normalized is required"}), 400

    normalized_status, canonical_raw_status = _normalize_status(raw_status)
    if normalized_status == "unknown":
        return jsonify({"error": "status must be one of active, cancelled, on_hold, waiting_keys"}), 400

    building = _clean_text(payload.get("building"))
    loc = MonthlyRouteLocation(
        address=address,
        address_normalized=address.casefold(),
        property_management_company=property_company,
        property_management_company_normalized=property_company.casefold(),
        building=building,
        building_normalized=(building or "").casefold(),
        notes=_clean_text(payload.get("notes")),
        barcode=_clean_text(payload.get("barcode")),
        area=_clean_text(payload.get("area")),
        status_normalized=normalized_status,
        status_raw=canonical_raw_status,
        keys=keys,
        test_day=_clean_text(payload.get("test_day")),
        annual_month=_clean_text(payload.get("annual_month")),
        display_address=_clean_text(payload.get("display_address")),
    )
    lat_raw = payload.get("latitude")
    lng_raw = payload.get("longitude")
    if lat_raw is not None and lng_raw is not None:
        try:
            lat_f = float(lat_raw)
            lng_f = float(lng_raw)
            if -90 <= lat_f <= 90 and -180 <= lng_f <= 180:
                loc.latitude = lat_f
                loc.longitude = lng_f
        except (TypeError, ValueError):
            pass
    if "price_per_month" in payload:
        loc.price_per_month = _parse_price(payload.get("price_per_month"))
    if "start_up_date" in payload:
        raw_start_up_date = _clean_text(payload.get("start_up_date"))
        loc.start_up_date = date.fromisoformat(raw_start_up_date) if raw_start_up_date else None

    db.session.add(loc)
    db.session.flush()

    if loc.latitude is None or loc.longitude is None:
        access_token = os.getenv("MAPBOX_ACCESS_TOKEN")
        if access_token:
            coords = _geocode_with_mapbox(_build_geocode_query(loc), access_token)
            if coords:
                loc.latitude, loc.longitude = coords

    try:
        sync_monthly_route_fk_for_location(loc)
        _sync_route_stop_order_after_fk_change(loc, None)
        if "key_id" in payload:
            raw_kid = payload.get("key_id")
            if raw_kid is None:
                loc.key_id = None
            else:
                try:
                    kid = int(raw_kid)
                except (TypeError, ValueError) as exc:
                    raise ValueError("key_id must be an integer or null") from exc
                if db.session.get(Key, kid) is None:
                    raise ValueError("key_id does not reference an existing key")
                loc.key_id = kid
        else:
            sync_key_fk_for_location(loc)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 400

    db.session.refresh(loc)
    return jsonify({"location": _serialize_location_row(loc, {})}), 201


@monthly_routes_bp.patch("/api/monthly_routes/library/<int:location_id>")
def update_monthly_route_location(location_id: int):
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    loc = _get_monthly_location(location_id)
    if loc is None:
        return jsonify({"error": "Location not found"}), 404

    try:
        if "address" in payload:
            value = _clean_text(payload.get("address"))
            if not value:
                raise ValueError("address is required")
            loc.address = value
            loc.address_normalized = value.casefold()
        if "property_management_company" in payload:
            value = _clean_text(payload.get("property_management_company"))
            loc.property_management_company = value
            loc.property_management_company_normalized = (value or "").casefold()
        if "building" in payload:
            value = _clean_text(payload.get("building"))
            loc.building = value
            loc.building_normalized = (value or "").casefold()
        if "notes" in payload:
            loc.notes = _clean_text(payload.get("notes"))
        if "price_per_month" in payload:
            loc.price_per_month = _parse_price(payload.get("price_per_month"))
        if "area" in payload:
            loc.area = _clean_text(payload.get("area"))
        if "start_up_date" in payload:
            raw = _clean_text(payload.get("start_up_date"))
            loc.start_up_date = date.fromisoformat(raw) if raw else None
        if "status_raw" in payload or "status_normalized" in payload:
            raw_status = _clean_text(payload.get("status_raw"))
            if raw_status is None:
                raw_status = _clean_text(payload.get("status_normalized"))
            normalized, status_raw = _normalize_status(raw_status)
            loc.status_normalized = normalized
            loc.status_raw = status_raw
        if "keys" in payload:
            loc.keys = _clean_text(payload.get("keys"))
        if "barcode" in payload:
            loc.barcode = _clean_text(payload.get("barcode"))
        if "key_id" in payload:
            raw_kid = payload.get("key_id")
            if raw_kid is None:
                loc.key_id = None
            else:
                try:
                    kid = int(raw_kid)
                except (TypeError, ValueError) as exc:
                    raise ValueError("key_id must be an integer or null") from exc
                if db.session.get(Key, kid) is None:
                    raise ValueError("key_id does not reference an existing key")
                loc.key_id = kid
        elif "keys" in payload or "barcode" in payload:
            sync_key_fk_for_location(loc)
        if "test_day" in payload:
            prev_mr_id = loc.monthly_route_id
            loc.test_day = _clean_text(payload.get("test_day"))
            sync_monthly_route_fk_for_location(loc)
            _sync_route_stop_order_after_fk_change(loc, prev_mr_id)
        if "annual_month" in payload:
            loc.annual_month = _clean_text(payload.get("annual_month"))

        months_payload = payload.get("months")
        if months_payload is not None:
            if not isinstance(months_payload, dict):
                raise ValueError("months must be an object keyed by YYYY-MM-DD")
            for month_key, month_value in months_payload.items():
                month_date = date.fromisoformat(str(month_key))
                if month_value in (None, ""):
                    MonthlyRouteTestHistory.query.filter_by(
                        location_id=location_id, month_date=month_date
                    ).delete()
                    continue
                if not isinstance(month_value, dict):
                    raise ValueError(f"months[{month_key}] must be an object or null")

                result_status = _clean_text(month_value.get("result_status"))
                skip_reason = _clean_text(month_value.get("skip_reason"))
                if result_status is None:
                    MonthlyRouteTestHistory.query.filter_by(
                        location_id=location_id, month_date=month_date
                    ).delete()
                    continue
                if result_status not in {"tested", "skipped"}:
                    raise ValueError(f"months[{month_key}].result_status must be tested or skipped")
                if result_status != "skipped":
                    skip_reason = None

                row = MonthlyRouteTestHistory.query.filter_by(
                    location_id=location_id, month_date=month_date
                ).one_or_none()
                if row is None:
                    row = MonthlyRouteTestHistory(
                        location_id=location_id,
                        month_date=month_date,
                        result_status=result_status,
                        skip_reason=skip_reason,
                        source_value_raw=None,
                        test_monthly_route_id=loc.monthly_route_id,
                    )
                    db.session.add(row)
                else:
                    row.result_status = result_status
                    row.skip_reason = skip_reason
                    row.test_monthly_route_id = loc.monthly_route_id

        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 400
    except Exception:
        db.session.rollback()
        raise

    if (
        "test_day" in payload
        or "keys" in payload
        or "barcode" in payload
        or "key_id" in payload
    ):
        db.session.refresh(loc)

    months_by_location = _months_payload_for_location(location_id)
    return jsonify({"location": _serialize_location_row(loc, months_by_location)})


@monthly_routes_bp.get("/api/monthly_routes/geocode_candidates")
def monthly_routes_geocode_candidates():
    q = (request.args.get("q") or "").strip()
    if len(q) < 3:
        return jsonify({"candidates": []})

    access_token = os.getenv("MAPBOX_ACCESS_TOKEN")
    if not access_token:
        return jsonify({"error": "MAPBOX_ACCESS_TOKEN is not configured"}), 503

    endpoint = "https://api.mapbox.com/geocoding/v5/mapbox.places/"
    url = (
        f"{endpoint}{url_parse.quote(q)}.json"
        f"?access_token={url_parse.quote(access_token)}"
        f"&limit=6&autocomplete=true&country=ca&types=address"
        f"&proximity={VICTORIA_PROXIMITY_LNG},{VICTORIA_PROXIMITY_LAT}"
        f"&bbox={VICTORIA_BBOX[0]},{VICTORIA_BBOX[1]},{VICTORIA_BBOX[2]},{VICTORIA_BBOX[3]}"
    )
    req = url_request.Request(url, headers={"User-Agent": "schedule-assist-monthly-routes/1.0"})
    try:
        with url_request.urlopen(req, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (url_error.URLError, TimeoutError, json.JSONDecodeError):
        return jsonify({"candidates": []})

    features = payload.get("features") if isinstance(payload, dict) else None
    if not isinstance(features, list):
        return jsonify({"candidates": []})

    candidates = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        candidate = _serialize_geocode_candidate(feature)
        if candidate:
            candidates.append(candidate)
    return jsonify({"candidates": candidates})


@monthly_routes_bp.patch("/api/monthly_routes/library/<int:location_id>/placement")
def update_monthly_route_placement(location_id: int):
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    loc = _get_monthly_location(location_id)
    if loc is None:
        return jsonify({"error": "Location not found"}), 404

    display_address = _clean_text(payload.get("display_address"))
    lat_raw = payload.get("latitude")
    lng_raw = payload.get("longitude")
    try:
        lat = float(lat_raw)
        lng = float(lng_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "latitude and longitude must be numbers"}), 400

    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return jsonify({"error": "Invalid coordinate range"}), 400
    if not _is_victoria_area(lat, lng):
        return jsonify({"error": "Coordinates must be within Greater Victoria bounds"}), 400

    loc.display_address = display_address
    loc.latitude = lat
    loc.longitude = lng
    db.session.commit()

    months_by_location = _months_payload_for_location(location_id)
    return jsonify({"location": _serialize_location_row(loc, months_by_location)})


@monthly_routes_bp.patch("/api/monthly_routes/library/<int:location_id>/assign_route")
def assign_monthly_route_location(location_id: int):
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    loc = _get_monthly_location(location_id)
    if loc is None:
        return jsonify({"error": "Location not found"}), 404

    route_value = _clean_text(payload.get("test_day"))
    if not route_value:
        return jsonify({"error": "test_day is required"}), 400

    prev_mr_id = loc.monthly_route_id
    loc.test_day = route_value
    try:
        sync_monthly_route_fk_for_location(loc)
        _sync_route_stop_order_after_fk_change(loc, prev_mr_id)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 400

    db.session.refresh(loc)

    months_by_location = _months_payload_for_location(location_id)
    return jsonify({"location": _serialize_location_row(loc, months_by_location)})


@monthly_routes_bp.delete("/api/monthly_routes/library/<int:location_id>")
def delete_monthly_route_location(location_id: int):
    loc = _get_monthly_location(location_id)
    if loc is None:
        return jsonify({"error": "Location not found"}), 404
    db.session.delete(loc)
    db.session.commit()
    return ("", 204)

