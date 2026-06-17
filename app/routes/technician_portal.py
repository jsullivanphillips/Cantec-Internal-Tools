"""
Technician portal: PIN-gated public surface so field techs can pick today's
monthly route and open the worksheet without a staff login.

Auth model:
- A single shared PIN, configured via env var ``TECHNICIAN_PORTAL_PIN``.
- On successful PIN entry we set ``session['tech_portal_unlocked'] = True``.
- The API auth gate (``app/api_auth_gate.py``) reads that flag to allow
  technicians to call the worksheet endpoints without staff credentials.

This blueprint intentionally captures no per-technician identity in V1;
worksheet PATCH calls already record ``source='technician_app'`` for audit.
"""
from __future__ import annotations

import hmac
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request, session
from sqlalchemy import String, case, cast, func

from app.db_models import MonthlyRoute, MonthlyLocation, MonthlyRouteRun, db


technician_portal_bp = Blueprint("technician_portal", __name__, url_prefix="/api/technician_portal")

PACIFIC_TZ = ZoneInfo("America/Vancouver")

PORTAL_PIN_ENV = "TECHNICIAN_PORTAL_PIN"
SESSION_FLAG = "tech_portal_unlocked"
SESSION_TECH_ID = "portal_tech_id"
SESSION_TECH_NAME = "portal_tech_name"

_TECHNICIANS_CACHE: dict[str, object] = {"expires_at": 0.0, "data": []}
_TECHNICIANS_CACHE_TTL_SEC = 3600


def _today_local() -> date:
    """Pacific-local 'today' to match how monthly route schedules are computed elsewhere."""
    return datetime.now(PACIFIC_TZ).date()


def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _week_occurrence_for(d: date) -> int:
    """1-based n-th occurrence of this weekday within ``d``'s calendar month."""
    return ((d.day - 1) // 7) + 1


def _normalize_portal_route_number_token(raw: str) -> str | None:
    """Strip optional ``R``/``r`` prefix; return digit-only string (no leading zeros), or ``None``."""
    s = (raw or "").strip()
    if not s:
        return None
    if s[0].upper() == "R":
        s = s[1:].strip()
    if not s or not s.isdigit():
        return None
    collapsed = s.lstrip("0")
    return collapsed if collapsed else "0"


def _portal_pin_configured() -> str | None:
    raw = os.environ.get(PORTAL_PIN_ENV)
    if raw is None:
        return None
    pin = raw.strip()
    return pin or None


def is_portal_unlocked() -> bool:
    """Module helper used by app.api_auth_gate to extend exemptions."""
    try:
        return bool(session.get(SESSION_FLAG))
    except RuntimeError:
        return False


@technician_portal_bp.post("/auth")
def portal_auth():
    configured = _portal_pin_configured()
    if not configured:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "Technician portal is not configured.",
                    "code": "portal_disabled",
                }
            ),
            503,
        )
    data = request.get_json(silent=True) or {}
    submitted = (data.get("pin") or "").strip()
    if not submitted:
        return jsonify({"ok": False, "error": "PIN required"}), 400
    if not hmac.compare_digest(submitted, configured):
        session.pop(SESSION_FLAG, None)
        return jsonify({"ok": False, "error": "Invalid PIN"}), 401
    session.permanent = True
    session[SESSION_FLAG] = True
    session.modified = True
    return jsonify({"ok": True})


@technician_portal_bp.post("/logout")
def portal_logout():
    session.pop(SESSION_FLAG, None)
    return jsonify({"ok": True})


@technician_portal_bp.get("/me")
def portal_me():
    return jsonify(
        {
            "unlocked": bool(session.get(SESSION_FLAG)),
            "configured": _portal_pin_configured() is not None,
            "technician": _session_technician_payload(),
        }
    )


def _session_technician_payload() -> dict[str, object] | None:
    tech_id = session.get(SESSION_TECH_ID)
    tech_name = session.get(SESSION_TECH_NAME)
    if not tech_id and not tech_name:
        return None
    return {
        "id": str(tech_id) if tech_id is not None else None,
        "name": str(tech_name) if tech_name is not None else None,
    }


def _cached_active_technicians() -> list[dict[str, object]]:
    import time as time_mod

    from app.monthly.portal_workflow import SHOP_TECH_ID, SHOP_TECH_NAME

    now = time_mod.time()
    if now < float(_TECHNICIANS_CACHE.get("expires_at") or 0):
        cached = _TECHNICIANS_CACHE.get("data")
        if isinstance(cached, list):
            return cached

    slim: list[dict[str, object]] = []
    try:
        from app.routes.scheduling_attack import get_active_techs

        for t in get_active_techs() or []:
            tech_id = t.get("id")
            name = (t.get("name") or "").strip()
            if tech_id and name:
                slim.append({"id": str(tech_id), "name": name})
        slim.sort(key=lambda x: str(x.get("name", "")).lower())
    except Exception:
        slim = []

    if not slim:
        slim = [{"id": SHOP_TECH_ID, "name": SHOP_TECH_NAME}]

    _TECHNICIANS_CACHE["data"] = slim
    _TECHNICIANS_CACHE["expires_at"] = now + _TECHNICIANS_CACHE_TTL_SEC
    return slim


@technician_portal_bp.get("/technicians")
def portal_technicians():
    return jsonify({"technicians": _cached_active_technicians()})


@technician_portal_bp.get("/session/technician")
def portal_get_session_technician():
    tech = _session_technician_payload()
    if tech is None:
        return jsonify({"technician": None}), 404
    return jsonify({"technician": tech})


@technician_portal_bp.post("/session/technician")
def portal_set_session_technician():
    data = request.get_json(silent=True) or {}
    tech_id = (data.get("id") or data.get("tech_id") or "").strip()
    tech_name = (data.get("name") or data.get("tech_name") or "").strip()
    if not tech_id or not tech_name:
        return jsonify({"error": "id and name are required"}), 400
    session[SESSION_TECH_ID] = tech_id
    session[SESSION_TECH_NAME] = tech_name
    session.modified = True
    return jsonify({"ok": True, "technician": {"id": tech_id, "name": tech_name}})


def _serialize_route_for_portal(mr: MonthlyRoute, *, location_count: int) -> dict[str, object]:
    """Subset of MonthlyRouteSummary fields the portal start page needs."""
    wd_names = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    wd = (
        wd_names[mr.weekday_iso]
        if isinstance(mr.weekday_iso, int) and 0 <= mr.weekday_iso <= 6
        else "?"
    )
    occ = int(mr.week_occurrence) if mr.week_occurrence is not None else 0
    nth_suffix = "th"
    if not (11 <= (occ % 100) <= 13):
        nth_suffix = {1: "st", 2: "nd", 3: "rd"}.get(occ % 10, "th")
    nth = f"{occ}{nth_suffix}" if occ >= 1 else str(occ)
    label = f"R{mr.route_number} · {nth} {wd}"
    return {
        "id": int(mr.id),
        "route_number": int(mr.route_number),
        "display_name": (mr.display_name or "").strip() or None,
        "weekday_iso": mr.weekday_iso,
        "week_occurrence": mr.week_occurrence,
        "label": label,
        "location_count": int(location_count),
    }


def _location_counts_for(route_ids: list[int]) -> dict[int, int]:
    if not route_ids:
        return {}
    rows = (
        db.session.query(
            MonthlyLocation.monthly_route_id,
            func.count(MonthlyLocation.id),
        )
        .filter(MonthlyLocation.monthly_route_id.in_(route_ids))
        .group_by(MonthlyLocation.monthly_route_id)
        .all()
    )
    return {int(rid): int(n) for rid, n in rows if rid is not None}


@technician_portal_bp.get("/routes_today")
def portal_routes_today():
    """Routes whose ``(weekday_iso, week_occurrence)`` matches the requested or current date."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    override = _parse_iso_date(request.args.get("date"))
    today = override or _today_local()
    wd = today.weekday()
    occ = _week_occurrence_for(today)
    routes = (
        MonthlyRoute.query.filter(
            MonthlyRoute.weekday_iso == wd,
            MonthlyRoute.week_occurrence == occ,
        )
        .order_by(MonthlyRoute.route_number.asc())
        .all()
    )
    counts = _location_counts_for([int(r.id) for r in routes])
    payload = [
        _serialize_route_for_portal(r, location_count=counts.get(int(r.id), 0))
        for r in routes
    ]
    return jsonify(
        {
            "date": today.isoformat(),
            "weekday_iso": wd,
            "week_occurrence": occ,
            "routes": payload,
        }
    )


@technician_portal_bp.get("/routes_suggest")
def portal_routes_suggest():
    """Return up to 5 routes whose ``route_number`` string starts with the typed digits.

    Exact numeric match is sorted first (e.g. ``q=1`` yields R1 before R12).
    Accepts ``R18`` or ``18`` in ``q``.
    """
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    raw = (request.args.get("q") or "").strip()
    prefix = _normalize_portal_route_number_token(raw)
    if not prefix:
        return jsonify({"routes": []})

    rn_text = cast(MonthlyRoute.route_number, String)
    qry = MonthlyRoute.query.filter(rn_text.like(f"{prefix}%"))
    exact = int(prefix)
    primary = case((MonthlyRoute.route_number == exact, 0), else_=1)
    rows = (
        qry.order_by(primary.asc(), MonthlyRoute.route_number.asc()).limit(5).all()
    )
    ids = [int(r.id) for r in rows]
    counts = _location_counts_for(ids)
    return jsonify(
        {
            "routes": [
                _serialize_route_for_portal(r, location_count=counts.get(int(r.id), 0))
                for r in rows
            ]
        }
    )


@technician_portal_bp.get("/routes_lookup")
def portal_routes_lookup():
    """Look up a single route by ``route_number`` so techs can open off-schedule routes."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    raw = (request.args.get("route_number") or "").strip()
    token = _normalize_portal_route_number_token(raw)
    if token is None:
        return jsonify({"error": "route_number required"}), 400
    try:
        rn = int(token)
    except ValueError:
        return jsonify({"error": "route_number must be an integer"}), 400
    mr = MonthlyRoute.query.filter_by(route_number=rn).one_or_none()
    if mr is None:
        return jsonify({"error": "Route not found", "code": "not_found"}), 404
    counts = _location_counts_for([int(mr.id)])
    return jsonify(
        {"route": _serialize_route_for_portal(mr, location_count=counts.get(int(mr.id), 0))}
    )


@technician_portal_bp.get("/locations_suggest")
def portal_locations_suggest():
    """Return up to 8 active monthly locations matching ``q`` (min length 2)."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.monthly.portal_location_reference import (
        search_active_locations_for_portal,
        serialize_portal_location_suggest,
    )

    raw = (request.args.get("q") or "").strip()
    rows = search_active_locations_for_portal(raw, limit=8)
    return jsonify({"locations": [serialize_portal_location_suggest(loc) for loc in rows]})


@technician_portal_bp.get("/locations/<int:location_id>")
def portal_location_reference(location_id: int):
    """Read-only field reference for a single monthly library location."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.monthly.portal_location_reference import (
        get_portal_location_reference,
        serialize_portal_location_reference,
    )

    loc = get_portal_location_reference(location_id)
    if loc is None:
        return jsonify({"error": "Location not found", "code": "not_found"}), 404
    return jsonify({"location": serialize_portal_location_reference(loc)})


@technician_portal_bp.get("/locations/<int:location_id>/test_history_index")
def portal_location_test_history_index(location_id: int):
    """Month index for portal site history modal (route ids + field submission availability)."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.monthly.portal_test_history import serialize_portal_test_history_index

    payload = serialize_portal_test_history_index(location_id)
    if payload is None:
        return jsonify({"error": "Location not found", "code": "not_found"}), 404
    return jsonify(payload)


@technician_portal_bp.get("/routes/<int:route_id>/portal_route_summary")
def portal_route_summary(route_id: int):
    """Route hub: portal primary month (may promote next month after office close), prior runs."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.monthly.run_workflow import resolve_portal_route_summary_months
    from app.routes.monthly_routes import _serialize_run

    mr = MonthlyRoute.query.filter_by(id=route_id).one_or_none()
    if mr is None:
        return jsonify({"error": "Route not found", "code": "not_found"}), 404
    counts = _location_counts_for([int(mr.id)])
    (
        calendar_month,
        primary_month,
        primary_run,
        awaiting_office_prepare,
        prior_runs,
    ) = resolve_portal_route_summary_months(route_id)
    return jsonify(
        {
            "route": _serialize_route_for_portal(mr, location_count=counts.get(int(mr.id), 0)),
            "calendar_month_first": calendar_month.isoformat(),
            "current_month_first": primary_month.isoformat(),
            "current_month_run": _serialize_run(primary_run),
            "awaiting_office_prepare": bool(awaiting_office_prepare),
            "prior_runs": [_serialize_run(r) for r in prior_runs],
        }
    )


@technician_portal_bp.post("/routes/<int:route_id>/runs")
def portal_start_current_month_run(route_id: int):
    """Materialize (idempotently) the Pacific current-month run and worksheet rows."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.monthly.worksheet_locations import (
        ensure_worksheet_stops_for_route_month,
        route_month_has_worksheet_stops,
    )
    from app.routes.monthly_routes import (
        _current_pacific_month_first,
        _serialize_run,
    )

    from app.monthly.run_workflow import run_explicitly_completed, run_is_prepared

    mr = MonthlyRoute.query.filter_by(id=route_id).one_or_none()
    if mr is None:
        return jsonify({"error": "Route not found", "code": "not_found"}), 404
    month_first = _current_pacific_month_first()
    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is not None and run_explicitly_completed(run):
        return (
            jsonify(
                {
                    "error": "This run is closed by the office.",
                    "code": "run_completed_locked",
                }
            ),
            409,
        )
    if run is None or not run_is_prepared(run):
        return (
            jsonify(
                {
                    "error": "Office has not released this route for testing yet.",
                    "code": "run_not_prepared",
                }
            ),
            409,
        )
    if not route_month_has_worksheet_stops(route_id, month_first):
        ensure_worksheet_stops_for_route_month(route_id, month_first, run)
    now = datetime.now(PACIFIC_TZ)
    if run.started_at is None:
        run.started_at = now
    db.session.add(run)
    db.session.commit()
    return jsonify({"run": _serialize_run(run)})


@technician_portal_bp.post("/routes/<int:route_id>/regenerate_paperwork")
def portal_regenerate_current_month_paperwork(route_id: int):
    """Refresh current-month stop paperwork from office master and prior run data.

    Does not clear tested/skipped outcomes, clock times, or run comments. Blocked when
    the current-month run is completed (office must reopen first).
    """
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.monthly.worksheet_locations import refresh_worksheet_stops_for_route_month
    from app.routes.monthly_routes import (
        _current_pacific_month_first,
        _ensure_worksheet_rows_for_route_month,
        _run_explicitly_completed,
        _serialize_run,
    )

    mr = MonthlyRoute.query.filter_by(id=route_id).one_or_none()
    if mr is None:
        return jsonify({"error": "Route not found", "code": "not_found"}), 404

    month_first = _current_pacific_month_first()
    existing_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if existing_run is not None and _run_explicitly_completed(existing_run):
        return (
            jsonify(
                {
                    "error": (
                        "This month's run is completed. Ask the office to reopen it "
                        "before refreshing paperwork."
                    ),
                    "code": "run_completed",
                }
            ),
            409,
        )

    run = _ensure_worksheet_rows_for_route_month(
        route_id,
        month_first,
        create_run_if_missing=True,
    )
    assert run is not None
    stops_created, stops_refreshed = refresh_worksheet_stops_for_route_month(
        route_id,
        month_first,
        run,
    )
    db.session.commit()
    return jsonify(
        {
            "ok": True,
            "month_date": month_first.isoformat(),
            "run": _serialize_run(run),
            "stops_created": stops_created,
            "stops_refreshed": stops_refreshed,
        }
    )


@technician_portal_bp.post("/routes/<int:route_id>/runs/end")
def portal_end_current_month_run(route_id: int):
    """Technicians end active field work; portal edits lock until field is reopened."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.routes.monthly_routes import (
        _current_pacific_month_first,
        _run_explicitly_completed,
        _serialize_run,
    )
    from app.monthly.run_workflow import mark_field_ended

    mr = MonthlyRoute.query.filter_by(id=route_id).one_or_none()
    if mr is None:
        return jsonify({"error": "Route not found", "code": "not_found"}), 404

    month_first = _current_pacific_month_first()
    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is None or run.started_at is None:
        return (
            jsonify(
                {
                    "error": "Start the run before ending field work.",
                    "code": "run_not_started",
                }
            ),
            409,
        )
    if _run_explicitly_completed(run):
        return (
            jsonify(
                {
                    "error": "This run is completed. Ask the office to reopen the job.",
                    "code": "run_completed",
                }
            ),
            409,
        )
    if run.field_ended_at is not None:
        db.session.add(run)
        db.session.commit()
        return jsonify({"ok": True, "run": _serialize_run(run)})

    now = datetime.now(PACIFIC_TZ)
    mark_field_ended(run, now=now)
    db.session.add(run)
    db.session.commit()
    return jsonify({"ok": True, "run": _serialize_run(run)})


@technician_portal_bp.post("/routes/<int:route_id>/runs/reopen_field")
def portal_reopen_field_for_current_month(route_id: int):
    """Technicians reopen the field phase (clears field end and office review-complete)."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.routes.monthly_routes import (
        _current_pacific_month_first,
        _run_explicitly_completed,
        _serialize_run,
    )
    from app.monthly.run_workflow import clear_field_ended

    mr = MonthlyRoute.query.filter_by(id=route_id).one_or_none()
    if mr is None:
        return jsonify({"error": "Route not found", "code": "not_found"}), 404

    month_first = _current_pacific_month_first()
    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if run is None:
        return jsonify({"error": "No run for this month", "code": "not_found"}), 404
    if _run_explicitly_completed(run):
        return (
            jsonify(
                {
                    "error": "This run is completed. Ask the office to reopen the job.",
                    "code": "run_completed",
                }
            ),
            409,
        )
    if run.field_ended_at is None:
        return jsonify({"ok": True, "run": _serialize_run(run)})

    clear_field_ended(run)
    db.session.add(run)
    db.session.commit()
    return jsonify({"ok": True, "run": _serialize_run(run)})


@technician_portal_bp.post("/routes/<int:route_id>/runs/complete")
def portal_complete_run_for_month(route_id: int):
    """Deprecated alias: use ``POST …/runs/end`` for technician field end."""
    return portal_end_current_month_run(route_id)


@technician_portal_bp.post("/routes/<int:route_id>/runs/reopen")
def portal_reopen_run_for_month(route_id: int):
    """Deprecated alias: use ``POST …/runs/reopen_field`` for technician field reopen."""
    return portal_reopen_field_for_current_month(route_id)


@technician_portal_bp.get("/demo")
def portal_demo_route_info():
    """Training route metadata for the portal start page and worksheet banner."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.monthly.technician_demo_route import serialize_technician_demo_portal_payload

    return jsonify(serialize_technician_demo_portal_payload())


@technician_portal_bp.post("/demo/reset")
def portal_reset_demo_route():
    """Restore the training route's current month to the baseline demo scenario."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    data = request.get_json(silent=True) or {}
    if not data.get("confirm"):
        return jsonify({"error": "confirm=true is required", "code": "confirm_required"}), 400

    from app.monthly.technician_demo_route import (
        get_technician_demo_route,
        reset_technician_demo_route_month,
    )
    from app.routes.monthly_routes import _serialize_run

    run = reset_technician_demo_route_month()
    if run is None:
        return (
            jsonify(
                {
                    "error": "Training route is not seeded.",
                    "code": "demo_not_seeded",
                }
            ),
            404,
        )
    route = get_technician_demo_route()
    return jsonify(
        {
            "ok": True,
            "route": _serialize_route_for_portal(
                route,
                location_count=MonthlyLocation.query.filter_by(
                    monthly_route_id=int(route.id)
                ).count(),
            )
            if route
            else None,
            "run": _serialize_run(run),
        }
    )
