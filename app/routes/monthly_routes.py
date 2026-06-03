from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import os
from urllib import error as url_error, parse as url_parse, request as url_request
import json
import math
import time
from zoneinfo import ZoneInfo

from flask import Blueprint, Response, jsonify, request, session, stream_with_context
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import joinedload

from app.db_models import (
    Key,
    MonthlyRoute,
    MonthlyRouteComment,
    MonthlyRouteLocation,
    MonthlyRouteLocationComment,
    MonthlyRouteRun,
    MonthlyRouteSnapshot,
    MonthlyRouteSpecialistMonth,
    MonthlyRouteTestHistory,
    MonthlyRouteWorksheetAuditEvent,
    MonthlySite,
    db,
)
from app.monthly.key_resolve import sync_key_fk_for_location
from app.monthly.monthly_sites_sync import (
    push_legacy_keys_to_primary_testing_site,
    sync_testing_sites_from_legacy,
)
from app.monthly.route_inspection_csv_import import (
    parse_preamble_only,
    run_route_inspection_csv_import,
)
from app.monthly.route_sync import sync_monthly_route_fk_for_location
from app.monthly.runs import get_or_create_monthly_route_run
from app.monthly.mapbox_routes import (
    calculated_path_payload,
    invalidate_monthly_route_path,
)
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
    if not annual or annual == "to":
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


def _route_counts_for_location_query(location_query) -> dict[str, int]:
    """Aggregate ``test_day`` counts in SQL (same filters as ``location_query``, no row load)."""
    rows = (
        location_query.order_by(None)
        .with_entities(
            MonthlyRouteLocation.test_day,
            func.count(MonthlyRouteLocation.id),
        )
        .filter(
            MonthlyRouteLocation.test_day.isnot(None),
            MonthlyRouteLocation.test_day != "",
        )
        .group_by(MonthlyRouteLocation.test_day)
        .all()
    )
    counts: dict[str, int] = {}
    for test_day, n in rows:
        route = (test_day or "").strip()
        if route:
            counts[route] = int(n)
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
    wd_names = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
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
        MonthlyRouteTestHistory.query.options(
            joinedload(MonthlyRouteTestHistory.test_monthly_route),
            joinedload(MonthlyRouteTestHistory.run),
        )
        .filter_by(location_id=location_id)
        .order_by(MonthlyRouteTestHistory.month_date.asc())
        .all()
    )
    out: dict[str, dict[str, object]] = {}
    for row in history_rows:
        # Worksheet / run-details links require a real run file (``run_id``), not master-sheet ledger only.
        worksheet_route_id: int | None = None
        if row.run_id is not None:
            if row.run is not None:
                worksheet_route_id = int(row.run.monthly_route_id)
            elif row.test_monthly_route_id is not None:
                worksheet_route_id = int(row.test_monthly_route_id)
        out[row.month_date.isoformat()] = {
            "result_status": row.result_status,
            "skip_reason": row.skip_reason,
            "test_monthly_route": _serialize_monthly_route_entity(row.test_monthly_route),
            "worksheet_route_id": worksheet_route_id,
            "run_id": int(row.run_id) if row.run_id is not None else None,
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


def _history_row_is_preserved_annual_skip(row: MonthlyRouteTestHistory) -> bool:
    """Annual-classification skips keep outcome/times when resetting the run."""
    if (row.result_status or "").strip().lower() != "skipped":
        return False
    return _sheet_skip_reason_is_annual(row.skip_reason)


def _history_row_outcome_bucket(row: MonthlyRouteTestHistory) -> str | None:
    """Classify a sheet-history row for KPI counts; ``None`` = cleared / no outcome."""
    status = (row.result_status or "").strip().lower()
    if status == "skipped":
        if _sheet_skip_reason_is_annual(row.skip_reason):
            return "skipped_annual"
        return "skipped_non_annual"
    if status == "tested":
        return "tested"
    return None


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
        bucket = _history_row_outcome_bucket(row)
        if bucket == "skipped_annual":
            lid = int(row.location_id)
            base = _skip_site_base(loc_by_id.get(lid), lid)
            entry["skipped_annual_count"] += 1
            entry["skipped_annual_sites"].append(base)
        elif bucket == "skipped_non_annual":
            lid = int(row.location_id)
            base = _skip_site_base(loc_by_id.get(lid), lid)
            reason = (row.skip_reason or "").strip()
            entry["skipped_non_annual_count"] += 1
            entry["skipped_non_annual_sites"].append({**base, "skip_reason": reason or None})
        elif bucket == "tested":
            entry["sites_tested_count"] += 1
            lid = int(row.location_id)
            loc = loc_by_id.get(lid)
            if loc is not None and loc.price_per_month is not None:
                entry["tested_revenue_total"] += float(loc.price_per_month)
            else:
                entry["tested_sites_missing_price_count"] += 1

    for entry in by_month.values():
        na = entry["skipped_non_annual_sites"]
        na.sort(key=lambda s: (str(s["label"]).casefold(), int(s["id"])))
        ann = entry["skipped_annual_sites"]
        ann.sort(key=lambda s: (str(s["label"]).casefold(), int(s["id"])))

    return by_month


def _runs_by_month_for_route(route_id: int) -> dict[str, dict[str, object]]:
    """``MonthlyRouteRun`` rows keyed by ``YYYY-MM-01`` (CSV import, portal, or worksheet materialization)."""
    from app.monthly.run_workflow import derive_run_workflow_stage, workflow_stage_label

    rows = (
        MonthlyRouteRun.query.filter_by(monthly_route_id=route_id)
        .order_by(MonthlyRouteRun.month_date.asc())
        .all()
    )
    out: dict[str, dict[str, object]] = {}
    for run in rows:
        stage = derive_run_workflow_stage(run)
        out[run.month_date.isoformat()] = {
            "run_id": int(run.id),
            "source": run.source,
            "status": run.status,
            "opened_at": run.opened_at.isoformat() if run.opened_at else None,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "workflow_stage": stage,
            "workflow_stage_label": workflow_stage_label(stage),
        }
    return out


def _get_or_create_run(route_id: int, month_first: date) -> MonthlyRouteRun:
    """Worksheet-opening alias for :func:`get_or_create_monthly_route_run` (default ``technician_app`` source)."""
    return get_or_create_monthly_route_run(route_id, month_first, source="technician_app")


def _prior_history_by_location(
    location_ids: list[int], month_first: date
) -> dict[int, MonthlyRouteTestHistory]:
    """Most-recent ``MonthlyRouteTestHistory`` row per location strictly before ``month_first``.

    Used to forward-carry per-run snapshot fields (FACP, ring, key #, annual,
    procedures, tech notes) when materializing rows for a new month so the next
    run opens with the previous run's values.
    """
    if not location_ids:
        return {}
    rows = (
        db.session.query(MonthlyRouteTestHistory)
        .filter(
            MonthlyRouteTestHistory.location_id.in_(location_ids),
            MonthlyRouteTestHistory.month_date < month_first,
        )
        .order_by(
            MonthlyRouteTestHistory.location_id.asc(),
            MonthlyRouteTestHistory.month_date.desc(),
        )
        .all()
    )
    out: dict[int, MonthlyRouteTestHistory] = {}
    for r in rows:
        out.setdefault(int(r.location_id), r)
    return out


def _ensure_worksheet_rows_for_route_month(
    route_id: int,
    month_first: date,
    *,
    create_run_if_missing: bool = True,
) -> MonthlyRouteRun | None:
    """Materialize a ``MonthlyRouteTestHistory`` placeholder for every route location for ``month_first``.

    Called when a technician opens the worksheet so all stops on the route appear,
    not only those that already have a history row from a CSV import. New rows are
    created with ``result_status=NULL`` ("not yet tested") and snapshot fields
    forward-carried from the previous run (or the location's "library current"
    values for the very first run after migration), including
    ``session_route_stop_order`` when the prior month had sheet order. Editing
    flows update those snapshot fields later. Idempotent and safe to call repeatedly.

    When ``create_run_if_missing`` is ``False`` (PIN portal worksheet GET before a run
    exists), returns ``None`` if there is no ``MonthlyRouteRun`` row yet.

    Returns the ``MonthlyRouteRun`` for ``(route_id, month_first)`` so callers can
    surface run metadata in their payload.

    Non-current Pacific months never create runs or roster rows here; only the current
    month (or explicit portal ``POST …/runs``) materializes placeholders.
    """
    if _is_non_current_pacific_month(month_first):
        return MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id,
            month_date=month_first,
        ).one_or_none()

    if create_run_if_missing:
        run = _get_or_create_run(route_id, month_first)
    else:
        run = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id,
            month_date=month_first,
        ).one_or_none()
        if run is None:
            return None
    locs = (
        MonthlyRouteLocation.query.filter(
            MonthlyRouteLocation.monthly_route_id == route_id
        )
        .all()
    )
    if not locs:
        if run.opened_at is None:
            run.opened_at = datetime.now(PACIFIC_TZ)
            db.session.commit()
        return run
    loc_ids = [int(loc.id) for loc in locs]
    prior_by_loc = _prior_history_by_location(loc_ids, month_first)

    def _seed_for(loc: MonthlyRouteLocation) -> dict[str, object]:
        prior = prior_by_loc.get(int(loc.id))
        if prior is not None:
            return {
                "facp": prior.facp,
                "ring": prior.ring,
                "key_number": prior.key_number,
                "annual_month": prior.annual_month,
                "testing_procedures": prior.testing_procedures,
                "inspection_tech_notes": prior.inspection_tech_notes,
                "monitoring_notes": prior.monitoring_notes,
                "session_route_stop_order": prior.session_route_stop_order,
            }
        return {
            "facp": loc.facp_detail,
            "ring": loc.ring_detail,
            "key_number": loc.keys,
            "annual_month": loc.annual_month,
            "testing_procedures": loc.testing_procedures,
            "inspection_tech_notes": loc.inspection_tech_notes,
            "monitoring_notes": None,
            "session_route_stop_order": None,
        }

    seed_by_loc: dict[int, dict[str, object]] = {}
    payload = [
        {
            "location_id": int(loc.id),
            "month_date": month_first,
            "result_status": None,
            "test_monthly_route_id": route_id,
            "run_id": int(run.id),
            **seed_by_loc.setdefault(int(loc.id), _seed_for(loc)),
        }
        for loc in locs
    ]
    bind = db.session.get_bind()
    dialect_name = getattr(getattr(bind, "dialect", None), "name", "") or ""
    table = MonthlyRouteTestHistory.__table__
    if dialect_name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        stmt = pg_insert(table).values(payload).on_conflict_do_nothing(
            constraint="uq_monthly_route_test_history_location_month",
        )
        db.session.execute(stmt)
    else:
        # SQLite (test) and other dialects: select missing rows then bulk-insert with
        # pre-assigned IDs (BIGINT PK isn't reliably autoincremented on SQLite).
        existing = {
            int(lid)
            for (lid,) in db.session.query(MonthlyRouteTestHistory.location_id)
            .filter(
                MonthlyRouteTestHistory.month_date == month_first,
                MonthlyRouteTestHistory.location_id.in_([row["location_id"] for row in payload]),
            )
            .all()
        }
        missing = [row for row in payload if row["location_id"] not in existing]
        if missing:
            next_id = int(
                db.session.query(
                    func.coalesce(func.max(MonthlyRouteTestHistory.id), 0)
                ).scalar()
                or 0
            )
            for row in missing:
                next_id += 1
                row["id"] = next_id
            db.session.execute(table.insert(), missing)

    # Backfill run_id on any existing rows (e.g. from CSV import) that were
    # never linked to a run; idempotent and cheap.
    db.session.query(MonthlyRouteTestHistory).filter(
        MonthlyRouteTestHistory.month_date == month_first,
        MonthlyRouteTestHistory.location_id.in_(loc_ids),
        MonthlyRouteTestHistory.run_id.is_(None),
    ).update({MonthlyRouteTestHistory.run_id: run.id}, synchronize_session=False)

    # Legacy/imported rows for this month may already exist but have missing
    # snapshot fields. Hydrate only NULL fields from prior-run/library seed so
    # the worksheet opens with expected procedures/notes without overwriting
    # any technician-entered values.
    existing_rows = (
        MonthlyRouteTestHistory.query.filter(
            MonthlyRouteTestHistory.month_date == month_first,
            MonthlyRouteTestHistory.location_id.in_(loc_ids),
        ).all()
    )
    for row in existing_rows:
        seed = seed_by_loc.get(int(row.location_id))
        if not seed:
            continue
        for attr in (
            "facp",
            "ring",
            "key_number",
            "annual_month",
            "testing_procedures",
            "inspection_tech_notes",
            "monitoring_notes",
            "session_route_stop_order",
        ):
            if getattr(row, attr) is None and seed.get(attr) is not None:
                setattr(row, attr, seed.get(attr))

    if run.opened_at is None:
        run.opened_at = datetime.now(PACIFIC_TZ)
    db.session.commit()
    return run


def _is_latest_run_for_location(location_id: int, month_first: date) -> bool:
    """True iff ``month_first`` is at or after the most recent ``MonthlyRouteTestHistory.month_date`` for ``location_id``.

    Used by the worksheet PATCH path to decide whether to mirror snapshot edits
    onto ``MonthlyRouteLocation`` (the library "current" view). Edits to an older
    month must never overwrite the library current.
    """
    latest = (
        db.session.query(func.max(MonthlyRouteTestHistory.month_date))
        .filter(MonthlyRouteTestHistory.location_id == location_id)
        .execution_options(autoflush=False)
        .scalar()
    )
    return latest is None or month_first >= latest


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


def _worksheet_attributed_revision_token(route_id: int, month_first: date) -> str | None:
    """Stable fingerprint for worksheet rows attributed to ``route_id`` / ``month_first``.

    Aligns with ``_testing_history_rows_attributed_to_route_month`` (same merge scope as GET worksheet).
    ``None`` when the route does not exist.
    """
    if _get_monthly_route(route_id) is None:
        return None
    rows = _testing_history_rows_attributed_to_route_month(route_id, month_first)
    if not rows:
        return "none:0"
    max_ts: datetime | None = None
    for row in rows:
        u = row.updated_at
        if u is None:
            continue
        if max_ts is None or u > max_ts:
            max_ts = u
    ts_part = max_ts.isoformat() if max_ts is not None else "none"
    return f"{ts_part}:{len(rows)}"


# Sentinel revision for PIN portal worksheet SSE before ``MonthlyRouteRun`` exists (lazy preview).
_WORKSHEET_SSE_PORTAL_PREVIEW_TOKEN = "__worksheet_sse_portal_preview_no_run__"


def _worksheet_history_sort_key(
    hist: MonthlyRouteTestHistory,
    loc: MonthlyRouteLocation | None,
) -> tuple[int, int]:
    """Worksheet row order: per-run CSV ``#`` (``session_route_stop_order``) first, else library order."""
    if hist.session_route_stop_order is not None:
        return (0, int(hist.session_route_stop_order))
    if loc is not None and loc.route_stop_order is not None:
        return (1, int(loc.route_stop_order))
    return (2, 10**9)


def _worksheet_history_address_sort_key(
    hist: MonthlyRouteTestHistory,
    loc: MonthlyRouteLocation | None,
) -> str:
    if loc is not None:
        s = (loc.display_address or loc.address or "").strip()
        if s:
            return s.casefold()
    return f"location {int(hist.location_id)}".casefold()


def _session_stop_sheet_notes_from_history(
    row: MonthlyRouteTestHistory,
) -> tuple[str | None, str | None]:
    """Run-month procedures / tech notes from the history row only (no library bleed)."""
    from app.monthly.history_sheet_notes import sheet_notes_from_history_row

    return sheet_notes_from_history_row(row)


def _worksheet_preview_row_from_location(
    loc: MonthlyRouteLocation,
    month_first: date,
) -> dict[str, object]:
    """Read-only worksheet row shape before ``MonthlyRouteRun`` exists (portal preview)."""
    display_address = ((loc.display_address or loc.address or "").strip()) or f"Location {int(loc.id)}"
    monitoring_label: str | None = None
    if loc.monitoring_company is not None:
        monitoring_label = (loc.monitoring_company.name or "").strip() or None
    library_order = (
        int(loc.route_stop_order) if loc.route_stop_order is not None else None
    )
    from app.monthly.history_sheet_notes import latest_run_notes_for_location

    tp, tn = latest_run_notes_for_location(int(loc.id))
    return {
        "location_id": int(loc.id),
        "history_row_id": 0,
        "month_date": month_first.isoformat(),
        "display_address": display_address,
        "building": (loc.building or "").strip() or None,
        "property_management_company": ((loc.property_management_company or "").strip() or None),
        "annual_month": loc.annual_month,
        "ring": loc.ring_detail,
        "key_number": loc.keys,
        "facp": loc.facp_detail,
        "monitoring": monitoring_label,
        "result_status": None,
        "skip_reason": None,
        "testing_procedures": tp,
        "inspection_tech_notes": tn,
        "time_in": None,
        "time_out": None,
        "route_stop_order": library_order,
        "session_route_stop_order": None,
        "version_updated_at": None,
    }


def _portal_worksheet_preview_payload(
    mr: MonthlyRoute,
    route_id: int,
    month_first: date,
) -> dict[str, object]:
    """Portal worksheet view before ``POST …/runs`` — same row shape, ``run``: null, no DB writes."""
    from app.monthly.worksheet_stops import portal_worksheet_preview_stops

    locs = (
        MonthlyRouteLocation.query.options(joinedload(MonthlyRouteLocation.monitoring_company))
        .filter(MonthlyRouteLocation.monthly_route_id == route_id)
        .all()
    )

    def _loc_sort_key(loc: MonthlyRouteLocation) -> tuple[int, int]:
        ro = loc.route_stop_order
        return (0, int(ro)) if ro is not None else (1, 10**9)

    locs_sorted = sorted(locs, key=_loc_sort_key)
    rows = [_worksheet_preview_row_from_location(loc, month_first) for loc in locs_sorted]
    location_count = len(locs)
    return {
        "route": _serialize_monthly_route_entity(mr, location_count=location_count),
        "month_date": month_first.isoformat(),
        "run": None,
        "rows": rows,
        "stops": portal_worksheet_preview_stops(route_id, month_first),
    }


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
    snap = (row.monitoring_notes or "").strip() or None
    if snap:
        monitoring_label = snap
    elif loc is not None and loc.monitoring_company is not None:
        monitoring_label = (loc.monitoring_company.name or "").strip() or None
    library_order = (
        int(loc.route_stop_order)
        if loc is not None and loc.route_stop_order is not None
        else None
    )
    sess = row.session_route_stop_order
    session_order = int(sess) if sess is not None else None
    return {
        "location_id": int(row.location_id),
        "history_row_id": int(row.id),
        "month_date": row.month_date.isoformat(),
        "display_address": display_address,
        "building": (loc.building or "").strip() if loc else None,
        "property_management_company": (loc.property_management_company or "").strip() if loc else None,
        # Run-scoped snapshot fields: read only from the history row so old months
        # never bleed in current "library" values.
        "annual_month": row.annual_month,
        "ring": row.ring,
        "key_number": row.key_number,
        "facp": row.facp,
        "monitoring": monitoring_label,
        "result_status": row.result_status,
        "skip_reason": row.skip_reason,
        "testing_procedures": row.testing_procedures,
        "inspection_tech_notes": row.inspection_tech_notes,
        "time_in": row.sheet_time_in_raw,
        "time_out": row.sheet_time_out_raw,
        #: Library template order (``MonthlyRouteLocation.route_stop_order``).
        "route_stop_order": library_order,
        #: Per-run order from sheet ``#`` (CSV import); drives worksheet sort when set.
        "session_route_stop_order": session_order,
        "version_updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _current_pacific_month_first() -> date:
    now_pacific = datetime.now(PACIFIC_TZ)
    return date(now_pacific.year, now_pacific.month, 1)


def _is_non_current_pacific_month(month_first: date) -> bool:
    """True when ``month_first`` is not the Pacific calendar current month (past or future)."""
    return month_first != _current_pacific_month_first()


def _run_explicitly_completed(run: MonthlyRouteRun) -> bool:
    """True when the run was marked finished (blocks replacing the month via CSV import)."""
    from app.monthly.run_workflow import run_explicitly_completed

    return run_explicitly_completed(run)


def _run_field_in_progress(run: MonthlyRouteRun) -> bool:
    """Field technicians are actively logging (started, not field-ended, not office-closed)."""
    from app.monthly.run_workflow import run_field_in_progress

    return run_field_in_progress(run)


def _tech_portal_worksheet_request() -> bool:
    """True when the worksheet read is for the field technician portal (not office staff browse)."""
    if not session.get("tech_portal_unlocked"):
        return False
    if session.get("authenticated"):
        return (request.args.get("tech_portal") or "").strip() == "1"
    return True


def _tech_portal_patch_request() -> bool:
    return (request.args.get("tech_portal") or "").strip() == "1"


def _office_staff_worksheet_patch() -> bool:
    """Authenticated office browser PATCH (not technician portal worksheet)."""
    return bool(session.get("authenticated")) and not _tech_portal_patch_request()


def _portal_current_month_materialize_on_read(month_first: date) -> bool:
    """PIN/portal opening the Pacific current month gets a run file without ``Start Run``."""
    return _tech_portal_worksheet_request() and month_first == _current_pacific_month_first()


def _reject_patch_if_portal_run_completed(
    run: MonthlyRouteRun | None,
) -> tuple[object, int] | None:
    """Block all technician-portal worksheet edits once office has completed the run."""
    if run is None or not _tech_portal_patch_request():
        return None
    if not _run_explicitly_completed(run):
        return None
    return (
        jsonify(
            {
                "error": "This run is completed. Ask the office to reopen the job before making changes.",
                "code": "run_completed_locked",
            }
        ),
        409,
    )


def _reject_if_future_month_prep_blocked(
    route_id: int,
    month_first: date,
) -> tuple[object, int] | None:
    """Office cannot prep a future month until the Pacific current month run is closed."""
    from app.monthly.run_workflow import office_future_month_prep_blocked_reason

    blocked = office_future_month_prep_blocked_reason(route_id, month_first)
    if blocked is None:
        return None
    message, code = blocked
    return jsonify({"error": message, "code": code}), 409


def _reject_patch_if_portal_field_ended(
    run: MonthlyRouteRun | None,
) -> tuple[object, int] | None:
    """Block portal edits after technicians end the field phase (reopen field to continue)."""
    if run is None or not _tech_portal_patch_request():
        return None
    if _run_explicitly_completed(run):
        return None
    if run.field_ended_at is None:
        return None
    return (
        jsonify(
            {
                "error": (
                    "Field work is finished for this run. Use Reopen run on the route "
                    "page to continue testing, or ask the office if you need changes."
                ),
                "code": "field_ended_locked",
            }
        ),
        409,
    )


def _reject_if_portal_read_only(run: MonthlyRouteRun | None) -> tuple[object, int] | None:
    from app.monthly.portal_workflow import portal_run_is_read_only

    if run is None or not _tech_portal_patch_request():
        return None
    if not portal_run_is_read_only(run):
        return None
    return (
        jsonify(
            {
                "error": "This run was imported from a spreadsheet and cannot be edited in the portal.",
                "code": "portal_read_only",
            }
        ),
        409,
    )


def _portal_workflow_stop_context(route_id: int, testing_site_id: int, month_first: date):
    """Shared load/lock checks for portal workflow stop endpoints."""
    from app.monthly.worksheet_stops import (
        ensure_worksheet_stops_for_route_month,
        load_stop_for_patch,
        serialize_worksheet_stop,
        worksheet_stop_number_for_site,
    )

    run_for_month = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()

    mtsm, ts, loc = load_stop_for_patch(route_id, testing_site_id, month_first)
    if ts is None or loc is None:
        return None, (jsonify({"error": "Testing site not found"}), 404)
    if mtsm is None and run_for_month is not None and _tech_portal_patch_request():
        ensure_worksheet_stops_for_route_month(route_id, month_first, run_for_month)
        db.session.flush()
        mtsm, ts, loc = load_stop_for_patch(route_id, testing_site_id, month_first)
    if mtsm is None:
        return None, (jsonify({"error": "Worksheet stop not found for testing site/month"}), 404)
    if mtsm.test_monthly_route_id is not None and int(mtsm.test_monthly_route_id) != int(route_id):
        return None, (jsonify({"error": "Worksheet stop does not belong to this route"}), 404)

    for block in (
        _reject_if_portal_read_only(run_for_month),
        _reject_patch_if_portal_run_completed(run_for_month),
        _reject_patch_if_portal_field_ended(run_for_month),
    ):
        if block is not None:
            return None, block

    def _stop_payload() -> dict[str, object]:
        stop_num = worksheet_stop_number_for_site(route_id, month_first, testing_site_id)
        return serialize_worksheet_stop(
            ts,
            loc,
            mtsm,
            route_id=route_id,
            month_first=month_first,
            stop_number=stop_num,
            run=run_for_month,
        )

    return {
        "run": run_for_month,
        "mtsm": mtsm,
        "ts": ts,
        "loc": loc,
        "route_id": route_id,
        "month_first": month_first,
        "stop_payload": _stop_payload,
    }, None


def _serialize_run(run: MonthlyRouteRun | None) -> dict[str, object] | None:
    """Frontend payload for a ``MonthlyRouteRun`` (the "run file" header).

    ``opened_at`` is when the run file / worksheet rows first existed (materialization).
    ``started_at`` is when field technicians explicitly started the run (portal Start Run).
    ``completed_at`` is when the run was marked finished.

    ``is_historical`` flips the worksheet into a read-only-ish surface (no
    Time In / Time Out / Skip / Clear / Add Deficiency buttons). It is true when
    the run is explicitly finished (``completed`` / ``closed`` status or ``completed_at``)
    or its month is strictly before the current Pacific month.
    """
    if run is None:
        return None
    from app.monthly.run_workflow import serialize_run_workflow_fields

    is_historical = (
        _run_explicitly_completed(run)
        or run.month_date < _current_pacific_month_first()
    )
    base: dict[str, object] = {
        "id": int(run.id),
        "monthly_route_id": int(run.monthly_route_id),
        "month_date": run.month_date.isoformat(),
        "status": run.status,
        "opened_at": run.opened_at.isoformat() if run.opened_at else None,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "source": run.source,
        "is_historical": bool(is_historical),
        "pre_run_message": _normalize_ws_text(run.pre_run_message),
    }
    base.update(serialize_run_workflow_fields(run))
    return base


def _worksheet_payload_from_attributed_rows(
    mr: MonthlyRoute,
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun | None,
    rows: list[MonthlyRouteTestHistory],
) -> dict[str, object]:
    """Build worksheet JSON from attributed history only (no roster materialization)."""
    location_count = MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id).count()
    run_block = _serialize_run(run)
    if not rows:
        return _attach_worksheet_stops(
            {
                "route": _serialize_monthly_route_entity(mr, location_count=location_count),
                "month_date": month_first.isoformat(),
                "run": run_block,
                "rows": [],
            },
            route_id,
            month_first,
        )
    loc_by_id = {
        loc.id: loc
        for loc in MonthlyRouteLocation.query.options(joinedload(MonthlyRouteLocation.monitoring_company))
        .filter(MonthlyRouteLocation.id.in_({int(r.location_id) for r in rows}))
        .all()
    }

    def _worksheet_row_sort_tuple(hist: MonthlyRouteTestHistory) -> tuple[int, int, str]:
        loc = loc_by_id.get(int(hist.location_id))
        tier, ord_ = _worksheet_history_sort_key(hist, loc)
        addr = _worksheet_history_address_sort_key(hist, loc)
        return (tier, ord_, addr)

    rows_sorted = sorted(rows, key=_worksheet_row_sort_tuple)
    out_rows = [
        _worksheet_row_from_history(r, loc_by_id.get(int(r.location_id)), route_id=route_id)
        for r in rows_sorted
    ]
    return _attach_worksheet_stops(
        {
            "route": _serialize_monthly_route_entity(mr, location_count=location_count),
            "month_date": month_first.isoformat(),
            "run": run_block,
            "rows": out_rows,
        },
        route_id,
        month_first,
    )


def _serialize_technician_worksheet_payload(
    route_id: int,
    month_first: date,
    *,
    portal_lazy_run: bool = False,
) -> dict[str, object] | None:
    mr = _get_monthly_route(route_id)
    if mr is None:
        return None

    if _is_non_current_pacific_month(month_first):
        run = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id,
            month_date=month_first,
        ).one_or_none()
        rows = _testing_history_rows_attributed_to_route_month(route_id, month_first)
        if run is None and not rows:
            location_count = MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id).count()
            return _attach_worksheet_stops(
                {
                    "route": _serialize_monthly_route_entity(mr, location_count=location_count),
                    "month_date": month_first.isoformat(),
                    "run": None,
                    "rows": [],
                },
                route_id,
                month_first,
            )
        return _worksheet_payload_from_attributed_rows(mr, route_id, month_first, run, rows)

    run = _ensure_worksheet_rows_for_route_month(
        route_id,
        month_first,
        create_run_if_missing=not portal_lazy_run,
    )
    if run is None:
        if portal_lazy_run:
            return _portal_worksheet_preview_payload(mr, route_id, month_first)
        return None
    rows = _testing_history_rows_attributed_to_route_month(route_id, month_first)
    return _worksheet_payload_from_attributed_rows(mr, route_id, month_first, run, rows)


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


def _worksheet_row_open_clock_in(hist: MonthlyRouteTestHistory) -> bool:
    """Technician has Time In set, no Time Out, and outcome is not tested/skipped."""
    from app.monthly.sheet_visit_times import looks_like_sheet_clock

    rs = (hist.result_status or "").strip().lower()
    if rs in ("tested", "skipped"):
        return False
    tin = _normalize_ws_text(hist.sheet_time_in_raw)
    tout = _normalize_ws_text(hist.sheet_time_out_raw)
    if not tin or tout:
        return False
    return looks_like_sheet_clock(tin)


def _patch_will_start_open_clock_in(
    row: MonthlyRouteTestHistory,
    changes_eff: dict[str, object],
) -> bool:
    """True when this patch starts (or moves) an open clock-in on ``row``."""
    from app.monthly.sheet_visit_times import looks_like_sheet_clock

    if "time_in" not in changes_eff:
        return False
    tin = _normalize_ws_text(changes_eff.get("time_in"))
    if not tin or not looks_like_sheet_clock(tin):
        return False
    if _worksheet_row_open_clock_in(row):
        return False
    tout = (
        _normalize_ws_text(changes_eff.get("time_out"))
        if "time_out" in changes_eff
        else _normalize_ws_text(row.sheet_time_out_raw)
    )
    if tout:
        return False
    rs = (
        _normalize_ws_text(changes_eff.get("result_status"))
        if "result_status" in changes_eff
        else _normalize_ws_text(row.result_status)
    )
    if (rs or "").lower() == "skipped":
        return False
    return True


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
        bucket = _history_row_outcome_bucket(row)
        if bucket == "skipped_annual":
            skipped_ann_ct += 1
        elif bucket == "skipped_non_annual":
            skipped_na_ct += 1
        elif bucket == "tested":
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

        tp, tn = _session_stop_sheet_notes_from_history(row)
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
    monthly_site = loc.monthly_site
    testing_sites = []
    if monthly_site is not None:
        testing_sites = sorted(
            monthly_site.testing_sites,
            key=lambda ts: (int(ts.sort_order), int(ts.id)),
        )
    return {
        "id": loc.id,
        "address": loc.address,
        "display_address": loc.display_address,
        "building": loc.building,
        "status_normalized": loc.status_normalized,
        "annual_month": loc.annual_month,
        "latitude": float(loc.latitude) if loc.latitude is not None else None,
        "longitude": float(loc.longitude) if loc.longitude is not None else None,
        "route_stop_order": loc.route_stop_order,
        "monthly_route_id": loc.monthly_route_id,
        "testing_sites": [
            {
                "id": int(ts.id),
                "sort_order": int(ts.sort_order),
                "label": ts.label,
                "annual_month": ts.annual_month,
            }
            for ts in testing_sites
        ],
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


def _serialize_month_cell(
    row: MonthlyRouteTestHistory,
    *,
    list_view: bool,
) -> dict[str, object]:
    cell: dict[str, object] = {
        "result_status": row.result_status,
        "skip_reason": row.skip_reason,
    }
    if not list_view:
        cell["test_monthly_route"] = _serialize_monthly_route_entity(row.test_monthly_route)
    return cell


def _serialize_location_row(
    loc: MonthlyRouteLocation,
    months_payload: dict[str, dict[str, object]],
    *,
    list_view: bool = False,
) -> dict[str, object]:
    mr = loc.monthly_route
    lk = loc.linked_key
    payload: dict[str, object] = {
        "id": loc.id,
        "address": loc.address,
        "display_address": loc.display_address,
        "property_management_company": loc.property_management_company,
        "building": loc.building,
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
    if list_view:
        return payload

    from app.monthly.history_sheet_notes import apply_latest_run_notes_to_location_payload

    payload["notes"] = loc.notes
    payload["ring_detail"] = loc.ring_detail
    payload["facp_detail"] = loc.facp_detail
    payload["testing_procedures"] = loc.testing_procedures
    payload["inspection_tech_notes"] = loc.inspection_tech_notes
    apply_latest_run_notes_to_location_payload(payload, int(loc.id))
    return payload


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
def monthly_routes_library(*, list_view: bool | None = None):
    if list_view is None:
        list_view = (request.args.get("view") or "").strip().lower() == "list"
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
            total_locations = len(locations)
            page = 1
            total_pages = 1
        else:
            total_locations = ordered_location_query.count()
            total_pages = max((total_locations + page_size - 1) // page_size, 1)
            if page > total_pages:
                page = total_pages
            locations = ordered_location_query.offset((page - 1) * page_size).limit(page_size).all()

    if special_library_filters:
        route_counts = _build_route_counts(filtered_locations)
    else:
        route_counts = _route_counts_for_location_query(location_query)
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

    hist_query = MonthlyRouteTestHistory.query.filter(MonthlyRouteTestHistory.location_id.in_(location_ids))
    if not list_view:
        hist_query = hist_query.options(joinedload(MonthlyRouteTestHistory.test_monthly_route))
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
        by_location.setdefault(row.location_id, {})[row.month_date.isoformat()] = _serialize_month_cell(
            row,
            list_view=list_view,
        )

    rows_payload = []
    for loc in locations:
        rows_payload.append(
            _serialize_location_row(loc, by_location.get(loc.id, {}), list_view=list_view)
        )

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


@monthly_routes_bp.get("/api/monthly_routes/routes")
def list_monthly_routes():
    """Route list for the office routes landing page."""
    route_rows = MonthlyRoute.query.order_by(MonthlyRoute.route_number.asc()).all()
    if not route_rows:
        return jsonify({"routes": []})

    count_rows = (
        db.session.query(
            MonthlyRouteLocation.monthly_route_id,
            func.count(MonthlyRouteLocation.id),
        )
        .filter(
            MonthlyRouteLocation.monthly_route_id.isnot(None),
            MonthlyRouteLocation.status_normalized == "active",
        )
        .group_by(MonthlyRouteLocation.monthly_route_id)
        .all()
    )
    count_map: dict[int, int] = {int(mid): int(n) for mid, n in count_rows if mid is not None}

    out: list[dict[str, object]] = []
    for route in route_rows:
        active_count = count_map.get(int(route.id), 0)
        if active_count < 1:
            continue
        out.append(
            {
                "route": _serialize_monthly_route_entity(
                    route,
                    location_count=active_count,
                ),
            }
        )

    return jsonify({"routes": out})


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
    runs_by_month = _runs_by_month_for_route(route_id)

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
        MonthlyRouteLocation.query.options(
            joinedload(MonthlyRouteLocation.monthly_site).selectinload(MonthlySite.testing_sites)
        )
        .filter_by(monthly_route_id=route_id)
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
            "runs_by_month": runs_by_month,
            "specialists": specialists_payload,
            "specialists_by_month": specialists_by_month,
        }
    )


def _run_details_counts_for_month(route_id: int, month_first: date) -> dict[str, int]:
    """Outcome counts from route worksheet stops (annual month on site, unless tested)."""
    from app.monthly.run_details_review import run_details_counts_from_stop_months

    return run_details_counts_from_stop_months(route_id, month_first)


def _location_display_label(loc: MonthlyRouteLocation | None, location_id: int) -> str:
    if loc is None:
        return f"Location {location_id}"
    s = (loc.display_address or loc.address or "").strip()
    return s or f"Location {location_id}"


def _location_address_building_label(
    display_address: str,
    building: str | None,
    *,
    fallback: str,
) -> str:
    addr = display_address.strip()
    b = (building or "").strip()
    if addr and b:
        return f"{addr} · {b}"
    return addr or b or fallback


# Aliased audit ``field_name`` values collapsed for run-details display (oldest old, newest new).


def _collapse_worksheet_audit_changes_for_display(
    changes: list[dict[str, object]],
) -> list[dict[str, object]]:
    from app.monthly.run_details_review import collapse_worksheet_audit_changes_for_display

    return collapse_worksheet_audit_changes_for_display(changes)


def _field_submission_meta(run: MonthlyRouteRun | None) -> dict[str, object]:
    if run is None:
        return {"available": False, "captured_at": None, "field_work_reopened": False}
    from app.monthly.field_submission import get_field_submission_for_run

    submission = get_field_submission_for_run(int(run.id))
    if submission is None:
        return {"available": False, "captured_at": None, "field_work_reopened": False}
    return {
        "available": True,
        "captured_at": submission.captured_at.isoformat() if submission.captured_at else None,
        "field_work_reopened": run.field_ended_at is None,
    }


def _serialize_monthly_run_details_payload(
    route_id: int, month_first: date
) -> dict[str, object] | None:
    """Office run summary: header, KPI counts, billing, review metadata (no per-site audit)."""
    from app.monthly.run_details_review import (
        run_details_billing_locations,
        run_details_review_meta,
    )

    mr = _get_monthly_route(route_id)
    if mr is None:
        return None

    location_count = MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id).count()
    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()

    specialists_month: dict[str, object] | None = None
    from sqlalchemy import inspect as sa_inspect

    if sa_inspect(db.engine).has_table("monthly_route_specialist_month"):
        spec_row = MonthlyRouteSpecialistMonth.query.filter_by(
            monthly_route_id=route_id,
            month_first=month_first,
        ).one_or_none()
        if spec_row is not None:
            specialists_month = {
                "top_technicians": spec_row.top_technicians or [],
                "completed_jobs_attributed": spec_row.completed_jobs_attributed,
                "route_tested_on": spec_row.route_tested_on.isoformat() if spec_row.route_tested_on else None,
                "last_updated_at": spec_row.last_updated_at.isoformat() if spec_row.last_updated_at else None,
            }

    from app.monthly.run_details_review import run_details_base_payload_extras

    counts, billing_locations, review_meta, locations, review_summary = run_details_base_payload_extras(
        route_id, month_first, run=run
    )

    return {
        "route": _serialize_monthly_route_entity(mr, location_count=location_count),
        "month_date": month_first.isoformat(),
        "run": _serialize_run(run),
        "field_submission": _field_submission_meta(run),
        "counts": counts,
        "specialists_month": specialists_month,
        "billing_locations": billing_locations,
        "review_meta": review_meta,
        "locations": locations,
        "review_summary": review_summary,
    }


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>/run_details")
def get_monthly_route_run_details(route_id: int):
    """Office run summary for one sheet month (read-only; does not materialize worksheet rows)."""
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400

    month_first = date(month_dt.year, month_dt.month, 1)
    payload = _serialize_monthly_run_details_payload(route_id, month_first)
    if payload is None:
        return jsonify({"error": "Route not found"}), 404
    return jsonify(payload)


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>/run_details/field_submission")
def get_monthly_route_field_submission(route_id: int):
    """Frozen technician worksheet at the latest portal field end."""
    month_first = _parse_run_details_month_arg()
    if month_first is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404
    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is None:
        return _run_details_run_not_found_response()
    from app.monthly.field_submission import (
        ensure_field_submission_for_run,
        get_field_submission_for_run,
        serialize_field_submission_payload,
    )

    had_submission = get_field_submission_for_run(int(run.id)) is not None
    submission = ensure_field_submission_for_run(run)
    if submission is not None and not had_submission:
        db.session.commit()
    payload = serialize_field_submission_payload(run, submission, month_first=month_first)
    if payload is None:
        return jsonify({"error": "No field submission for this run yet.", "code": "no_submission"}), 404
    return jsonify(payload)


@monthly_routes_bp.get(
    "/api/monthly_routes/routes/<int:route_id>/locations/<int:location_id>/tickets"
)
def get_monthly_location_tickets(route_id: int, location_id: int):
    """List tickets for a billing location."""
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404
    loc = MonthlyRouteLocation.query.filter_by(id=location_id, monthly_route_id=route_id).one_or_none()
    if loc is None:
        return jsonify({"error": "Location not found on this route"}), 404
    from app.monthly.location_tickets import list_tickets_for_location

    return jsonify({"location_id": location_id, "tickets": list_tickets_for_location(location_id)})


@monthly_routes_bp.post(
    "/api/monthly_routes/routes/<int:route_id>/locations/<int:location_id>/tickets"
)
def post_monthly_location_ticket(route_id: int, location_id: int):
    """Create a ticket for a billing location."""
    username = session.get("username")
    if not username:
        return jsonify({"error": "Session username required"}), 401
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404
    loc = MonthlyRouteLocation.query.filter_by(id=location_id, monthly_route_id=route_id).one_or_none()
    if loc is None:
        return jsonify({"error": "Location not found on this route"}), 404
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title is required"}), 400
    month_first = _parse_month(data.get("month_date"))
    month_date = date(month_first.year, month_first.month, 1) if month_first else None
    run = None
    if month_date is not None:
        run = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id,
            month_date=month_date,
        ).one_or_none()
    from app.monthly.location_tickets import create_location_ticket, serialize_ticket

    try:
        ticket = create_location_ticket(
            location_id,
            title=title,
            body=data.get("body"),
            username=str(username),
            run=run,
            month_first=month_date,
        )
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        if str(exc) == "location_not_found":
            return jsonify({"error": "Location not found"}), 404
        raise
    return jsonify({"ok": True, "ticket": serialize_ticket(ticket)}), 201


@monthly_routes_bp.patch("/api/monthly_routes/tickets/<int:ticket_id>")
def patch_monthly_location_ticket(ticket_id: int):
    """Update ticket status, title, or body."""
    username = session.get("username")
    if not username:
        return jsonify({"error": "Session username required"}), 401
    from app.db_models import MonthlyLocationTicket
    from app.monthly.location_tickets import serialize_ticket, update_location_ticket

    ticket = db.session.get(MonthlyLocationTicket, ticket_id)
    if ticket is None:
        return jsonify({"error": "Ticket not found"}), 404
    data = request.get_json(silent=True) or {}
    try:
        update_location_ticket(
            ticket,
            username=str(username),
            status=data.get("status"),
            title=data.get("title"),
            body=data.get("body"),
            note=data.get("note"),
        )
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        if str(exc) == "invalid_status":
            return jsonify({"error": "Invalid ticket status", "code": "invalid_status"}), 400
        raise
    return jsonify({"ok": True, "ticket": serialize_ticket(ticket)})


@monthly_routes_bp.get("/api/monthly_routes/tickets/<int:ticket_id>/events")
def get_monthly_location_ticket_events(ticket_id: int):
    from app.db_models import MonthlyLocationTicket
    from app.monthly.location_tickets import ticket_events_for_ticket

    ticket = db.session.get(MonthlyLocationTicket, ticket_id)
    if ticket is None:
        return jsonify({"error": "Ticket not found"}), 404
    return jsonify({"ticket_id": ticket_id, "events": ticket_events_for_ticket(ticket_id)})


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>/run_job_items")
def get_monthly_run_job_items(route_id: int):
    month_first = _parse_run_details_month_arg()
    if month_first is None:
        return jsonify({"error": "Invalid or missing month query param"}), 400
    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is None:
        return _run_details_run_not_found_response()
    from app.db_models import MonthlyRunJobItem

    rows = (
        MonthlyRunJobItem.query.filter_by(run_id=int(run.id))
        .order_by(MonthlyRunJobItem.recorded_at.asc(), MonthlyRunJobItem.id.asc())
        .all()
    )
    items = [
        {
            "id": int(r.id),
            "run_id": int(r.run_id),
            "location_id": int(r.monthly_route_location_id),
            "testing_site_id": int(r.monthly_testing_site_id)
            if r.monthly_testing_site_id is not None
            else None,
            "description": r.description,
            "quantity": float(r.quantity) if r.quantity is not None else 1,
            "recorded_by": r.recorded_by,
            "recorded_at": r.recorded_at.isoformat() if r.recorded_at else None,
        }
        for r in rows
    ]
    return jsonify({"run_id": int(run.id), "month_date": month_first.isoformat(), "items": items})


@monthly_routes_bp.post(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/job_items"
)
def post_monthly_run_job_item(route_id: int, testing_site_id: int):
    """Log a replace/add item during field work (portal or office)."""
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return jsonify({"error": "Invalid or missing month query param"}), 400
    month_first = date(month_dt.year, month_dt.month, 1)
    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is None:
        return jsonify({"error": "No run for this month"}), 404
    from app.monthly.run_workflow import portal_may_edit_run

    if not portal_may_edit_run(run) and not _office_staff_worksheet_patch():
        return jsonify({"error": "Run is not open for field edits", "code": "run_locked"}), 409
    data = request.get_json(silent=True) or {}
    description = (data.get("description") or "").strip()
    if not description:
        return jsonify({"error": "description is required"}), 400
    from app.db_models import MonthlyRunJobItem, MonthlySite, MonthlyTestingSite

    ts = db.session.get(MonthlyTestingSite, testing_site_id)
    if ts is None:
        return jsonify({"error": "Testing site not found"}), 404
    site = db.session.get(MonthlySite, int(ts.monthly_site_id))
    if site is None or site.legacy_monthly_route_location_id is None:
        return jsonify({"error": "Location not found for stop"}), 404
    loc_id = int(site.legacy_monthly_route_location_id)
    qty_raw = data.get("quantity", 1)
    try:
        quantity = float(qty_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "quantity must be a number"}), 400
    recorded_by = (
        session.get("portal_tech_name")
        or session.get("username")
        or "unknown"
    )
    item = MonthlyRunJobItem(
        run_id=int(run.id),
        monthly_route_location_id=loc_id,
        monthly_testing_site_id=int(testing_site_id),
        description=description,
        quantity=quantity,
        recorded_by=str(recorded_by),
    )
    db.session.add(item)
    db.session.commit()
    return jsonify(
        {
            "ok": True,
            "item": {
                "id": int(item.id),
                "location_id": loc_id,
                "testing_site_id": int(testing_site_id),
                "description": item.description,
                "quantity": float(item.quantity),
                "recorded_by": item.recorded_by,
                "recorded_at": item.recorded_at.isoformat() if item.recorded_at else None,
            },
        }
    ), 201


def _parse_run_details_month_arg() -> date | None:
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return None
    return date(month_dt.year, month_dt.month, 1)


def _run_details_run_not_found_response() -> tuple[object, int]:
    return (
        jsonify(
            {
                "error": (
                    "No run file for this route and month. Upload a route CSV or complete "
                    "a field run before opening run details."
                ),
                "code": "run_not_found",
            }
        ),
        404,
    )


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>/run_details/review")
def get_monthly_route_run_details_review(route_id: int):
    """Office run review stop summaries (lazy-loaded when Run review accordion opens)."""
    month_first = _parse_run_details_month_arg()
    if month_first is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400

    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    from app.monthly.run_details_review import run_details_review_payload

    return jsonify(run_details_review_payload(route_id, month_first))


@monthly_routes_bp.get(
    "/api/monthly_routes/routes/<int:route_id>/run_details/review/stops/<int:testing_site_id>"
)
def get_monthly_route_run_details_review_stop(route_id: int, testing_site_id: int):
    """Per-stop field-change detail for an expanded run review card."""
    month_first = _parse_run_details_month_arg()
    if month_first is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400

    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    from app.monthly.run_details_review import run_details_stop_review_detail

    detail = run_details_stop_review_detail(route_id, month_first, testing_site_id)
    if detail is None:
        return jsonify({"error": "Stop not found in run review"}), 404
    return jsonify(detail)


@monthly_routes_bp.get(
    "/api/monthly_routes/routes/<int:route_id>/run_details/stops/<int:testing_site_id>"
)
def get_monthly_route_run_details_worksheet_stop(route_id: int, testing_site_id: int):
    """Full worksheet stop for the run-details site modal (clock events, deficiencies, panel fields)."""
    month_first = _parse_run_details_month_arg()
    if month_first is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400

    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    from app.monthly.run_details_review import run_details_worksheet_stop

    stop = run_details_worksheet_stop(route_id, month_first, testing_site_id)
    if stop is None:
        return jsonify({"error": "Stop not found"}), 404
    return jsonify({"stop": stop})


@monthly_routes_bp.patch(
    "/api/monthly_routes/routes/<int:route_id>/locations/<int:location_id>/billing_status"
)
def patch_monthly_route_location_billing_status(route_id: int, location_id: int):
    """Office processor: set location-month billing (bill / do_not_bill / unset)."""
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400

    month_first = date(month_dt.year, month_dt.month, 1)
    loc = (
        db.session.query(MonthlyRouteLocation)
        .filter(
            MonthlyRouteLocation.id == location_id,
            MonthlyRouteLocation.monthly_route_id == route_id,
        )
        .one_or_none()
    )
    if loc is None:
        return jsonify({"error": "Location not found on this route"}), 404

    run_for_month = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    from app.monthly.run_workflow import office_may_edit_billing

    if run_for_month is not None and not office_may_edit_billing(run_for_month):
        return (
            jsonify(
                {
                    "error": "Billing can be set after technicians end the field run.",
                    "code": "billing_before_field_end",
                }
            ),
            409,
        )

    payload = request.get_json(silent=True) or {}
    billing_raw = payload.get("billing_status")
    if billing_raw is None:
        return jsonify({"error": "billing_status is required", "code": "invalid_billing_status"}), 400

    from app.monthly.portal_workflow import set_location_billing_status

    try:
        hist = set_location_billing_status(
            location_id,
            month_first,
            route_id,
            billing_status=str(billing_raw),
        )
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        code = str(exc)
        if code in ("billing_legacy_locked", "invalid_billing_status"):
            return jsonify({"error": code.replace("_", " "), "code": code}), 400
        raise

    status = (hist.billing_status or "").strip().lower()
    return jsonify(
        {
            "ok": True,
            "location_id": int(location_id),
            "month_date": month_first.isoformat(),
            "billing_status": status,
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


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>/calculated_path")
def get_monthly_route_calculated_path(route_id: int):
    mr = _get_monthly_route(route_id)
    if mr is None:
        return jsonify({"error": "Route not found"}), 404

    refresh = (request.args.get("refresh") or "").strip().lower() in {"1", "true", "yes"}
    location_count = MonthlyRouteLocation.query.filter_by(monthly_route_id=route_id).count()
    payload = calculated_path_payload(route_id, refresh=refresh)
    payload["route"] = _serialize_monthly_route_entity(mr, location_count=location_count)
    return jsonify(payload)


def _worksheet_payload_includes_stops() -> bool:
    """Clients can request ``stops[]`` for the v2 testing-site grain."""
    if (request.args.get("include_stops") or "").strip() == "1":
        return True
    if _portal_worksheet_lazy_request():
        return True
    return (request.args.get("tech_portal") or "").strip() == "1"


def _portal_refresh_paperwork_on_load_requested() -> bool:
    """Portal worksheet GET may re-seed snapshot paperwork from office master (initial open only)."""
    return (request.args.get("refresh_paperwork") or "").strip() == "1"


def _sync_worksheet_stops_for_route_month(
    route_id: int,
    month_first: date,
    run_orm: MonthlyRouteRun,
) -> None:
    """Materialize or refresh ``MonthlyTestingSiteMonth`` rows for a worksheet read."""
    from app.monthly.portal_workflow import portal_run_is_read_only
    from app.monthly.worksheet_stops import (
        ensure_worksheet_stops_for_route_month,
        refresh_worksheet_stops_for_route_month,
    )

    should_refresh = (
        _portal_refresh_paperwork_on_load_requested()
        and _portal_current_month_materialize_on_read(month_first)
        and not _run_explicitly_completed(run_orm)
        and not portal_run_is_read_only(run_orm)
    )
    if should_refresh:
        refresh_worksheet_stops_for_route_month(route_id, month_first, run_orm)
        db.session.commit()
        return
    ensure_worksheet_stops_for_route_month(route_id, month_first, run_orm)


def _attach_worksheet_stops(
    payload: dict[str, object],
    route_id: int,
    month_first: date,
) -> dict[str, object]:
    if not _worksheet_payload_includes_stops():
        return payload
    from app.monthly.worksheet_stops import (
        portal_worksheet_preview_stops,
        worksheet_stops_for_route_month,
        worksheet_stops_from_attributed_history,
    )

    run = payload.get("run")
    if run is None:
        payload["stops"] = portal_worksheet_preview_stops(route_id, month_first)
    else:
        run_orm = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id,
            month_date=month_first,
        ).one_or_none()
        from app.monthly.field_submission import worksheet_stops_from_field_submission_if_frozen

        frozen_stops = (
            worksheet_stops_from_field_submission_if_frozen(run_orm) if run_orm is not None else None
        )
        if frozen_stops is not None:
            payload["stops"] = frozen_stops
        else:
            if run_orm is not None:
                _sync_worksheet_stops_for_route_month(route_id, month_first, run_orm)
            stops = worksheet_stops_for_route_month(route_id, month_first)
            if not stops and (payload.get("rows") or []):
                stops = worksheet_stops_from_attributed_history(route_id, month_first)
            payload["stops"] = stops
    return payload


def _portal_worksheet_lazy_request() -> bool:
    """Use lazy run semantics for worksheet GET/SSE (no auto ``MonthlyRouteRun``).

    Field techs normally have only ``tech_portal_unlocked``. If the browser still has a staff session
    (``authenticated``), opening ``/tech/`` worksheets must pass ``tech_portal=1`` so those reads do not
    fall through to staff auto-materialization (which would materialize placeholder rows without going
    through the portal preview flow).

    The Pacific **current** month is never lazy for portal reads — the run file is materialized on open
    so technicians can edit without pressing ``Start Run``.
    """
    if not session.get("tech_portal_unlocked"):
        return False
    if session.get("authenticated"):
        return (request.args.get("tech_portal") or "").strip() == "1"
    return True


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>/worksheet")
def get_monthly_route_worksheet(route_id: int):
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400
    month_first = date(month_dt.year, month_dt.month, 1)
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404
    portal_lazy = _portal_worksheet_lazy_request()
    if _portal_current_month_materialize_on_read(month_first):
        portal_lazy = False
    payload = _serialize_technician_worksheet_payload(
        route_id, month_first, portal_lazy_run=portal_lazy
    )
    if payload is None:
        return jsonify({"error": "Route not found"}), 404
    return jsonify(payload)


@monthly_routes_bp.get("/api/monthly_routes/routes/<int:route_id>/worksheet/stream")
def stream_monthly_route_worksheet(route_id: int):
    """SSE stream: emits worksheet revision when attributed rows change (heartbeat polling).

    Requires session auth (staff ``authenticated`` or PIN-unlocked technician portal).

    When the PIN portal is on lazy worksheet semantics and the Pacific-month run row does not
    exist yet, the stream still polls and emits once the run appears or worksheet rows change
    (second device ``Start Run`` / edits).

    Ops (nginx): disable buffering for this location e.g. ``proxy_buffering off`` and send
    ``X-Accel-Buffering: no`` (already set below). Increase proxy/read timeouts for long-lived streams.

    Poll interval: ``WORKSHEET_SSE_POLL_SECONDS`` (default ``5``, clamped 1.5–120).
    """
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400

    month_first = date(month_dt.year, month_dt.month, 1)
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    poll_raw = (os.getenv("WORKSHEET_SSE_POLL_SECONDS") or "5").strip()
    try:
        poll_sec = float(poll_raw)
    except ValueError:
        poll_sec = 5.0
    poll_sec = max(1.5, min(poll_sec, 120.0))

    def generate():
        last_sent: str | None = None
        yield "retry: 15000\n\n"
        # Release the connection acquired by route-level queries; this request stays open for SSE.
        db.session.remove()
        try:
            while True:
                try:
                    # Long-lived SSE: roll back the implicit read transaction and expire ORM state so
                    # each poll sees DB commits from other requests/workers (SQLAlchemy identity map +
                    # repeatable-read snapshots otherwise hide worksheet PATCH updates indefinitely).
                    db.session.rollback()
                    db.session.expire_all()
                    if _worksheet_payload_includes_stops():
                        from app.monthly.worksheet_stops import worksheet_stops_revision_token

                        existing_run = MonthlyRouteRun.query.filter_by(
                            monthly_route_id=route_id,
                            month_date=month_first,
                        ).one_or_none()
                        if existing_run is None and _portal_worksheet_lazy_request():
                            token = _WORKSHEET_SSE_PORTAL_PREVIEW_TOKEN
                        else:
                            token = worksheet_stops_revision_token(route_id, month_first)
                    elif _portal_worksheet_lazy_request():
                        existing_run = MonthlyRouteRun.query.filter_by(
                            monthly_route_id=route_id,
                            month_date=month_first,
                        ).one_or_none()
                        if existing_run is None:
                            token = _WORKSHEET_SSE_PORTAL_PREVIEW_TOKEN
                        else:
                            token = _worksheet_attributed_revision_token(route_id, month_first)
                    else:
                        token = _worksheet_attributed_revision_token(route_id, month_first)
                    if token is None:
                        yield f"event: worksheet_error\ndata: {json.dumps({'error': 'Route not found'})}\n\n"
                        break
                    if token != last_sent:
                        if last_sent is not None:
                            payload_out = {
                                "revision": token,
                                "route_id": route_id,
                                "month_date": month_first.isoformat(),
                            }
                            yield f"data: {json.dumps(payload_out)}\n\n"
                        last_sent = token
                finally:
                    # Return connection to the pool between polls; otherwise each open worksheet tab
                    # holds one pool slot until the client disconnects (QueuePool timeout on other APIs).
                    db.session.remove()
                time.sleep(poll_sec)
        except GeneratorExit:
            db.session.remove()
            return

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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

    row = (
        db.session.query(MonthlyRouteTestHistory)
        .filter_by(location_id=location_id, month_date=month_first)
        .one_or_none()
    )
    if row is None:
        return jsonify({"error": "Worksheet row not found for location/month"}), 404
    if row.test_monthly_route_id is not None and int(row.test_monthly_route_id) != int(route_id):
        return jsonify({"error": "Worksheet row does not belong to this route"}), 404
    loc = _get_monthly_location(location_id)
    if loc is None:
        return jsonify({"error": "Location not found"}), 404

    run_for_month = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    for portal_block in (
        _reject_patch_if_portal_run_completed(run_for_month),
        _reject_patch_if_portal_field_ended(run_for_month),
    ):
        if portal_block is not None:
            return portal_block

    if run_for_month is not None and _run_explicitly_completed(run_for_month):
        outcome_fields = {"result_status", "skip_reason"}
        if outcome_fields.intersection(changes.keys()):
            return jsonify(
                {
                    "error": "This run is completed; reopen it before changing tested/skipped outcomes.",
                    "code": "run_completed_outcome_locked",
                }
            ), 409

    outcome_fields_mut = {"result_status", "skip_reason"}
    staff_browser_outcome_lock = (
        session.get("authenticated")
        and outcome_fields_mut.intersection(changes.keys())
        and (request.args.get("tech_portal") or "").strip() != "1"
    )
    if (
        run_for_month is not None
        and _run_field_in_progress(run_for_month)
        and staff_browser_outcome_lock
    ):
        return jsonify(
            {
                "error": "Technicians are actively logging this run; office cannot change tested/skipped outcomes until field work ends or the run is reset.",
                "code": "run_active_office_outcome_locked",
            }
        ), 409

    from app.monthly.run_workflow import office_may_edit_outcomes

    if (
        run_for_month is not None
        and staff_browser_outcome_lock
        and not office_may_edit_outcomes(run_for_month)
        and not _run_field_in_progress(run_for_month)
    ):
        return jsonify(
            {
                "error": "Office can change tested/skipped outcomes after technicians end the field run.",
                "code": "office_outcome_before_field_end",
            }
        ), 409

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

    # All technician-editable fields are run-scoped (snapshotted on the history row).
    # The library "current" view (``MonthlyRouteLocation``) is mirrored from history
    # only when the patched run is the most recent run for that location, so editing
    # an old month does not pollute the library current value.
    editable_history_fields = {
        "result_status": "result_status",
        "skip_reason": "skip_reason",
        "testing_procedures": "testing_procedures",
        "inspection_tech_notes": "inspection_tech_notes",
        "time_in": "sheet_time_in_raw",
        "time_out": "sheet_time_out_raw",
        "annual_month": "annual_month",
        "ring": "ring",
        "key_number": "key_number",
        "facp": "facp",
        "monitoring": "monitoring_notes",
    }
    # Map field -> attribute on ``MonthlyRouteLocation`` for the latest-run mirror.
    library_mirror_fields = {
        "annual_month": "annual_month",
        "ring": "ring_detail",
        "key_number": "keys",
        "facp": "facp_detail",
        "testing_procedures": "testing_procedures",
        "inspection_tech_notes": "inspection_tech_notes",
    }
    known_fields = set(editable_history_fields.keys())
    unknown = [k for k in changes.keys() if k not in known_fields]
    if unknown:
        return jsonify({"error": f"Unsupported worksheet fields: {', '.join(sorted(unknown))}"}), 400

    changes_eff: dict[str, object] = dict(changes)
    clocking_in = "time_in" in changes_eff and _normalize_ws_text(changes_eff.get("time_in")) is not None
    if clocking_in:
        if _normalize_ws_text(changes_eff.get("result_status")) != "skipped":
            if "result_status" not in changes:
                changes_eff["result_status"] = None
            if "skip_reason" not in changes:
                changes_eff["skip_reason"] = None
            if "time_out" not in changes:
                changes_eff["time_out"] = None
    elif "result_status" in changes_eff and _normalize_ws_text(changes_eff.get("result_status")) is None:
        changes_eff["skip_reason"] = None
        changes_eff["time_in"] = None
        changes_eff["time_out"] = None

    if "result_status" in changes_eff:
        rs = _normalize_ws_text(changes_eff.get("result_status"))
        if rs is not None and rs not in {"tested", "skipped"}:
            return jsonify({"error": "result_status must be tested, skipped, or null"}), 400
    if _normalize_ws_text(changes_eff.get("result_status")) == "skipped":
        merged_skip = _normalize_ws_text(changes_eff.get("skip_reason"))
        if merged_skip is None and row.skip_reason is None:
            return jsonify({"error": "skip_reason is required when result_status is skipped"}), 400

    if _patch_will_start_open_clock_in(row, changes_eff):
        other_rows = (
            db.session.query(MonthlyRouteTestHistory)
            .join(
                MonthlyRouteLocation,
                MonthlyRouteLocation.id == MonthlyRouteTestHistory.location_id,
            )
            .filter(
                MonthlyRouteLocation.monthly_route_id == route_id,
                MonthlyRouteTestHistory.month_date == month_first,
                MonthlyRouteTestHistory.location_id != location_id,
            )
            .all()
        )
        for other in other_rows:
            if _worksheet_row_open_clock_in(other):
                return jsonify(
                    {
                        "error": "Clock out of the current stop before clocking in elsewhere.",
                        "code": "open_clock_in_conflict",
                        "location_id": other.location_id,
                    }
                ), 409

    actor_username = _session_username_clean()
    actor_name = actor_username
    source = _normalize_ws_text(payload.get("source")) or "technician_app"
    client_mutated_at = _parse_iso_dt(payload.get("client_mutated_at"))
    from app.monthly.worksheet_stops import WorksheetAuditEventIdAllocator

    audit_ids = WorksheetAuditEventIdAllocator()

    changed_any = False
    mirrored_history_changes: dict[str, object] = {}
    for field_name, attr_name in editable_history_fields.items():
        if field_name not in changes_eff:
            continue
        old_val = getattr(row, attr_name)
        new_val = _normalize_ws_text(changes_eff.get(field_name))
        if old_val == new_val:
            continue
        setattr(row, attr_name, new_val)
        if field_name in library_mirror_fields:
            mirrored_history_changes[field_name] = new_val
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                **audit_ids.id_kwargs(),
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
                client_mutation_id=client_mutation_id if len(changes_eff) == 1 else None,
                changed_at_client=client_mutated_at,
            )
        )
        changed_any = True

    # Mirror snapshot edits onto ``MonthlyRouteLocation`` only when the patched
    # run is the most recent run for that location. Past-month edits stay confined
    # to the run file.
    if mirrored_history_changes and _is_latest_run_for_location(location_id, month_first):
        for field_name, new_val in mirrored_history_changes.items():
            attr = library_mirror_fields.get(field_name)
            if attr is None:
                continue
            if getattr(loc, attr) != new_val:
                setattr(loc, attr, new_val)
        from sqlalchemy import inspect as sa_inspect

        if sa_inspect(db.engine).has_table("monthly_site"):
            from app.monthly.monthly_sites_sync import refresh_primary_testing_site_from_legacy

            refresh_primary_testing_site_from_legacy(loc)

    # Enforce invariant after merged state updates.
    if (row.result_status or "").strip().lower() == "skipped" and not _normalize_ws_text(row.skip_reason):
        db.session.rollback()
        return jsonify({"error": "skip_reason is required when result_status is skipped"}), 400

    if (row.result_status or "").strip().lower() != "skipped":
        row.skip_reason = None

    if changed_any:
        from app.monthly.worksheet_stops import sync_mtsm_snapshots_from_history_for_location

        sync_mtsm_snapshots_from_history_for_location(route_id, month_first, loc, row)
        db.session.commit()
    else:
        db.session.rollback()

    db.session.refresh(row)
    db.session.refresh(loc)
    return jsonify({"ok": True, "row": _worksheet_row_from_history(row, loc, route_id=route_id)})


@monthly_routes_bp.patch(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>"
)
def patch_monthly_route_worksheet_stop(route_id: int, testing_site_id: int):
    """PATCH v2 portal worksheet stop (``MonthlyTestingSiteMonth``)."""
    from app.monthly.worksheet_stops import (
        STOP_PATCH_FIELD_MAP,
        STOP_PATCH_HISTORY_AUDIT_ATTR,
        WorksheetAuditEventIdAllocator,
        apply_worksheet_stop_field_change,
        ensure_worksheet_stops_for_route_month,
        find_open_clock_in_stop_on_route,
        is_primary_stop,
        load_stop_for_patch,
        patch_will_start_open_clock_in,
        serialize_worksheet_stop,
        sync_primary_history_from_stop,
        worksheet_stop_number_for_site,
    )

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

    run_for_month = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()

    if _office_staff_worksheet_patch():
        from app.monthly.run_workflow import run_in_office_prep_phase

        if run_for_month is None or run_in_office_prep_phase(run_for_month):
            blocked = _reject_if_future_month_prep_blocked(route_id, month_first)
            if blocked is not None:
                return blocked

    mtsm, ts, loc = load_stop_for_patch(route_id, testing_site_id, month_first)
    if ts is None or loc is None:
        return jsonify({"error": "Testing site not found"}), 404
    if mtsm is None and run_for_month is not None and _tech_portal_patch_request():
        ensure_worksheet_stops_for_route_month(route_id, month_first, run_for_month)
        db.session.flush()
        mtsm, ts, loc = load_stop_for_patch(route_id, testing_site_id, month_first)
    if mtsm is None and _office_staff_worksheet_patch():
        from app.monthly.run_workflow import run_in_office_prep_phase

        if run_in_office_prep_phase(run_for_month):
            if run_for_month is None:
                from app.monthly.runs import get_or_create_monthly_route_run

                run_for_month = get_or_create_monthly_route_run(
                    route_id,
                    month_first,
                    source="office_manual",
                )
                db.session.flush()
            ensure_worksheet_stops_for_route_month(route_id, month_first, run_for_month)
            db.session.flush()
            mtsm, ts, loc = load_stop_for_patch(route_id, testing_site_id, month_first)
    if mtsm is None:
        return jsonify({"error": "Worksheet stop not found for testing site/month"}), 404
    if mtsm.test_monthly_route_id is not None and int(mtsm.test_monthly_route_id) != int(route_id):
        return jsonify({"error": "Worksheet stop does not belong to this route"}), 404
    for portal_block in (
        _reject_patch_if_portal_run_completed(run_for_month),
        _reject_patch_if_portal_field_ended(run_for_month),
        _reject_if_portal_read_only(run_for_month),
    ):
        if portal_block is not None:
            return portal_block

    if run_for_month is not None and _run_explicitly_completed(run_for_month):
        outcome_fields = {"result_status", "skip_reason"}
        if outcome_fields.intersection(changes.keys()):
            return jsonify(
                {
                    "error": "This run is completed; reopen it before changing tested/skipped outcomes.",
                    "code": "run_completed_outcome_locked",
                }
            ), 409

    outcome_fields_mut = {"result_status", "skip_reason"}
    staff_browser_outcome_lock = (
        session.get("authenticated")
        and outcome_fields_mut.intersection(changes.keys())
        and (request.args.get("tech_portal") or "").strip() != "1"
    )
    if (
        run_for_month is not None
        and _run_field_in_progress(run_for_month)
        and staff_browser_outcome_lock
    ):
        return jsonify(
            {
                "error": "Technicians are actively logging this run; office cannot change tested/skipped outcomes until field work ends or the run is reset.",
                "code": "run_active_office_outcome_locked",
            }
        ), 409

    from app.monthly.run_workflow import office_may_edit_outcomes as _office_may_edit_outcomes

    if (
        run_for_month is not None
        and staff_browser_outcome_lock
        and not _office_may_edit_outcomes(run_for_month)
        and not _run_field_in_progress(run_for_month)
    ):
        return jsonify(
            {
                "error": "Office can change tested/skipped outcomes after technicians end the field run.",
                "code": "office_outcome_before_field_end",
            }
        ), 409

    client_mutation_id = _normalize_ws_text(payload.get("client_mutation_id"))
    if client_mutation_id:
        existing_mutation = MonthlyRouteWorksheetAuditEvent.query.filter_by(
            client_mutation_id=client_mutation_id
        ).first()
        if existing_mutation is not None:
            office_prep = _office_staff_worksheet_patch()
            stop_payload = serialize_worksheet_stop(
                ts,
                loc,
                mtsm,
                route_id=route_id,
                month_first=month_first,
                stop_number=worksheet_stop_number_for_site(route_id, month_first, testing_site_id),
                include_portal_extras=not office_prep,
            )
            return jsonify({"ok": True, "deduped": True, "stop": stop_payload})

    known_fields = set(STOP_PATCH_FIELD_MAP.keys())
    unknown = [k for k in changes.keys() if k not in known_fields]
    if unknown:
        return jsonify({"error": f"Unsupported worksheet fields: {', '.join(sorted(unknown))}"}), 400

    if "office_attention" in changes or "office_job_comment" in changes or "prior_month_out_of_order_dismissed" in changes:
        from app.monthly.run_workflow import run_in_office_prep_phase

        if not _office_staff_worksheet_patch():
            code = (
                "office_job_comment_office_only"
                if "office_job_comment" in changes
                else (
                    "prior_month_out_of_order_dismissed_office_only"
                    if "prior_month_out_of_order_dismissed" in changes
                    else "office_attention_office_only"
                )
            )
            return (
                jsonify(
                    {
                        "error": "Only office staff can edit office prep fields on stops.",
                        "code": code,
                    }
                ),
                403,
            )
        if not run_in_office_prep_phase(run_for_month):
            return (
                jsonify(
                    {
                        "error": "Office prep fields can only be edited before field work starts.",
                        "code": "run_prep_locked",
                    }
                ),
                409,
            )

    changes_eff: dict[str, object] = dict(changes)
    clocking_in = "time_in" in changes_eff and _normalize_ws_text(changes_eff.get("time_in")) is not None
    if clocking_in:
        if _normalize_ws_text(changes_eff.get("result_status")) != "skipped":
            if "result_status" not in changes:
                changes_eff["result_status"] = None
            if "skip_reason" not in changes:
                changes_eff["skip_reason"] = None
            if "time_out" not in changes:
                changes_eff["time_out"] = None
    elif "result_status" in changes_eff and _normalize_ws_text(changes_eff.get("result_status")) is None:
        changes_eff["skip_reason"] = None
        changes_eff["time_in"] = None
        changes_eff["time_out"] = None

    if "result_status" in changes_eff:
        rs = _normalize_ws_text(changes_eff.get("result_status"))
        if rs is not None and rs not in {"tested", "skipped"}:
            return jsonify({"error": "result_status must be tested, skipped, or null"}), 400
    if _normalize_ws_text(changes_eff.get("result_status")) == "skipped":
        merged_skip = _normalize_ws_text(changes_eff.get("skip_reason"))
        if merged_skip is None and mtsm.skip_reason is None:
            return jsonify({"error": "skip_reason is required when result_status is skipped"}), 400

    if patch_will_start_open_clock_in(mtsm, changes_eff):
        conflict = find_open_clock_in_stop_on_route(
            route_id,
            month_first,
            exclude_testing_site_id=testing_site_id,
        )
        if conflict is not None:
            return jsonify(
                {
                    "error": "Clock out of the current stop before clocking in elsewhere.",
                    "code": "open_clock_in_conflict",
                    "testing_site_id": int(conflict.monthly_testing_site_id),
                }
            ), 409

    actor_username = _session_username_clean()
    actor_name = actor_username
    source = _normalize_ws_text(payload.get("source")) or "technician_app"
    from app.monthly.run_workflow import run_in_office_prep_phase

    if _office_staff_worksheet_patch() and run_in_office_prep_phase(run_for_month):
        source = "office_manual"
    client_mutated_at = _parse_iso_dt(payload.get("client_mutated_at"))
    audit_ids = WorksheetAuditEventIdAllocator()

    audit_old_values: dict[str, object] = {
        field_name: getattr(mtsm, STOP_PATCH_FIELD_MAP[field_name])
        for field_name in changes_eff
        if field_name in STOP_PATCH_FIELD_MAP
    }

    changed_any = False
    for field_name in changes_eff:
        if field_name not in STOP_PATCH_FIELD_MAP:
            continue
        field_changed, field_error = apply_worksheet_stop_field_change(
            mtsm,
            field_name,
            changes_eff.get(field_name),
        )
        if field_error:
            db.session.rollback()
            return jsonify({"error": field_error}), 400
        if field_changed:
            changed_any = True

    if (mtsm.result_status or "").strip().lower() == "skipped" and not _normalize_ws_text(mtsm.skip_reason):
        db.session.rollback()
        return jsonify({"error": "skip_reason is required when result_status is skipped"}), 400

    if (mtsm.result_status or "").strip().lower() != "skipped":
        mtsm.skip_reason = None

    hist: MonthlyRouteTestHistory | None = None
    if is_primary_stop(ts, loc):
        hist = sync_primary_history_from_stop(mtsm, loc, route_id, month_first)
    else:
        hist = (
            MonthlyRouteTestHistory.query.filter_by(
                location_id=int(loc.id),
                month_date=month_first,
            )
            .one_or_none()
        )

    if changed_any and hist is not None:
        for field_name in changes_eff:
            if field_name not in STOP_PATCH_FIELD_MAP:
                continue
            if field_name == "facp" and "panel" in changes_eff:
                continue
            mtsm_attr = STOP_PATCH_FIELD_MAP[field_name]
            if field_name == "run_comments":
                old_val = audit_old_values.get("run_comments")
                new_val = mtsm.run_comments
                audit_name = "run_comments"
            elif field_name == "panel":
                old_val = audit_old_values.get("panel")
                if old_val is None:
                    old_val = audit_old_values.get("facp")
                new_val = _normalize_ws_text(mtsm.panel) or _normalize_ws_text(mtsm.facp)
                audit_name = "facp"
            elif field_name == "monitoring_company_id":
                old_val = audit_old_values.get("monitoring_company_id")
                new_val = mtsm.monitoring_company_id
                audit_name = "monitoring_company_id"
            elif field_name == "monitoring_account_number":
                old_val = audit_old_values.get("monitoring_account_number")
                new_val = mtsm.monitoring_account_number
                audit_name = "monitoring_account_number"
            elif field_name == "monitoring_notes":
                old_val = audit_old_values.get("monitoring_notes")
                new_val = mtsm.monitoring_notes
                audit_name = "monitoring_notes"
            elif field_name == "monitoring_company":
                old_val = audit_old_values.get("monitoring_company")
                new_val = mtsm.monitoring_company_name
                audit_name = "monitoring_company"
            elif field_name == "time_in":
                old_val = audit_old_values.get("time_in")
                new_val = getattr(mtsm, mtsm_attr)
                audit_name = "time_in"
            elif field_name == "time_out":
                old_val = audit_old_values.get("time_out")
                new_val = getattr(mtsm, mtsm_attr)
                audit_name = "time_out"
            else:
                old_val = audit_old_values.get(field_name)
                new_val = getattr(mtsm, mtsm_attr)
                audit_name = "facp" if field_name == "facp" else field_name
            if old_val == new_val:
                continue
            db.session.add(
                MonthlyRouteWorksheetAuditEvent(
                    **audit_ids.id_kwargs(),
                    monthly_route_id=route_id,
                    location_id=int(loc.id),
                    history_row_id=int(hist.id),
                    month_date=month_first,
                    field_name=audit_name,
                    old_value=old_val,
                    new_value=new_val,
                    source=source,
                    changed_by_username=actor_username,
                    changed_by_name=actor_name,
                    client_mutation_id=client_mutation_id if len(changes_eff) == 1 else None,
                    changed_at_client=client_mutated_at,
                )
            )

    snapshot_patch_keys = set(STOP_PATCH_FIELD_MAP.keys()) - {
        "result_status",
        "skip_reason",
        "time_in",
        "time_out",
        "run_comments",
        "office_job_comment",
        "office_attention",
        "prior_month_out_of_order_dismissed",
    }
    snapshot_changed = changed_any and bool(snapshot_patch_keys.intersection(changes_eff))

    if changed_any:
        db.session.commit()
    else:
        db.session.rollback()

    if (
        snapshot_changed
        and _is_latest_run_for_location(int(loc.id), month_first)
    ):
        from app.monthly.monthly_sites_sync import (
            mirror_mtsm_snapshot_to_primary_master,
            push_primary_testing_site_display_to_legacy,
        )

        mirror_mtsm_snapshot_to_primary_master(ts, mtsm)
        if is_primary_stop(ts, loc):
            push_primary_testing_site_display_to_legacy(loc, ts)
        db.session.commit()

    db.session.refresh(mtsm)
    db.session.refresh(ts)
    office_prep = _office_staff_worksheet_patch()
    stop_payload = serialize_worksheet_stop(
        ts,
        loc,
        mtsm,
        route_id=route_id,
        month_first=month_first,
        stop_number=worksheet_stop_number_for_site(route_id, month_first, testing_site_id),
        run=run_for_month,
        include_portal_extras=not office_prep,
    )
    return jsonify({"ok": True, "stop": stop_payload})


def _parse_portal_workflow_month() -> tuple[date | None, object]:
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return None, (jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400)
    return date(month_dt.year, month_dt.month, 1), None


def _portal_session_tech() -> tuple[str | None, str | None]:
    tech_id = session.get("portal_tech_id")
    tech_name = session.get("portal_tech_name")
    if tech_id is not None:
        tech_id = str(tech_id).strip() or None
    if tech_name is not None:
        tech_name = str(tech_name).strip() or None
    return tech_id, tech_name


@monthly_routes_bp.get(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/clock_events"
)
def get_worksheet_stop_clock_events(route_id: int, testing_site_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err
    ctx, err_resp = _portal_workflow_stop_context(route_id, testing_site_id, month_first)
    if err_resp is not None:
        return err_resp
    from app.monthly.portal_workflow import list_clock_events

    return jsonify({"clock_events": list_clock_events(ctx["mtsm"])})


@monthly_routes_bp.post(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/clock_events/clock_in"
)
def post_worksheet_stop_clock_in(route_id: int, testing_site_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err
    ctx, err_resp = _portal_workflow_stop_context(route_id, testing_site_id, month_first)
    if err_resp is not None:
        return err_resp

    from app.monthly.portal_workflow import clock_in_stop, find_open_clock_event_on_route
    from app.monthly.worksheet_stops import is_primary_stop, sync_primary_history_from_stop

    payload = request.get_json(silent=True) or {}
    time_in = _normalize_ws_text(payload.get("time_in"))
    if not time_in:
        now_pt = datetime.now(ZoneInfo("America/Vancouver"))
        hour = now_pt.hour % 12 or 12
        time_in = f"{hour}:{now_pt.minute:02d} {'AM' if now_pt.hour < 12 else 'PM'}"

    conflict = find_open_clock_event_on_route(
        route_id,
        month_first,
        exclude_testing_site_id=testing_site_id,
    )
    if conflict is not None:
        other_mtsm, _ev = conflict
        return jsonify(
            {
                "error": "Clock out of the current stop before clocking in elsewhere.",
                "code": "open_clock_in_conflict",
                "testing_site_id": int(other_mtsm.monthly_testing_site_id),
            }
        ), 409

    tech_id, tech_name = _portal_session_tech()
    mtsm = ctx["mtsm"]
    ts = ctx["ts"]
    loc = ctx["loc"]
    ev = clock_in_stop(mtsm, time_in_raw=time_in, tech_id=tech_id, tech_name=tech_name)
    if is_primary_stop(ts, loc):
        sync_primary_history_from_stop(mtsm, loc, route_id, month_first)
    db.session.commit()
    return jsonify({"ok": True, "clock_event": {"id": int(ev.id), "time_in": ev.time_in_raw}, "stop": ctx["stop_payload"]()})


@monthly_routes_bp.post(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/clock_events/clock_out"
)
def post_worksheet_stop_clock_out(route_id: int, testing_site_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err
    ctx, err_resp = _portal_workflow_stop_context(route_id, testing_site_id, month_first)
    if err_resp is not None:
        return err_resp

    from app.monthly.portal_workflow import clock_out_stop
    from app.monthly.worksheet_stops import is_primary_stop, sync_primary_history_from_stop

    payload = request.get_json(silent=True) or {}
    time_out = _normalize_ws_text(payload.get("time_out"))
    if not time_out:
        now_pt = datetime.now(ZoneInfo("America/Vancouver"))
        hour = now_pt.hour % 12 or 12
        time_out = f"{hour}:{now_pt.minute:02d} {'AM' if now_pt.hour < 12 else 'PM'}"

    try:
        ev = clock_out_stop(ctx["mtsm"], time_out_raw=time_out)
    except ValueError:
        return jsonify({"error": "No open clock-in on this stop.", "code": "no_open_clock"}), 400

    if is_primary_stop(ctx["ts"], ctx["loc"]):
        sync_primary_history_from_stop(ctx["mtsm"], ctx["loc"], route_id, month_first)
    db.session.commit()
    return jsonify(
        {
            "ok": True,
            "clock_event": {"id": int(ev.id), "time_out": ev.time_out_raw},
            "stop": ctx["stop_payload"](),
        }
    )


@monthly_routes_bp.post(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/clock_events/cancel_clock_in"
)
def post_worksheet_stop_cancel_clock_in(route_id: int, testing_site_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err
    ctx, err_resp = _portal_workflow_stop_context(route_id, testing_site_id, month_first)
    if err_resp is not None:
        return err_resp

    from app.monthly.portal_workflow import cancel_clock_in_stop
    from app.monthly.worksheet_stops import is_primary_stop, sync_primary_history_from_stop

    try:
        cancel_clock_in_stop(ctx["mtsm"])
    except ValueError as exc:
        code = str(exc)
        if code in ("no_open_clock", "visit_has_outcome"):
            return jsonify({"error": code.replace("_", " "), "code": code}), 400
        raise

    if is_primary_stop(ctx["ts"], ctx["loc"]):
        sync_primary_history_from_stop(ctx["mtsm"], ctx["loc"], route_id, month_first)
    db.session.commit()
    return jsonify({"ok": True, "stop": ctx["stop_payload"]()})


@monthly_routes_bp.post(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/transition_clock"
)
def post_worksheet_transition_clock(route_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err

    from app.monthly.portal_workflow import transition_clock_between_stops
    from app.monthly.worksheet_stops import (
        is_primary_stop,
        serialize_worksheet_stop,
        sync_primary_history_from_stop,
        worksheet_stop_number_for_site,
    )

    run_for_month = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    for block in (
        _reject_if_portal_read_only(run_for_month),
        _reject_patch_if_portal_run_completed(run_for_month),
        _reject_patch_if_portal_field_ended(run_for_month),
    ):
        if block is not None:
            return block

    payload = request.get_json(silent=True) or {}
    from_site = payload.get("from_testing_site_id")
    to_site = payload.get("to_testing_site_id")
    if from_site is None or to_site is None:
        return jsonify({"error": "from_testing_site_id and to_testing_site_id are required"}), 400

    time_out = _normalize_ws_text(payload.get("time_out"))
    time_in = _normalize_ws_text(payload.get("time_in"))
    if not time_out or not time_in:
        now_pt = datetime.now(ZoneInfo("America/Vancouver"))
        hour = now_pt.hour % 12 or 12
        default_time = f"{hour}:{now_pt.minute:02d} {'AM' if now_pt.hour < 12 else 'PM'}"
        time_out = time_out or default_time
        time_in = time_in or default_time

    tech_id, tech_name = _portal_session_tech()
    try:
        (
            from_mtsm,
            to_mtsm,
            from_ts,
            from_loc,
            to_ts,
            to_loc,
        ) = transition_clock_between_stops(
            route_id,
            month_first,
            int(from_site),
            int(to_site),
            time_out_raw=time_out,
            time_in_raw=time_in,
            tech_id=tech_id,
            tech_name=tech_name,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "open_clock_in_conflict":
            return jsonify(
                {
                    "error": "Clock out of the current stop before clocking in elsewhere.",
                    "code": code,
                }
            ), 409
        if code in ("from_stop_not_found", "to_stop_not_found"):
            return jsonify({"error": code.replace("_", " "), "code": code}), 404
        if code == "same_stop":
            return jsonify({"error": "from and to stops must differ", "code": code}), 400
        raise

    if is_primary_stop(from_ts, from_loc):
        sync_primary_history_from_stop(from_mtsm, from_loc, route_id, month_first)
    if is_primary_stop(to_ts, to_loc):
        sync_primary_history_from_stop(to_mtsm, to_loc, route_id, month_first)
    db.session.commit()

    from_stop = serialize_worksheet_stop(
        from_ts,
        from_loc,
        from_mtsm,
        route_id=route_id,
        month_first=month_first,
        stop_number=worksheet_stop_number_for_site(route_id, month_first, int(from_site)),
        run=run_for_month,
    )
    to_stop = serialize_worksheet_stop(
        to_ts,
        to_loc,
        to_mtsm,
        route_id=route_id,
        month_first=month_first,
        stop_number=worksheet_stop_number_for_site(route_id, month_first, int(to_site)),
        run=run_for_month,
    )
    return jsonify({"ok": True, "from_stop": from_stop, "to_stop": to_stop})


@monthly_routes_bp.put(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/test_outcome"
)
def put_worksheet_stop_test_outcome(route_id: int, testing_site_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err
    ctx, err_resp = _portal_workflow_stop_context(route_id, testing_site_id, month_first)
    if err_resp is not None:
        return err_resp

    from app.monthly.portal_workflow import clear_test_outcome, set_test_outcome
    from app.monthly.run_workflow import office_may_edit_outcomes
    from app.monthly.worksheet_stops import is_primary_stop, sync_primary_history_from_stop

    payload = request.get_json(silent=True) or {}
    outcome = _normalize_ws_text(payload.get("test_outcome"))
    run_for_month = ctx["run"]

    if _office_staff_worksheet_patch():
        if run_for_month is None or not office_may_edit_outcomes(run_for_month):
            if run_for_month is not None and _run_field_in_progress(run_for_month):
                return jsonify(
                    {
                        "error": (
                            "Technicians are actively logging this run; office cannot change "
                            "test outcomes until field work ends or the run is reset."
                        ),
                        "code": "run_active_office_outcome_locked",
                    }
                ), 409
            return jsonify(
                {
                    "error": (
                        "Office can change test outcomes after technicians end the field run."
                    ),
                    "code": "office_outcome_before_field_end",
                }
            ), 409

    if not outcome:
        if payload.get("clear") is True and _office_staff_worksheet_patch():
            clear_test_outcome(
                ctx["mtsm"],
                ctx["loc"],
                route_id,
                month_first,
            )
            if is_primary_stop(ctx["ts"], ctx["loc"]):
                sync_primary_history_from_stop(ctx["mtsm"], ctx["loc"], route_id, month_first)
            db.session.commit()
            return jsonify({"ok": True, "stop": ctx["stop_payload"]()})
        return jsonify({"error": "test_outcome is required"}), 400

    try:
        set_test_outcome(
            ctx["mtsm"],
            ctx["loc"],
            route_id,
            month_first,
            test_outcome=outcome,
            skip_category=_normalize_ws_text(payload.get("skip_category")),
            skip_note=_normalize_ws_text(payload.get("skip_note")),
            confirmed_no_deficiencies=bool(payload.get("confirmed_no_deficiencies")),
            run_id=int(ctx["run"].id) if ctx["run"] is not None else None,
        )
    except ValueError as exc:
        code = str(exc)
        _OUTCOME_ERROR_MESSAGES = {
            "skip_category_required": "skip_category is required when test_outcome is skipped",
            "deficiencies_block_all_good": (
                "Cannot record All good while deficiencies are New or Verified on this stop."
            ),
            "unverified_deficiencies": (
                "Verify all pre-existing New deficiencies before recording this result."
            ),
            "confirmed_no_deficiencies_required": (
                "Confirm that no deficiencies apply before recording Passed with problems."
            ),
            "invalid_test_outcome": "Invalid test_outcome",
        }
        if code in _OUTCOME_ERROR_MESSAGES:
            return jsonify({"error": _OUTCOME_ERROR_MESSAGES[code], "code": code}), 400
        return jsonify({"error": "Invalid test_outcome", "code": "invalid_test_outcome"}), 400

    if is_primary_stop(ctx["ts"], ctx["loc"]):
        sync_primary_history_from_stop(ctx["mtsm"], ctx["loc"], route_id, month_first)
    db.session.commit()
    return jsonify({"ok": True, "stop": ctx["stop_payload"]()})


@monthly_routes_bp.get(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/deficiencies"
)
def get_worksheet_stop_deficiencies(route_id: int, testing_site_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err
    ctx, err_resp = _portal_workflow_stop_context(route_id, testing_site_id, month_first)
    if err_resp is not None:
        return err_resp
    from app.monthly.portal_workflow import list_deficiencies_for_site

    include_hidden = (request.args.get("include_hidden") or "").strip() == "1"
    return jsonify(
        {
            "deficiencies": list_deficiencies_for_site(
                int(ctx["ts"].id),
                include_hidden=include_hidden,
            )
        }
    )


@monthly_routes_bp.post(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/deficiencies"
)
def post_worksheet_stop_deficiency(route_id: int, testing_site_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err
    ctx, err_resp = _portal_workflow_stop_context(route_id, testing_site_id, month_first)
    if err_resp is not None:
        return err_resp

    from app.monthly.portal_workflow import create_deficiency, dual_write_legacy_result_fields

    payload = request.get_json(silent=True) or {}
    title = _normalize_ws_text(payload.get("title"))
    if not title:
        return jsonify({"error": "title is required"}), 400
    tech_id, tech_name = _portal_session_tech()
    run = ctx["run"]
    try:
        row = create_deficiency(
            int(ctx["ts"].id),
            int(run.id) if run is not None else None,
            title=title,
            severity=_normalize_ws_text(payload.get("severity")) or "deficient",
            status=_normalize_ws_text(payload.get("status")) or "new",
            description=_normalize_ws_text(payload.get("description")),
            tech_id=tech_id,
            tech_name=tech_name,
        )
    except ValueError:
        return jsonify({"error": "Invalid severity or status"}), 400

    mtsm = ctx["mtsm"]
    if (_normalize_ws_text(mtsm.test_outcome) or "").lower() == "all_good":
        mtsm.test_outcome = "passed_with_problems"
        dual_write_legacy_result_fields(mtsm)
    if mtsm.confirmed_no_deficiencies:
        mtsm.confirmed_no_deficiencies = False

    db.session.commit()
    from app.monthly.portal_workflow import serialize_deficiency

    return jsonify({"ok": True, "deficiency": serialize_deficiency(row), "stop": ctx["stop_payload"]()}), 201


@monthly_routes_bp.patch(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/deficiencies/<int:deficiency_id>"
)
def patch_worksheet_stop_deficiency(route_id: int, testing_site_id: int, deficiency_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err
    ctx, err_resp = _portal_workflow_stop_context(route_id, testing_site_id, month_first)
    if err_resp is not None:
        return err_resp

    from app.db_models import MonthlyTestingSiteDeficiency
    from app.monthly.portal_workflow import serialize_deficiency, update_deficiency

    row = MonthlyTestingSiteDeficiency.query.filter_by(
        id=int(deficiency_id),
        monthly_testing_site_id=int(ctx["ts"].id),
    ).one_or_none()
    if row is None:
        return jsonify({"error": "Deficiency not found"}), 404

    payload = request.get_json(silent=True) or {}
    tech_id, tech_name = _portal_session_tech()
    try:
        update_deficiency(
            row,
            title=_normalize_ws_text(payload.get("title")) if "title" in payload else None,
            severity=_normalize_ws_text(payload.get("severity")) if "severity" in payload else None,
            status=_normalize_ws_text(payload.get("status")) if "status" in payload else None,
            description=_normalize_ws_text(payload.get("description")) if "description" in payload else None,
            tech_id=tech_id,
            tech_name=tech_name,
        )
    except ValueError:
        return jsonify({"error": "Invalid severity or status"}), 400

    db.session.commit()
    return jsonify({"ok": True, "deficiency": serialize_deficiency(row), "stop": ctx["stop_payload"]()})


@monthly_routes_bp.post(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/deficiencies/<int:deficiency_id>/verify"
)
def post_worksheet_stop_deficiency_verify(route_id: int, testing_site_id: int, deficiency_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err
    ctx, err_resp = _portal_workflow_stop_context(route_id, testing_site_id, month_first)
    if err_resp is not None:
        return err_resp

    from app.db_models import MonthlyTestingSiteDeficiency
    from app.monthly.portal_workflow import serialize_deficiency, verify_deficiency

    row = MonthlyTestingSiteDeficiency.query.filter_by(
        id=int(deficiency_id),
        monthly_testing_site_id=int(ctx["ts"].id),
    ).one_or_none()
    if row is None:
        return jsonify({"error": "Deficiency not found"}), 404

    payload = request.get_json(silent=True) or {}
    tech_id, tech_name = _portal_session_tech()
    verify_deficiency(
        row,
        tech_id=tech_id,
        tech_name=tech_name,
        note=_normalize_ws_text(payload.get("note")),
    )
    db.session.commit()
    return jsonify({"ok": True, "deficiency": serialize_deficiency(row), "stop": ctx["stop_payload"]()})


@monthly_routes_bp.post(
    "/api/monthly_routes/routes/<int:route_id>/worksheet/stops/<int:testing_site_id>/reset"
)
def post_worksheet_stop_reset(route_id: int, testing_site_id: int):
    month_first, err = _parse_portal_workflow_month()
    if err is not None:
        return err
    ctx, err_resp = _portal_workflow_stop_context(route_id, testing_site_id, month_first)
    if err_resp is not None:
        return err_resp

    from app.monthly.portal_workflow import reset_stop_on_run

    reset_stop_on_run(
        route_id,
        month_first,
        ctx["mtsm"],
        ctx["ts"],
        ctx["loc"],
        ctx["run"],
    )
    db.session.commit()
    return jsonify({"ok": True, "stop": ctx["stop_payload"]()})


@monthly_routes_bp.post("/api/monthly_routes/routes/<int:route_id>/worksheet/reset_run")
def post_monthly_route_worksheet_reset_run(route_id: int):
    """Clear all run-scoped worksheet data for one route-month.

    Removes audit history, testing outcomes, run comments, field edits, and per-location billing
    decisions made during the run (legacy billing is preserved); re-seeds stop-month rows from
    library master. Clears ``MonthlyRouteRun.started_at`` so the portal shows Start Run again.
    """
    month_raw = (request.args.get("month") or "").strip()
    month_dt = _parse_month(month_raw)
    if month_dt is None:
        return jsonify({"error": "Invalid or missing month query param (use YYYY-MM-DD, first of month)"}), 400
    month_first = date(month_dt.year, month_dt.month, 1)
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    if _portal_worksheet_lazy_request():
        run_gate = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id,
            month_date=month_first,
        ).one_or_none()
        if run_gate is None:
            return (
                jsonify(
                    {
                        "error": "Run not started for this month.",
                        "code": "run_not_started",
                    }
                ),
                400,
            )

    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is not None and _run_explicitly_completed(run):
        return (
            jsonify(
                {
                    "error": "This run is completed; reopen it before resetting.",
                    "code": "run_completed",
                }
            ),
            409,
        )

    if run is not None:
        from app.monthly.run_workflow import clear_workflow_on_reset

        clear_workflow_on_reset(run)
        run.pre_run_message = None

    from app.monthly.worksheet_stops import reset_worksheet_run_for_route_month

    reset_stats = reset_worksheet_run_for_route_month(route_id, month_first, run)

    db.session.commit()

    payload_out = _serialize_technician_worksheet_payload(
        route_id,
        month_first,
        portal_lazy_run=_portal_worksheet_lazy_request(),
    )
    if payload_out is None:
        return jsonify({"error": "Route not found"}), 404

    return jsonify(
        {
            "ok": True,
            "cleared_rows": reset_stats["cleared_history_rows"],
            "preserved_annual_skip_rows": 0,
            "cleared_stops": reset_stats["reseeded_stops"],
            "preserved_annual_skip_stops": 0,
            "deleted_audit_events": reset_stats["deleted_audit_events"],
            "mirrored_library_locations": reset_stats["mirrored_library_locations"],
            "worksheet": payload_out,
        }
    )


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


_RUN_CSV_MAX_BYTES = 5 * 1024 * 1024  # 5 MB ceiling on uploaded inspection CSVs.


def _multipart_form_bool(name: str) -> bool:
    raw = (request.form.get(name) or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


@monthly_routes_bp.post("/api/monthly_routes/routes/<int:route_id>/runs/import_csv")
def import_route_run_csv(route_id: int):
    """Upload a technician inspection CSV and materialize a run for ``route_id``.

    Validates that the CSV's preamble route number matches ``route_id`` (otherwise
    400). The importer merges with the technician portal: existing
    ``MonthlyRouteTestHistory`` rows that already carry a ``result_status``
    (tested/skipped from the worksheet) keep their status, ``skip_reason``,
    ``time_in``, ``time_out`` and ``source_value_raw``; CSV-only snapshot fields
    (FACP, ring, key, annual, monitoring, procedures, notes, session order,
    ``run_id``) always overwrite. ``rows_without_history_signal`` counts CSV
    rows whose sheet times did not classify as tested/skipped (irrelevant when
    the existing row already carried a status); ``existing_status_preserved``
    counts rows where a tech-set status was kept.
    """
    if not session.get("username"):
        return jsonify({"error": "Session username required"}), 401

    route = _get_monthly_route(route_id)
    if route is None:
        return jsonify({"error": "Route not found"}), 404

    upload = request.files.get("file") or request.files.get("csv")
    if upload is None or not upload.filename:
        return jsonify({"error": "Missing file (multipart field 'file')"}), 400
    csv_bytes = upload.read()
    if not csv_bytes:
        return jsonify({"error": "Uploaded CSV is empty"}), 400
    if len(csv_bytes) > _RUN_CSV_MAX_BYTES:
        return (
            jsonify(
                {
                    "error": (
                        f"Uploaded CSV is too large ({len(csv_bytes):,} bytes); "
                        f"limit is {_RUN_CSV_MAX_BYTES:,}."
                    )
                }
            ),
            413,
        )

    try:
        preamble = parse_preamble_only(csv_bytes)
    except ValueError as e:
        return jsonify({"error": f"Could not parse CSV header: {e}"}), 400

    if preamble.route_number is None:
        return (
            jsonify(
                {
                    "error": (
                        "CSV preamble is missing a 'ROUTE:' row identifying the route number "
                        "(e.g. 'Route 8'). Re-export the technician sheet."
                    )
                }
            ),
            400,
        )
    if preamble.month_date is None:
        return (
            jsonify(
                {
                    "error": (
                        "CSV preamble is missing a 'DATE:' row with month + year "
                        "(e.g. 'April' / '2026')."
                    )
                }
            ),
            400,
        )
    if int(preamble.route_number) != int(route.route_number):
        return (
            jsonify(
                {
                    "error": (
                        f"CSV is for Route {preamble.route_number} but you uploaded it on "
                        f"the page for Route {route.route_number}. Open the matching route "
                        "page or re-export the CSV."
                    ),
                    "csv_route_number": int(preamble.route_number),
                    "page_route_number": int(route.route_number),
                }
            ),
            400,
        )

    month_first = preamble.month_date

    run = get_or_create_monthly_route_run(
        int(route.id), month_first, source="csv_import"
    )
    from app.monthly.run_workflow import mark_run_prepared

    mark_run_prepared(run, username="csv_import", now=datetime.now(PACIFIC_TZ))

    if _run_explicitly_completed(run):
        return (
            jsonify(
                {
                    "error": (
                        "This month's run is marked completed. Upload a CSV again only "
                        "after staff reopens the run from the worksheet."
                    ),
                    "code": "run_completed_csv_blocked",
                }
            ),
            409,
        )

    sync_stop_order = _multipart_form_bool("sync_stop_order")

    try:
        result = run_route_inspection_csv_import(
            csv_bytes=csv_bytes,
            run=run,
            route=route,
            month_date=month_first,
            dry_run=False,
            sync_stop_order=sync_stop_order,
        )
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": f"CSV parse error: {e}"}), 400

    from app.monthly.worksheet_stops import (
        apply_session_stop_order_from_history_for_route_month,
        ensure_worksheet_stops_for_route_month,
    )

    ensure_worksheet_stops_for_route_month(int(route.id), month_first, run)
    session_stop_order_applied = 0
    if sync_stop_order:
        session_stop_order_applied = apply_session_stop_order_from_history_for_route_month(
            int(route.id),
            month_first,
        )

    from app.monthly.field_submission import capture_field_submission_for_run
    from app.monthly.run_workflow import (
        close_historical_run_from_csv_import,
        is_historical_run_month,
    )

    historical_closed = False
    if is_historical_run_month(month_first):
        now = datetime.now(PACIFIC_TZ)
        close_historical_run_from_csv_import(
            run,
            username=str(session.get("username") or "csv_import"),
            now=now,
        )
        capture_field_submission_for_run(run, captured_at=now)
        historical_closed = True

    db.session.commit()

    return jsonify(
        {
            "ok": True,
            "route": _serialize_monthly_route_entity(route),
            "month_date": month_first.isoformat(),
            "run": _serialize_run(run),
            "historical_run_closed": historical_closed,
            "sheet_label": result.sheet_label,
            "locations_updated": result.locations_updated,
            "history_upserts": result.history_upserts,
            "rows_without_history_signal": result.skipped_no_history,
            "existing_status_preserved": result.existing_status_preserved,
            "sync_stop_order": sync_stop_order,
            "stop_order_applied": result.stop_order_applied,
            "stop_order_skipped_not_on_sheet_route": result.stop_order_skipped_not_on_sheet_route,
            "session_stop_order_applied": session_stop_order_applied,
            "issues": [
                {"kind": i.kind, "csv_row": i.csv_row, "detail": i.detail}
                for i in result.issues
            ],
        }
    )


def _load_run_for_lifecycle(
    route_id: int,
    month_first: date | None,
) -> tuple[MonthlyRoute | None, MonthlyRouteRun | None, tuple[object, int] | None]:
    if month_first is None:
        return None, None, (jsonify({"error": "month_date required (YYYY-MM-01)"}), 400)
    route = _get_monthly_route(route_id)
    if route is None:
        return None, None, (jsonify({"error": "Route not found"}), 404)
    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is None:
        return route, None, (jsonify({"error": "No run for this route/month"}), 404)
    return route, run, None


@monthly_routes_bp.post("/api/monthly_routes/routes/<int:route_id>/runs/prepare")
def post_monthly_route_run_prepare(route_id: int):
    """Office: release route-month for technician Start Run."""
    username = session.get("username")
    if not username:
        return jsonify({"error": "Session username required"}), 401

    data = request.get_json(silent=True) or {}
    month_first = _parse_month(data.get("month_date"))
    if month_first is None:
        return jsonify({"error": "month_date required (YYYY-MM-01)"}), 400
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is None:
        from app.monthly.runs import get_or_create_monthly_route_run

        run = get_or_create_monthly_route_run(
            route_id,
            month_first,
            source="office_manual",
        )

    if _run_explicitly_completed(run):
        return (
            jsonify(
                {
                    "error": "This run is completed; reopen it before preparing again.",
                    "code": "run_completed",
                }
            ),
            409,
        )

    blocked = _reject_if_future_month_prep_blocked(route_id, month_first)
    if blocked is not None:
        return blocked

    from app.monthly.run_workflow import mark_run_prepared

    now = datetime.now(PACIFIC_TZ)
    mark_run_prepared(run, username=str(username), now=now)
    from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month

    ensure_worksheet_stops_for_route_month(route_id, month_first, run)
    db.session.add(run)
    db.session.commit()
    return jsonify({"ok": True, "run": _serialize_run(run)})


@monthly_routes_bp.post("/api/monthly_routes/routes/<int:route_id>/runs/regenerate_prep_stops")
def post_monthly_route_regenerate_prep_stops(route_id: int):
    """Office prep: re-seed stop-month snapshots from library master and prior run month."""
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    month_first = _parse_month(data.get("month_date"))
    if month_first is None:
        return jsonify({"error": "month_date required (YYYY-MM-01)"}), 400
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is None:
        from app.monthly.runs import get_or_create_monthly_route_run

        run = get_or_create_monthly_route_run(
            route_id,
            month_first,
            source="office_manual",
        )
        db.session.flush()

    if _run_explicitly_completed(run):
        return (
            jsonify(
                {
                    "error": "This run is completed; reopen it before regenerating prep stops.",
                    "code": "run_completed",
                }
            ),
            409,
        )

    from app.monthly.run_workflow import run_in_office_prep_phase

    if not run_in_office_prep_phase(run):
        return (
            jsonify(
                {
                    "error": "Prep stops can only be regenerated before field work starts.",
                    "code": "run_prep_locked",
                }
            ),
            409,
        )

    blocked = _reject_if_future_month_prep_blocked(route_id, month_first)
    if blocked is not None:
        return blocked

    from app.monthly.worksheet_stops import (
        ensure_worksheet_stops_for_route_month,
        regenerate_prep_stops_from_latest_data,
    )

    ensure_worksheet_stops_for_route_month(route_id, month_first, run)
    stops_regenerated = regenerate_prep_stops_from_latest_data(route_id, month_first, run)
    db.session.commit()
    return jsonify(
        {
            "ok": True,
            "stops_regenerated": stops_regenerated,
            "run": _serialize_run(run),
        }
    )


@monthly_routes_bp.post("/api/monthly_routes/routes/<int:route_id>/runs/unprepare")
def post_monthly_route_run_unprepare(route_id: int):
    """Office: return a prepared run to prep (before field work starts)."""
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    month_first = _parse_month(data.get("month_date"))
    if month_first is None:
        return jsonify({"error": "month_date required (YYYY-MM-01)"}), 400
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is None:
        return jsonify({"error": "No run file for this route and month.", "code": "run_not_found"}), 404

    from app.monthly.run_workflow import clear_run_prepared, office_may_unprepare_run

    if not office_may_unprepare_run(run):
        if _run_explicitly_completed(run):
            code = "run_completed"
            message = "This run is completed; reopen it before returning to prep."
        elif run.started_at is not None:
            code = "run_field_started"
            message = (
                "Technicians have already started this run; reset field work before returning to prep."
            )
        else:
            code = "run_not_prepared"
            message = "This run is not marked prepared."
        return jsonify({"error": message, "code": code}), 409

    clear_run_prepared(run)
    db.session.add(run)
    db.session.commit()
    return jsonify({"ok": True, "run": _serialize_run(run)})


@monthly_routes_bp.patch("/api/monthly_routes/routes/<int:route_id>/runs")
def patch_monthly_route_run(route_id: int):
    """Office: set/clear pre-run message for technicians (prep phase only)."""
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    if "pre_run_message" not in data:
        return jsonify({"error": "pre_run_message required"}), 400
    month_first = _parse_month(data.get("month_date"))
    if month_first is None:
        return jsonify({"error": "month_date required (YYYY-MM-01)"}), 400
    if _get_monthly_route(route_id) is None:
        return jsonify({"error": "Route not found"}), 404

    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is None:
        from app.monthly.runs import get_or_create_monthly_route_run

        run = get_or_create_monthly_route_run(
            route_id,
            month_first,
            source="office_manual",
        )

    from app.monthly.run_workflow import run_explicitly_completed, run_in_office_prep_phase

    if run_explicitly_completed(run):
        return (
            jsonify(
                {
                    "error": "This run is completed; reopen it before editing the pre-run message.",
                    "code": "run_completed",
                }
            ),
            409,
        )
    if not run_in_office_prep_phase(run):
        return (
            jsonify(
                {
                    "error": "Pre-run message can only be edited before field work starts.",
                    "code": "run_prep_locked",
                }
            ),
            409,
        )

    blocked = _reject_if_future_month_prep_blocked(route_id, month_first)
    if blocked is not None:
        return blocked

    raw = data.get("pre_run_message")
    if raw is None:
        run.pre_run_message = None
    else:
        text = str(raw).strip()
        run.pre_run_message = text or None
    db.session.add(run)
    db.session.commit()
    return jsonify({"ok": True, "run": _serialize_run(run)})


@monthly_routes_bp.post("/api/monthly_routes/routes/<int:route_id>/runs/review_complete")
def post_monthly_route_run_review_complete(route_id: int):
    """Office: mark run-details review checklist complete (before final close)."""
    username = session.get("username")
    if not username:
        return jsonify({"error": "Session username required"}), 401

    data = request.get_json(silent=True) or {}
    month_first = _parse_month(data.get("month_date"))
    _route, run, err = _load_run_for_lifecycle(route_id, month_first)
    if err is not None:
        return err
    assert run is not None

    if _run_explicitly_completed(run):
        return jsonify({"ok": True, "run": _serialize_run(run)})

    if run.field_ended_at is None:
        return (
            jsonify(
                {
                    "error": "Technicians must end the field run before office review can be marked complete.",
                    "code": "field_not_ended",
                }
            ),
            409,
        )

    from app.monthly.run_workflow import count_unset_billing_for_route_month, mark_office_review_complete

    unset_billing = count_unset_billing_for_route_month(route_id, month_first)
    if unset_billing > 0:
        return (
            jsonify(
                {
                    "error": f"{unset_billing} location(s) still have billing unset. Set bill or do not bill for each site before marking review complete.",
                    "code": "billing_unset_locations",
                    "unset_count": unset_billing,
                }
            ),
            409,
        )

    now = datetime.now(PACIFIC_TZ)
    mark_office_review_complete(run, username=str(username), now=now)
    from app.monthly.field_submission import ensure_field_submission_for_run

    ensure_field_submission_for_run(run)
    db.session.add(run)
    db.session.commit()
    return jsonify({"ok": True, "run": _serialize_run(run)})


@monthly_routes_bp.post("/api/monthly_routes/routes/<int:route_id>/runs/complete")
def post_monthly_route_run_complete(route_id: int):
    """Mark the run for ``month_date`` finished (office); enables worksheet historical lock via status."""
    username = session.get("username")
    if not username:
        return jsonify({"error": "Session username required"}), 401

    data = request.get_json(silent=True) or {}
    month_first = _parse_month(data.get("month_date"))
    _route, run, err = _load_run_for_lifecycle(route_id, month_first)
    if err is not None:
        return err
    assert run is not None

    if _run_explicitly_completed(run):
        return jsonify({"ok": True, "run": _serialize_run(run)})

    if run.office_review_completed_at is None:
        return (
            jsonify(
                {
                    "error": "Mark office review complete before closing the run.",
                    "code": "office_review_required",
                }
            ),
            409,
        )

    from app.monthly.run_workflow import count_unset_billing_for_route_month

    unset_billing = count_unset_billing_for_route_month(route_id, month_first)

    now = datetime.now(PACIFIC_TZ)
    run.status = "completed"
    run.completed_at = now
    from app.monthly.field_submission import ensure_field_submission_for_run

    ensure_field_submission_for_run(run)
    db.session.add(run)
    db.session.commit()
    body: dict[str, object] = {"ok": True, "run": _serialize_run(run)}
    if unset_billing > 0:
        body["warnings"] = [
            {
                "code": "billing_unset_locations",
                "message": f"{unset_billing} location(s) still have billing unset.",
                "unset_count": unset_billing,
            }
        ]
    return jsonify(body)


@monthly_routes_bp.post("/api/monthly_routes/routes/<int:route_id>/runs/reopen")
def post_monthly_route_run_reopen(route_id: int):
    """Clear office completion so the month can be edited and replaced via CSV import again."""
    username = session.get("username")
    if not username:
        return jsonify({"error": "Session username required"}), 401

    data = request.get_json(silent=True) or {}
    month_first = _parse_month(data.get("month_date"))
    _route, run, err = _load_run_for_lifecycle(route_id, month_first)
    if err is not None:
        return err
    assert run is not None

    if not _run_explicitly_completed(run):
        return jsonify({"ok": True, "run": _serialize_run(run)})

    from app.monthly.run_workflow import clear_office_completion

    clear_office_completion(run)
    db.session.add(run)
    db.session.commit()
    return jsonify({"ok": True, "run": _serialize_run(run)})


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

    invalidate_monthly_route_path(route_id)
    db.session.commit()

    route_locations = (
        MonthlyRouteLocation.query.options(
            joinedload(MonthlyRouteLocation.monthly_site).selectinload(MonthlySite.testing_sites)
        )
        .filter_by(monthly_route_id=route_id)
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
        sync_testing_sites_from_legacy(loc)
        push_legacy_keys_to_primary_testing_site(loc)
        invalidate_monthly_route_path(loc.monthly_route_id)
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
            invalidate_monthly_route_path(prev_mr_id)
            invalidate_monthly_route_path(loc.monthly_route_id)
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

        sync_testing_sites_from_legacy(loc)
        if {"keys", "barcode", "key_id"}.intersection(payload.keys()):
            push_legacy_keys_to_primary_testing_site(loc)
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
    invalidate_monthly_route_path(loc.monthly_route_id)
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
        invalidate_monthly_route_path(prev_mr_id)
        invalidate_monthly_route_path(loc.monthly_route_id)
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
    invalidate_monthly_route_path(loc.monthly_route_id)
    db.session.delete(loc)
    db.session.commit()
    return ("", 204)

