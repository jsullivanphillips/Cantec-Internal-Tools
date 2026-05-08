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
from sqlalchemy import func

from app.db_models import MonthlyRoute, MonthlyRouteLocation, MonthlyRouteRun, db


technician_portal_bp = Blueprint("technician_portal", __name__, url_prefix="/api/technician_portal")

PACIFIC_TZ = ZoneInfo("America/Vancouver")

PORTAL_PIN_ENV = "TECHNICIAN_PORTAL_PIN"
SESSION_FLAG = "tech_portal_unlocked"


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
    session[SESSION_FLAG] = True
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
        }
    )


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
            MonthlyRouteLocation.monthly_route_id,
            func.count(MonthlyRouteLocation.id),
        )
        .filter(MonthlyRouteLocation.monthly_route_id.in_(route_ids))
        .group_by(MonthlyRouteLocation.monthly_route_id)
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


@technician_portal_bp.get("/routes_lookup")
def portal_routes_lookup():
    """Look up a single route by ``route_number`` so techs can open off-schedule routes."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    raw = (request.args.get("route_number") or "").strip()
    if not raw:
        return jsonify({"error": "route_number required"}), 400
    try:
        rn = int(raw)
    except ValueError:
        return jsonify({"error": "route_number must be an integer"}), 400
    mr = MonthlyRoute.query.filter_by(route_number=rn).one_or_none()
    if mr is None:
        return jsonify({"error": "Route not found", "code": "not_found"}), 404
    counts = _location_counts_for([int(mr.id)])
    return jsonify(
        {"route": _serialize_route_for_portal(mr, location_count=counts.get(int(mr.id), 0))}
    )


@technician_portal_bp.get("/routes/<int:route_id>/portal_route_summary")
def portal_route_summary(route_id: int):
    """Route hub: today's Pacific month, optional current-month run, prior runs for worksheet picks."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.routes.monthly_routes import _current_pacific_month_first, _serialize_run

    mr = MonthlyRoute.query.filter_by(id=route_id).one_or_none()
    if mr is None:
        return jsonify({"error": "Route not found", "code": "not_found"}), 404
    counts = _location_counts_for([int(mr.id)])
    month_first = _current_pacific_month_first()
    current_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    prior_runs = (
        MonthlyRouteRun.query.filter(
            MonthlyRouteRun.monthly_route_id == route_id,
            MonthlyRouteRun.month_date < month_first,
        )
        .order_by(MonthlyRouteRun.month_date.desc())
        .all()
    )
    return jsonify(
        {
            "route": _serialize_route_for_portal(mr, location_count=counts.get(int(mr.id), 0)),
            "current_month_first": month_first.isoformat(),
            "current_month_run": _serialize_run(current_run),
            "prior_runs": [_serialize_run(r) for r in prior_runs],
        }
    )


@technician_portal_bp.post("/routes/<int:route_id>/runs")
def portal_start_current_month_run(route_id: int):
    """Materialize (idempotently) the Pacific current-month run and worksheet rows."""
    if not session.get(SESSION_FLAG):
        return jsonify({"error": "Portal locked", "code": "portal_locked"}), 401
    from app.routes.monthly_routes import (
        _current_pacific_month_first,
        _ensure_worksheet_rows_for_route_month,
        _serialize_run,
    )

    mr = MonthlyRoute.query.filter_by(id=route_id).one_or_none()
    if mr is None:
        return jsonify({"error": "Route not found", "code": "not_found"}), 404
    month_first = _current_pacific_month_first()
    run = _ensure_worksheet_rows_for_route_month(
        route_id,
        month_first,
        create_run_if_missing=True,
    )
    assert run is not None
    return jsonify({"run": _serialize_run(run)})
