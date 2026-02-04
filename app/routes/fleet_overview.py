# app/routes/vehicle_maintenance.py
from __future__ import annotations
from flask import Blueprint, render_template, redirect, url_for, jsonify, request, current_app, abort, session
from datetime import datetime, timezone, date, timedelta
from typing import Optional, Set, Tuple
from flask import Blueprint, jsonify
from app.db_models import db, Vehicle, VehicleSubmission, VehicleServiceEvent, VehicleDeficiency
import requests

# Vehicle service status (header pill)
VALID_VEHICLE_STATUSES = {"OK", "DUE", "DEFICIENT", "BOOKED", "IN_SHOP"}

_STATUS_PRIORITY = {
    "OK": 0,
    "DUE": 1,
    "BOOKED": 2,
    "DEFICIENT": 3,
    "IN_SHOP": 4,
}

ALLOWED_FLUID_LEVELS = {"empty", "1/3", "2/3", "full"}

# NEW SPECS (required)
ALLOWED_DEFICIENCY_SEVERITIES = {"ADVISORY", "DEFICIENT", "INOPERABLE"}

# NEW SPECS (required)
ALLOWED_DEFICIENCY_STATUSES = {"OPEN", "BOOKED", "FIXED", "INVALID"}
_CLOSED_DEFICIENCY_STATUSES = {"FIXED", "INVALID"}
_OPEN_DEFICIENCY_STATUSES = {"OPEN", "BOOKED"}


fleet_bp = Blueprint("fleet", __name__, template_folder="templates")


# -----------------------------------------------------------------------------
# Page routes
# -----------------------------------------------------------------------------
@fleet_bp.get("/fleet_overview")
def fleet_overview():
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {
        "username": session.get("username"),
        "password": session.get("password"),
    }

    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception:
        return redirect(url_for("auth.login"))
    
    return render_template("fleet_overview.html")

@fleet_bp.get("/fleet/inspection")
def vehicle_inspection():
    return render_template("vehicle_inspection.html")

# -----------------------------------------------------------------------------
# GET /fleet/vehicles/<int:vehicle_id>
# Vehicle Details page (HTML)
# -----------------------------------------------------------------------------
@fleet_bp.get("/fleet/vehicles/<int:vehicle_id>")
def vehicle_details(vehicle_id: int):
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {
        "username": session.get("username"),
        "password": session.get("password"),
    }

    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception:
        return redirect(url_for("auth.login"))
    
    vehicle = db.session.get(Vehicle, vehicle_id)
    if not vehicle:
        abort(404)
    if not vehicle.is_active:
        abort(404)

    return render_template(
        "vehicle_details.html",
        vehicle_id=vehicle.id,
        page_title=f"{vehicle.make_model} ({vehicle.license_plate})",
    )


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _int_or_none(v) -> Optional[int]:
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    s = str(v).strip()
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _str_or_none(v) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _fluid_or_none(v) -> Optional[str]:
    s = _str_or_none(v)
    if not s:
        return None
    if s not in ALLOWED_FLUID_LEVELS:
        return None
    return s

def bool_or_none(val):
    """
    Safely parse a boolean-like value from JSON or form data.
    Returns:
      True / False / None
    Accepts:
      true/false, "true"/"false", "1"/"0", 1/0, "yes"/"no", "on"/"off"
    """
    if val is None:
        return None

    if isinstance(val, bool):
        return val

    if isinstance(val, (int, float)):
        return bool(val)

    if isinstance(val, str):
        v = val.strip().lower()
        if v in {"true", "1", "yes", "y", "on"}:
            return True
        if v in {"false", "0", "no", "n", "off"}:
            return False

    return None


def _def_ids_or_none(val):
    """
    Accepts:
      - missing => None
      - [] => []
      - [1,2,"3"] => [1,2,3]
    """
    if val is None:
        return None
    if not isinstance(val, list):
        return "error:not_list"
    out = []
    for x in val:
        try:
            ix = int(x)
        except (TypeError, ValueError):
            return "error:bad_id"
        if ix > 0:
            out.append(ix)
    # de-dupe while preserving order
    seen = set()
    uniq = []
    for i in out:
        if i not in seen:
            uniq.append(i)
            seen.add(i)
    return uniq


def _fetch_deficiencies_for_vehicle(def_ids, vehicle_id: int):
    """
    Returns list[VehicleDeficiency] in same order as def_ids.
    Validates they exist and belong to vehicle_id.
    """
    if not def_ids:
        return []

    rows = (
        db.session.query(VehicleDeficiency)
        .filter(
            VehicleDeficiency.id.in_(def_ids),
            VehicleDeficiency.vehicle_id == vehicle_id,
        )
        .all()
    )
    by_id = {d.id: d for d in rows}
    missing = [i for i in def_ids if i not in by_id]
    if missing:
        return {"error": f"Unknown or wrong-vehicle deficiency ids: {missing}"}
    return [by_id[i] for i in def_ids]


def _apply_deficiency_service_status_rules(service_status: str) -> str | None:
    s = (service_status or "").upper()
    if s == "BOOKED":
        return "BOOKED"
    if s == "COMPLETE":
        return "FIXED"
    if s == "CANCELED":
        return "OPEN"   # NEW: revert booked deficiencies
    return None



def _sync_service_deficiency_links(
    *,
    service_event_id: int,
    vehicle_id: int,
    new_deficiency_ids: list[int],
    actor: str,
    now,
    service_status: str,
):
    """
    Make the service have exactly new_deficiency_ids linked.
    - Links passed deficiencies to this service (set linked_service_id)
    - Unlinks deficiencies previously linked but not in new list (set linked_service_id NULL)
    - Applies status rule based on current service_status (BOOKED->BOOKED, COMPLETE->FIXED)
      to *currently linked* deficiencies.
    """
    # Current linked IDs for this service
    current_rows = (
        db.session.query(VehicleDeficiency)
        .filter(VehicleDeficiency.linked_service_id == service_event_id)
        .all()
    )
    current_by_id = {d.id: d for d in current_rows}
    current_ids = set(current_by_id.keys())
    new_ids = set(new_deficiency_ids)

    to_unlink = current_ids - new_ids
    to_link = new_ids - current_ids

    # If service is canceled: unlink ALL deficiencies from this service.
    if (service_status or "").upper() == "CANCELED":
        for d in current_rows:
            cur = (d.status or "OPEN").upper()
            # If it was booked via this service, revert BOOKED -> OPEN
            if cur == "BOOKED":
                d.status = "OPEN"

            d.linked_service_id = None
            d.updated_by = actor
            d.updated_at = now

        return {"ok": True}


    # Unlink
    if to_unlink:
        for did in to_unlink:
            d = current_by_id[did]

            # SPEC: if it was booked via this service, and we are unlinking it,
            # revert BOOKED -> OPEN (but don't touch INVALID / FIXED).
            cur = (d.status or "OPEN").upper()
            if cur == "BOOKED":
                d.status = "OPEN"

            d.linked_service_id = None
            d.updated_by = actor
            d.updated_at = now


    # Link
    if to_link:
        fetched = _fetch_deficiencies_for_vehicle(list(to_link), vehicle_id)
        if isinstance(fetched, dict) and fetched.get("error"):
            return fetched  # error dict
        for d in fetched:
            d.linked_service_id = service_event_id
            d.updated_by = actor
            d.updated_at = now

    # Apply status rules to ALL currently linked (after changes)
    target_def_status = _apply_deficiency_service_status_rules(service_status)
    if target_def_status:
        linked_now = (
            db.session.query(VehicleDeficiency)
            .filter(VehicleDeficiency.linked_service_id == service_event_id)
            .all()
        )
        for d in linked_now:
            cur = (d.status or "OPEN").upper()
            # Don’t “unfix” or touch invalid
            if cur in {"INVALID"}:
                continue
            if target_def_status == "BOOKED":
                if cur == "OPEN":
                    d.status = "BOOKED"

            elif target_def_status == "FIXED":
                if cur != "FIXED":
                    d.status = "FIXED"

            elif target_def_status == "OPEN":
                # NEW: only revert BOOKED -> OPEN (don’t unfix, don’t touch invalid)
                if cur == "BOOKED":
                    d.status = "OPEN"

            d.updated_by = actor
            d.updated_at = now

    return {"ok": True}




def _km_remaining(v: Vehicle) -> Optional[int]:
    if v.latest_current_km is None or v.latest_service_due_km is None:
        return None
    try:
        return int(v.latest_service_due_km) - int(v.latest_current_km)
    except Exception:
        return None


def _is_closed_status(status: str) -> bool:
    """True when a deficiency status means the record is no longer open."""
    return (status or "").upper() in _CLOSED_DEFICIENCY_STATUSES


def _serialize_deficiency(d: VehicleDeficiency) -> dict:
    """Shared serialiser so details and triage payloads stay in sync."""
    return {
        "deficiency_id": d.id,
        "vehicle_id": d.vehicle_id,
        "severity": d.severity,
        "status": d.status,
        "description": d.description,
        "created_by": d.created_by,
        "created_at": d.created_at,
        "updated_by": d.updated_by,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        "linked_service_id": d.linked_service_id if d.linked_service_id else None,
    }


def _deficiencies_for(vehicle_id: int, include_closed: bool) -> list[dict]:
    """
    Return serialized deficiencies for a vehicle.

    - include_closed=False => only OPEN/BOOKED
    - include_closed=True  => all statuses

    Ordering: updated_at ascending (chronological old → new) per page spec.
    """
    q = db.session.query(VehicleDeficiency).filter(VehicleDeficiency.vehicle_id == vehicle_id)

    if not include_closed:
        q = q.filter(VehicleDeficiency.status.in_(list(_OPEN_DEFICIENCY_STATUSES)))

    rows = q.order_by(VehicleDeficiency.updated_at.asc()).all()
    return [_serialize_deficiency(d) for d in rows]



# -----------------------------------------------------------------------------
# GET /api/vehicles/active
# Powers the dropdown on the inspection page
# -----------------------------------------------------------------------------
@fleet_bp.get("/api/vehicles/active")
def get_active_vehicles():
    vehicles = (
        db.session.query(Vehicle)
        .filter(Vehicle.is_active.is_(True))
        .order_by(Vehicle.make_model.asc(), Vehicle.license_plate.asc())
        .all()
    )

    payload = {
        "vehicles": [
            {
                "vehicle_id": v.id,
                "label": f"{v.make_model} ({v.license_plate})",
                "assigned_tech": v.current_driver_name,
                "search_label": f"{v.current_driver_name or ''} - {v.make_model} {v.license_plate}".strip(),

                "last_submission_at": v.last_submission_at.isoformat() if v.last_submission_at else None,
                "last_submission_by": v.last_submission_by,
                "current_km": v.latest_current_km,
                "next_service_km": v.latest_service_due_km,
                "fluids": {"oil": v.latest_oil_level, "coolant": v.latest_coolant_level},
            }
            for v in vehicles
        ]
    }
    return jsonify(payload), 200



# -----------------------------------------------------------------------------
# GET /api/vehicles/<int:vehicle_id>
# Vehicle Details data (JSON)
# -----------------------------------------------------------------------------
@fleet_bp.get("/api/vehicles/<int:vehicle_id>")
def get_vehicle_details(vehicle_id: int):
    vehicle = db.session.get(Vehicle, vehicle_id)
    if not vehicle:
        return jsonify({"error": "Vehicle not found"}), 404
    if not vehicle.is_active:
        return jsonify({"error": "Vehicle is inactive"}), 400

    # Recent submissions (latest first)
    recent_subs = (
        db.session.query(VehicleSubmission)
        .filter(VehicleSubmission.vehicle_id == vehicle.id)
        .order_by(VehicleSubmission.submitted_at.desc())
        .limit(25)
        .all()
    )

    # Service events (all, newest first)
    service_events = (
        db.session.query(VehicleServiceEvent)
        .filter(VehicleServiceEvent.vehicle_id == vehicle.id)
        .order_by(VehicleServiceEvent.service_date.desc())
        .all()
    )

    # Deficiencies:
    # - open_deficiencies: OPEN/BOOKED only
    # - deficiencies: ALL (so UI can toggle show fixed/invalid)
    open_deficiencies = _deficiencies_for(vehicle.id, include_closed=False)
    all_deficiencies = _deficiencies_for(vehicle.id, include_closed=True)

    # Latest values for header metrics (prefer most recent submission if present)
    latest_sub = recent_subs[0] if recent_subs else None

    payload = {
        "vehicle": {
            "vehicle_id": vehicle.id,

            # identity
            "license_plate": vehicle.license_plate,
            "make_model": vehicle.make_model,
            "year": vehicle.year,
            "color": vehicle.color,
            "current_driver_name": vehicle.current_driver_name,

            # header pill (spec)
            "status": (vehicle.status or "OK").upper(),

            # office workflow fields (optional to display later)
            "notes": vehicle.notes,
            "last_service_date": vehicle.last_service_date.isoformat() if vehicle.last_service_date else None,
            "service_booked_at": vehicle.service_booked_at.isoformat() if vehicle.service_booked_at else None,

            # "latest values" for header metrics
            # Prefer latest submission values; fall back to cached vehicle fields if submission missing.
            "latest_current_km": latest_sub.current_km if latest_sub else vehicle.latest_current_km,
            "latest_service_due_km": latest_sub.service_due_km if latest_sub else vehicle.latest_service_due_km,
            "km_remaining": _km_remaining(vehicle),
            "latest_oil_level": latest_sub.oil_level if latest_sub else vehicle.latest_oil_level,
            "latest_coolant_level": latest_sub.coolant_level if latest_sub else vehicle.latest_coolant_level,
            "latest_transmission_level": latest_sub.transmission_level if latest_sub else vehicle.latest_transmission_level,

            # inspection tracking
            "last_submission_at": vehicle.last_submission_at.isoformat() if vehicle.last_submission_at else None,
            "last_submission_by": vehicle.last_submission_by,
        },

        # For UI:
        # - open_deficiencies shows OPEN/BOOKED only
        # - deficiencies contains all for "Show fixed/invalid deficiencies" toggle
        "open_deficiencies": open_deficiencies,
        "deficiencies": all_deficiencies,

        "service_events": [
            {
                "id": e.id,
                "vehicle_id": e.vehicle_id,
                "service_type": e.service_type,
                "service_date": e.service_date.isoformat() if e.service_date else None,
                "service_notes": e.service_notes,
                "created_by": e.created_by,
                "created_at": e.created_at,
                "updated_by": e.updated_by,
                "updated_at": e.updated_at,
                "service_status": e.service_status,
            }
            for e in service_events
        ],

        "recent_submissions": [
            {
                "submission_id": s.id,
                "submitted_at": s.submitted_at.isoformat(),
                "submitted_by": s.submitted_by,
                "current_km": s.current_km,
                "service_due_km": s.service_due_km,
                "oil_level": s.oil_level,
                "coolant_level": s.coolant_level,
                "transmission_level": s.transmission_level,
                "warning_lights": s.warning_lights,
                "safe_to_operate": s.safe_to_operate,
                "notes": s.notes,  # audit snapshot only
            }
            for s in recent_subs
        ],
    }

    return jsonify(payload), 200






# -----------------------------------------------------------------------------
# Streak helpers
# -----------------------------------------------------------------------------
def _iso_week(dt) -> Tuple[int, int]:
    return dt.isocalendar().year, dt.isocalendar().week


def _prev_iso_week(year: int, week: int) -> Tuple[int, int]:
    if week > 1:
        return year, week - 1
    prev_year = year - 1
    last_week = date(prev_year, 12, 28).isocalendar().week
    return prev_year, last_week


def _compute_on_time_streak_weeks(vehicle_id: int, now_dt) -> int:
    subs = (
        db.session.query(VehicleSubmission.submitted_at)
        .filter(VehicleSubmission.vehicle_id == vehicle_id)
        .order_by(VehicleSubmission.submitted_at.desc())
        .limit(104)
        .all()
    )

    times = [row[0] for row in subs if row and row[0] is not None]

    weeks: Set[Tuple[int, int]] = {_iso_week(now_dt)}
    for t in times:
        weeks.add(_iso_week(t))

    cur_year, cur_week = _iso_week(now_dt)
    streak = 1

    while True:
        cur_year, cur_week = _prev_iso_week(cur_year, cur_week)
        if (cur_year, cur_week) in weeks:
            streak += 1
        else:
            break

    return streak


# -----------------------------------------------------------------------------
# POST /api/vehicle_submissions
# Saves one submission event and updates cached "latest_*" fields on Vehicle.
# Deficiency notes are stored on the submission row as an audit snapshot only.
# Escalation (flagging, status change) is handled by POST /api/vehicle_deficiencies.
# -----------------------------------------------------------------------------
@fleet_bp.post("/api/vehicle_submissions")
def create_vehicle_submission():
    if not request.is_json:
        return jsonify({"error": "Expected application/json"}), 415

    body = request.get_json(silent=True) or {}

    vehicle_id = _int_or_none(body.get("vehicle_id"))
    if not vehicle_id:
        return jsonify({"error": "vehicle_id is required"}), 400

    current_km = _int_or_none(body.get("current_km"))
    if current_km is None or current_km < 0:
        return jsonify({"error": "current_km is required and must be >= 0"}), 400

    service_due_km = _int_or_none(body.get("service_due_km"))
    if service_due_km is not None and service_due_km < 0:
        return jsonify({"error": "service_due_km must be >= 0 or null"}), 400

    oil_level = _fluid_or_none(body.get("oil_level"))
    coolant_level = _fluid_or_none(body.get("coolant_level"))

    # Stored on the submission as an audit snapshot. No longer drives escalation.
    notes = _str_or_none(body.get("notes"))

    warning_lights = bool_or_none(body.get("warning_lights"))
    safe_to_operate = bool_or_none(body.get("safe_to_operate"))

    # Load vehicle
    vehicle = db.session.get(Vehicle, vehicle_id)
    if not vehicle:
        return jsonify({"error": "Vehicle not found"}), 404
    if not vehicle.is_active:
        return jsonify({"error": "Vehicle is inactive"}), 400

    now = _utcnow()

    submitted_by = _str_or_none(body.get("submitted_by"))
    if not submitted_by:
        return jsonify({"error": "submitted_by is required"}), 400

    # Insert submission row (audit log)
    submission = VehicleSubmission(
        vehicle_id=vehicle.id,
        submitted_at=now,
        submitted_by=submitted_by,
        current_km=current_km,
        service_due_km=service_due_km,
        oil_level=oil_level,
        coolant_level=coolant_level,
        warning_lights=warning_lights,
        safe_to_operate=safe_to_operate,
        notes=notes,
    )
    db.session.add(submission)

    # -------------------------------------------------------------------------
    # Update cached "latest known" values on vehicle
    # -------------------------------------------------------------------------
    vehicle.latest_current_km = current_km

    if service_due_km is not None:
        vehicle.latest_service_due_km = service_due_km

    if oil_level is not None:
        vehicle.latest_oil_level = oil_level

    if coolant_level is not None:
        vehicle.latest_coolant_level = coolant_level

    # Always update last submission metadata
    vehicle.last_submission_at = now
    vehicle.last_submission_by = submitted_by

        # Always update last submission metadata
    vehicle.last_submission_at = now
    vehicle.last_submission_by = submitted_by

    # -------------------------------------------------------------------------
    # Update vehicle.status based on submission values
    # -------------------------------------------------------------------------
    current_status = (vehicle.status or "OK").upper()

    def _is_empty_fluid(x) -> bool:
        if x is None:
            return False
        return str(x).strip().upper() == "EMPTY"

    # Determine "effective" due km:
    # - prefer submitted service_due_km if provided
    # - otherwise fall back to cached vehicle.latest_service_due_km
    effective_due_km = service_due_km if service_due_km is not None else getattr(vehicle, "latest_service_due_km", None)

    # Core rules from you
    computed_status = "OK"

    if safe_to_operate is False:
        computed_status = "DEFICIENT"
    elif warning_lights is True:
        computed_status = "DEFICIENT"
    elif _is_empty_fluid(oil_level) or _is_empty_fluid(coolant_level):
        computed_status = "DEFICIENT"
    elif effective_due_km is not None and current_km >= effective_due_km:
        computed_status = "DUE"
    else:
        computed_status = "OK"

    # Never touch BOOKED/IN_SHOP
    if current_status not in {"BOOKED", "IN_SHOP"}:
        # Open deficiencies exist? (OPEN or BOOKED are considered open)
        has_open_defs = (
            db.session.query(VehicleDeficiency.id)
            .filter(
                VehicleDeficiency.vehicle_id == vehicle.id,
                VehicleDeficiency.status.in_(["OPEN", "BOOKED"]),
            )
            .limit(1)
            .first()
            is not None
        )

        # If vehicle is currently DEFICIENT due to deficiencies, don't clear to OK
        # on a clean submission. BUT allow moving into DUE.
        next_status = (
            "DEFICIENT"
            if (computed_status == "OK" and has_open_defs and current_status == "DEFICIENT")
            else computed_status
        )

        if next_status != current_status:
            vehicle.status = next_status

            if hasattr(vehicle, "last_status_updated_at"):
                vehicle.last_status_updated_at = now
            if hasattr(vehicle, "last_status_updated_by"):
                vehicle.last_status_updated_by = submitted_by



    try:
        db.session.flush()
        inspection_on_time_streak_weeks = _compute_on_time_streak_weeks(vehicle.id, now)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Failed to create vehicle submission: %s", e)
        return jsonify({"error": "Failed to save submission"}), 500

    return jsonify({
        "status": "ok",
        "submission_id": submission.id,
        "vehicle_id": vehicle.id,
        "saved_at": now.isoformat(),
        "inspection_on_time_streak_weeks": inspection_on_time_streak_weeks,
    }), 201



# -----------------------------------------------------------------------------
# POST /api/vehicles/<vehicle_id>/deficiencies
# Create a new deficiency for a vehicle.
# - description required
# - updated_by required
# - severity optional
# - status forced to "OPEN"
# - updated_at always stamped to now
# - vehicle.status escalates to DEFICIENCY if currently below that priority
# -----------------------------------------------------------------------------
@fleet_bp.post("/api/vehicles/<int:vehicle_id>/deficiencies")
def create_vehicle_deficiency(vehicle_id: int):
    if not request.is_json:
        return jsonify({"error": "Expected application/json"}), 415

    body = request.get_json(silent=True) or {}

    vehicle = db.session.get(Vehicle, vehicle_id)
    if not vehicle:
        return jsonify({"error": "Vehicle not found"}), 404

    created_by = _str_or_none(body.get("created_by"))
    if not created_by:
        return jsonify({"error": "created_by is required"}), 400

    description = _str_or_none(body.get("description"))
    if not description:
        return jsonify({"error": "description is required"}), 400

    # REQUIRE severity
    severity = _str_or_none(body.get("severity"))
    if not severity:
        return jsonify({"error": "severity is required"}), 400

    severity = severity.upper()
    if severity not in ALLOWED_DEFICIENCY_SEVERITIES:
        return jsonify({
            "error": f"severity must be one of: {', '.join(sorted(ALLOWED_DEFICIENCY_SEVERITIES))}"
        }), 400

    now = _utcnow()

    deficiency = VehicleDeficiency(
        vehicle_id=vehicle.id,
        severity=severity,         # required
        status="OPEN",             # forced per new spec
        description=description,
        created_by=created_by,
        created_at=now,
        updated_at=now,
    )

    # Escalate vehicle priority if needed
    current_vehicle_status = (vehicle.status or "OK").upper()
    current_priority = _STATUS_PRIORITY.get(current_vehicle_status, 0)
    if current_priority < _STATUS_PRIORITY["DEFICIENT"]:
        vehicle.status = "DEFICIENT"

    try:
        db.session.add(deficiency)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Failed to create vehicle deficiency: %s", e)
        return jsonify({"error": "Failed to create deficiency"}), 500

    return jsonify({
        "status": "ok",
        "deficiency": _serialize_deficiency(deficiency),
        "vehicle_id": vehicle.id,
        "vehicle_status": vehicle.status,
    }), 201




# -----------------------------------------------------------------------------
# PATCH /api/vehicle_deficiencies/<int:deficiency_id>
# General-purpose updater for a deficiency's status, severity, and/or
# description.  updated_by is required on every call; updated_at is always
# stamped to now.
#
# Vehicle status side-effects only fire on open ↔ closed transitions:
#   - INTO FIXED / INVALID: if this was the last open deficiency and the
#     vehicle is at DEFICIENCY, it falls back to OK.
#   - OUT OF FIXED / INVALID back to NEW / VERIFIED: if the vehicle is
#     currently below DEFICIENCY priority it re-escalates.
#   Moves within the same group (e.g. NEW → VERIFIED, FIXED → INVALID)
#   do not touch the vehicle.
# -----------------------------------------------------------------------------
@fleet_bp.patch("/api/vehicle_deficiencies/<int:deficiency_id>")
def update_vehicle_deficiency(deficiency_id: int):
    if not request.is_json:
        return jsonify({"error": "Expected application/json"}), 415

    body = request.get_json(silent=True) or {}

    deficiency = db.session.get(VehicleDeficiency, deficiency_id)
    if not deficiency:
        return jsonify({"error": "Deficiency not found"}), 404

    vehicle = db.session.get(Vehicle, deficiency.vehicle_id)
    if not vehicle:
        return jsonify({"error": "Vehicle not found"}), 404

    # updated_by is required on every update
    updated_by = _str_or_none(body.get("updated_by"))
    if not updated_by:
        return jsonify({"error": "updated_by is required"}), 400

    now = _utcnow()

    # Snapshot the old status so we can detect open ↔ closed transitions
    old_status = (deficiency.status or "NEW").upper()

    # ---- status (optional) ----
    if "status" in body:
        new_status = _str_or_none(body.get("status"))
        if not new_status:
            return jsonify({"error": "status cannot be empty"}), 400
        new_status = new_status.upper()
        if new_status not in ALLOWED_DEFICIENCY_STATUSES:
            return jsonify({
                "error": f"status must be one of: {', '.join(sorted(ALLOWED_DEFICIENCY_STATUSES))}"
            }), 400
        deficiency.status = new_status
    else:
        new_status = old_status  # unchanged — still need the value for transition logic

    # ---- severity (optional) ----
    if "severity" in body:
        new_severity = _str_or_none(body.get("severity"))
        if new_severity is not None:
            new_severity = new_severity.upper()
            if new_severity not in ALLOWED_DEFICIENCY_SEVERITIES:
                return jsonify({
                    "error": f"severity must be one of: {', '.join(sorted(ALLOWED_DEFICIENCY_SEVERITIES))}"
                }), 400
            deficiency.severity = new_severity
        else:
            # Explicit null clears severity
            deficiency.severity = None

    # ---- description (optional) ----
    if "description" in body:
        new_desc = _str_or_none(body.get("description"))
        if not new_desc:
            return jsonify({"error": "description cannot be empty"}), 400
        deficiency.description = new_desc

    # Always stamp the actor and timestamp
    deficiency.updated_by = updated_by
    deficiency.updated_at = now

    # -------------------------------------------------------------------------
    # Vehicle status side-effects — only act on open ↔ closed transitions.
    # Moves within the same group (NEW → VERIFIED, FIXED → INVALID) are a no-op
    # for the vehicle.
    # -------------------------------------------------------------------------
    was_closed = _is_closed_status(old_status)
    is_closed  = _is_closed_status(new_status)
    current_vehicle_status = (vehicle.status or "OK").upper()

    if not was_closed and is_closed:
        # ── Closing a deficiency ──────────────────────────────────────────
        # Only relevant if the vehicle is currently at DEFICIENCY.  Check
        # whether any other open deficiencies remain (exclude this row).
        if current_vehicle_status == "DEFICIENT":
            remaining_open = (
                db.session.query(VehicleDeficiency.id)
                .filter(
                    VehicleDeficiency.vehicle_id == vehicle.id,
                    VehicleDeficiency.id != deficiency.id,
                    VehicleDeficiency.status.notin_(list(_CLOSED_DEFICIENCY_STATUSES)),
                )
                .first()
            )
            if remaining_open is None:
                vehicle.status = "OK"

    elif was_closed and not is_closed:
        # ── Re-opening a deficiency ───────────────────────────────────────
        # Escalate back to DEFICIENCY if we're currently below that priority.
        current_priority = _STATUS_PRIORITY.get(current_vehicle_status, 0)
        if current_priority < _STATUS_PRIORITY["DEFICIENT"]:
            vehicle.status = "DEFICIENT"

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Failed to update vehicle deficiency: %s", e)
        return jsonify({"error": "Failed to update deficiency"}), 500

    return jsonify({
        "status": "ok",
        "deficiency": _serialize_deficiency(deficiency),
        "vehicle_id": vehicle.id,
        "vehicle_status": vehicle.status,
    }), 200


# -----------------------------------------------------------------------------
# POST /api/vehicle_service_events
# Records a scheduled service event for a vehicle and updates the cached
# status on the Vehicle row:
#   - service_status=BOOKED   -> vehicle.status = BOOKED (unless already IN_SHOP)
#   - service_status=COMPLETE -> vehicle.status unchanged
#   - service_status=CANCELED -> vehicle.status unchanged
#
# Audit fields:
#   - created_by required
#   - updated_by set to created_by on create
#   - updated_at always stamped to now
# -----------------------------------------------------------------------------
@fleet_bp.post("/api/vehicle_service_events")
def create_vehicle_service_event():
    if not request.is_json:
        return jsonify({"error": "Expected application/json"}), 415

    body = request.get_json(silent=True) or {}

    vehicle_id = _int_or_none(body.get("vehicle_id"))
    if not vehicle_id:
        return jsonify({"error": "vehicle_id is required"}), 400

    created_by = _str_or_none(body.get("created_by"))
    if not created_by:
        return jsonify({"error": "created_by is required"}), 400

    service_type = _str_or_none(body.get("service_type"))
    if not service_type:
        return jsonify({"error": "service_type is required"}), 400
    service_type = service_type.upper()
    if len(service_type) > 64:
        return jsonify({"error": "service_type must be less than 64 characters"}), 400

    service_status = _str_or_none(body.get("service_status"))
    if not service_status:
        return jsonify({"error": "service_status is required"}), 400
    service_status = service_status.upper()

    ALLOWED_SERVICE_STATUSES = {"BOOKED", "CANCELED", "COMPLETE"}
    if service_status not in ALLOWED_SERVICE_STATUSES:
        return jsonify({
            "error": f"service_status must be one of: {', '.join(sorted(ALLOWED_SERVICE_STATUSES))}"
        }), 400

    raw_service_date = _str_or_none(body.get("service_date"))
    if not raw_service_date:
        return jsonify({"error": "service_date is required"}), 400
    try:
        dt = datetime.fromisoformat(raw_service_date)
        service_date = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return jsonify({"error": "service_date must be YYYY-MM-DD"}), 400

    service_notes = _str_or_none(body.get("service_notes"))

    # NEW: deficiency IDs
    def_ids = _def_ids_or_none(body.get("deficiency_ids", None))
    if def_ids == "error:not_list":
        return jsonify({"error": "deficiency_ids must be a list of integers"}), 400
    if def_ids == "error:bad_id":
        return jsonify({"error": "deficiency_ids must contain only integers"}), 400
    if def_ids is None:
        def_ids = []  # treat missing as none selected

    vehicle = db.session.get(Vehicle, vehicle_id)
    if not vehicle:
        return jsonify({"error": "Vehicle not found"}), 404
    if not vehicle.is_active:
        return jsonify({"error": "Vehicle is inactive"}), 400

    # Validate passed deficiencies belong to this vehicle
    fetched = _fetch_deficiencies_for_vehicle(def_ids, vehicle.id)
    if isinstance(fetched, dict) and fetched.get("error"):
        return jsonify({"error": fetched["error"]}), 400

    now = _utcnow()

    service_event = VehicleServiceEvent(
        vehicle_id=vehicle.id,
        service_type=service_type,
        service_date=service_date,
        service_notes=service_notes,
        service_status=service_status,
        created_by=created_by,
        updated_by=created_by,
        updated_at=now,
    )
    db.session.add(service_event)

    # Update cached vehicle status rules
    if service_status == "BOOKED":
        current_status = (vehicle.status or "OK").upper()
        if current_status != "IN_SHOP":
            vehicle.status = "BOOKED"
        if vehicle.service_booked_at is None:
            vehicle.service_booked_at = now

    try:
        # Flush to get service_event.id before linking deficiencies
        db.session.flush()

        sync_res = _sync_service_deficiency_links(
            service_event_id=service_event.id,
            vehicle_id=vehicle.id,
            new_deficiency_ids=def_ids,
            actor=created_by,
            now=now,
            service_status=service_status,
        )
        if sync_res.get("error"):
            db.session.rollback()
            return jsonify({"error": sync_res["error"]}), 400

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Failed to create vehicle service event: %s", e)
        return jsonify({"error": "Failed to save service event"}), 500

    return jsonify({
        "status": "ok",
        "service_event": {
            "id": service_event.id,
            "vehicle_id": vehicle.id,
            "service_type": service_event.service_type,
            "service_date": service_event.service_date.isoformat(),
            "service_notes": service_event.service_notes,
            "service_status": service_event.service_status,
            "created_by": service_event.created_by,
            "updated_by": service_event.updated_by,
            "updated_at": service_event.updated_at.isoformat() if service_event.updated_at else None,
            "linked_deficiency_ids": def_ids,
        },
        "vehicle_status": vehicle.status,
    }), 201



# -----------------------------------------------------------------------------
# PATCH /api/vehicle_service_events/<int:service_event_id>
# Update a service event.
# - allowed fields: service_type, service_date (YYYY-MM-DD), service_notes,
#   service_status
# - updated_by required on every call; updated_at always stamped to now
#
# Vehicle status side-effects:
#   - If transitioning OUT OF BOOKED -> (COMPLETE or CANCELED):
#       * If vehicle.status == BOOKED:
#           - If any other BOOKED service events exist for this vehicle => keep BOOKED
#           - Else => revert to OK
#   - If transitioning INTO BOOKED:
#       * If vehicle.status != IN_SHOP => set vehicle.status = BOOKED
#       * Ensure vehicle.service_booked_at set if missing
# -----------------------------------------------------------------------------
@fleet_bp.patch("/api/vehicle_service_events/<int:service_event_id>")
def patch_vehicle_service_event(service_event_id: int):
    if not request.is_json:
        return jsonify({"error": "Expected application/json"}), 415

    body = request.get_json(silent=True) or {}

    ev = db.session.get(VehicleServiceEvent, service_event_id)
    if not ev:
        return jsonify({"error": "Service event not found"}), 404

    vehicle = db.session.get(Vehicle, ev.vehicle_id)
    if not vehicle:
        return jsonify({"error": "Vehicle not found"}), 404
    if not vehicle.is_active:
        return jsonify({"error": "Vehicle is inactive"}), 400

    updated_by = _str_or_none(body.get("updated_by"))
    if not updated_by:
        return jsonify({"error": "updated_by is required"}), 400

    allowed_statuses = {"BOOKED", "CANCELED", "COMPLETE"}

    incoming_service_type = _str_or_none(body.get("service_type"))
    if incoming_service_type is not None:
        incoming_service_type = incoming_service_type.upper()
        if len(incoming_service_type) > 64:
            return jsonify({"error": "service_type must be less than 64 characters"}), 400

    incoming_service_status = _str_or_none(body.get("service_status"))
    if incoming_service_status is not None:
        incoming_service_status = incoming_service_status.upper()
        if incoming_service_status not in allowed_statuses:
            return jsonify({
                "error": f"service_status must be one of: {', '.join(sorted(allowed_statuses))}"
            }), 400

    incoming_service_notes = body.get("service_notes", None)
    if "service_notes" in body:
        incoming_service_notes = _str_or_none(incoming_service_notes)

    incoming_service_date = None
    if "service_date" in body:
        raw_service_date = _str_or_none(body.get("service_date"))
        if not raw_service_date:
            return jsonify({"error": "service_date cannot be empty"}), 400
        try:
            dt = datetime.fromisoformat(raw_service_date)
            incoming_service_date = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
        except (ValueError, TypeError):
            return jsonify({"error": "service_date must be YYYY-MM-DD"}), 400

    # NEW: optional deficiency_ids
    def_ids = None
    if "deficiency_ids" in body:
        def_ids = _def_ids_or_none(body.get("deficiency_ids"))
        if def_ids == "error:not_list":
            return jsonify({"error": "deficiency_ids must be a list of integers"}), 400
        if def_ids == "error:bad_id":
            return jsonify({"error": "deficiency_ids must contain only integers"}), 400
        if def_ids is None:
            def_ids = []

        fetched = _fetch_deficiencies_for_vehicle(def_ids, vehicle.id)
        if isinstance(fetched, dict) and fetched.get("error"):
            return jsonify({"error": fetched["error"]}), 400

    now = _utcnow()

    old_status = (ev.service_status or "BOOKED").upper()
    new_status = old_status if incoming_service_status is None else incoming_service_status

    # Apply fields
    if incoming_service_type is not None:
        ev.service_type = incoming_service_type
    if incoming_service_date is not None:
        ev.service_date = incoming_service_date
    if "service_notes" in body:
        ev.service_notes = incoming_service_notes
    if incoming_service_status is not None:
        ev.service_status = incoming_service_status

    ev.updated_by = updated_by
    ev.updated_at = now

    # --- Vehicle status transitions (your existing logic) ---
    if old_status != "BOOKED" and new_status == "BOOKED":
        current_vehicle_status = (vehicle.status or "OK").upper()
        if current_vehicle_status != "IN_SHOP":
            vehicle.status = "BOOKED"
        if vehicle.service_booked_at is None:
            vehicle.service_booked_at = now

    if old_status == "BOOKED" and new_status in {"COMPLETE", "CANCELED"}:
        current_vehicle_status = (vehicle.status or "OK").upper()
        if current_vehicle_status == "BOOKED":
            other_booked_exists = (
                db.session.query(VehicleServiceEvent.id)
                .filter(
                    VehicleServiceEvent.vehicle_id == vehicle.id,
                    VehicleServiceEvent.id != ev.id,
                    VehicleServiceEvent.service_status == "BOOKED",
                )
                .limit(1)
                .first()
                is not None
            )
            vehicle.status = "BOOKED" if other_booked_exists else "OK"

    try:
        # Sync deficiency links if provided
        if def_ids is not None:
            sync_res = _sync_service_deficiency_links(
                service_event_id=ev.id,
                vehicle_id=vehicle.id,
                new_deficiency_ids=def_ids,
                actor=updated_by,
                now=now,
                service_status=new_status,  # apply rule using final status
            )
            if sync_res.get("error"):
                db.session.rollback()
                return jsonify({"error": sync_res["error"]}), 400
        else:
            # No link list provided, but status might have changed.
            # If status is BOOKED or COMPLETE, apply rules to currently linked deficiencies.
            target = _apply_deficiency_service_status_rules(new_status)
            if target:
                linked_now = (
                    db.session.query(VehicleDeficiency)
                    .filter(VehicleDeficiency.linked_service_id == ev.id)
                    .all()
                )
                for d in linked_now:
                    cur = (d.status or "OPEN").upper()
                    if cur == "INVALID":
                        continue
                    if target == "BOOKED":
                        if cur == "OPEN":
                            d.status = "BOOKED"
                    elif target == "FIXED":
                        if cur != "FIXED":
                            d.status = "FIXED"
                    d.updated_by = updated_by
                    d.updated_at = now

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Failed to update vehicle service event: %s", e)
        return jsonify({"error": "Failed to update service event"}), 500

    # Return linked IDs (current truth from DB)
    linked_ids = [
        r[0]
        for r in db.session.query(VehicleDeficiency.id)
        .filter(VehicleDeficiency.linked_service_id == ev.id)
        .order_by(VehicleDeficiency.id.asc())
        .all()
    ]

    return jsonify({
        "status": "ok",
        "service_event": {
            "id": ev.id,
            "vehicle_id": ev.vehicle_id,
            "service_type": ev.service_type,
            "service_date": ev.service_date.isoformat() if ev.service_date else None,
            "service_notes": ev.service_notes,
            "service_status": ev.service_status,
            "created_by": ev.created_by,
            "updated_by": ev.updated_by,
            "updated_at": ev.updated_at.isoformat() if ev.updated_at else None,
            "linked_deficiency_ids": linked_ids,
        },
        "vehicle_status": vehicle.status,
    }), 200






# -----------------------------------------------------------------------------
# GET /api/fleet_overview/triage
# Backend now returns a flat list of active vehicles with enriched fields.
# Frontend is responsible for sorting/bucketing/presentation.
#
# Query params:
#   inspection_overdue_days (int, default 7)
# -----------------------------------------------------------------------------
@fleet_bp.get("/api/fleet_overview/triage")
def get_fleet_overview_triage():
    overdue_days = _int_or_none(request.args.get("inspection_overdue_days"))
    if overdue_days is None:
        overdue_days = 7
    if overdue_days < 1 or overdue_days > 365:
        return jsonify({"error": "inspection_overdue_days must be between 1 and 365"}), 400

    now = _utcnow()
    cutoff = now - timedelta(days=overdue_days)

    # ---- load all active vehicles ----
    vehicles = (
        db.session.query(Vehicle)
        .filter(Vehicle.is_active.is_(True))
        .all()
    )
    vehicle_ids = [v.id for v in vehicles]

    # ---- bulk-load OPEN/BOOKED deficiencies (modern definition of "open") ----
    open_def_rows = []
    if vehicle_ids:
        open_def_rows = (
            db.session.query(VehicleDeficiency)
            .filter(
                VehicleDeficiency.vehicle_id.in_(vehicle_ids),
                VehicleDeficiency.status.in_(["OPEN", "BOOKED"]),
            )
            .order_by(
                VehicleDeficiency.vehicle_id.asc(),
                VehicleDeficiency.updated_at.desc(),
            )
            .all()
        )

    open_defs_by_vehicle: dict[int, list[dict]] = {}
    for d in open_def_rows:
        open_defs_by_vehicle.setdefault(d.vehicle_id, []).append({
            "id": d.id,
            "vehicle_id": d.vehicle_id,
            "description": d.description,
            "severity": (d.severity or "").upper() if d.severity else None,
            "status": (d.status or "OPEN").upper(),
            "linked_service_id": d.linked_service_id,
            "created_by": d.created_by,
            "updated_by": d.updated_by,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        })

    # ---- helpers ----
    def _veh_status(v: Vehicle) -> str:
        return (v.status or "OK").upper()

    def _search_label(v: Vehicle) -> str:
        mm = (v.make_model or "").strip() or "Vehicle"
        lp = (v.license_plate or "").strip()
        return f"{mm} ({lp})" if lp else mm

    # ---- build flat list ----
    out = []
    for v in vehicles:
        status = _veh_status(v)

        last_sub_at = v.last_submission_at
        if last_sub_at is None:
            days_since = None
            is_overdue = True  # missing inspection counts as overdue
            overdue_by = None
        else:
            days_since = int((now - last_sub_at).total_seconds() // 86400)
            is_overdue = last_sub_at < cutoff
            overdue_by = max(days_since - overdue_days, 0) if is_overdue else 0

        defs = open_defs_by_vehicle.get(v.id, [])

        out.append({
            "vehicle_id": v.id,
            "license_plate": v.license_plate,
            "make_model": v.make_model,
            "current_driver_name": v.current_driver_name,
            "search_label": _search_label(v),
            "status": status,

            # inspection meta (frontend can bucket/sort using these)
            "last_submission_at": last_sub_at.isoformat() if last_sub_at else None,
            "last_submission_by": v.last_submission_by,
            "inspection_overdue_threshold_days": overdue_days,
            "inspection_days_since_last": days_since,
            "inspection_is_overdue": is_overdue,
            "inspection_overdue_days": overdue_by,

            # latest snapshot (cached)
            "latest_current_km": getattr(v, "latest_current_km", None),
            "latest_service_due_km": getattr(v, "latest_service_due_km", None),
            "km_remaining": _km_remaining(v),

            "latest_oil_level": getattr(v, "latest_oil_level", None),
            "latest_coolant_level": getattr(v, "latest_coolant_level", None),
            "latest_transmission_level": getattr(v, "latest_transmission_level", None),

            # workflow
            "notes": v.notes,
            "service_booked_at": v.service_booked_at.isoformat() if v.service_booked_at else None,
            "last_service_date": v.last_service_date.isoformat() if v.last_service_date else None,

            # deficiencies (OPEN/BOOKED only)
            "open_deficiencies": defs,
            "open_deficiency_count": len(defs),
        })

    payload = {
        "generated_at": now.isoformat(),
        "thresholds": {
            "inspection_overdue_days": overdue_days,
        },
        "counts": {
            "total_active": len(out),
        },
        "vehicles": out,
    }
    return jsonify(payload), 200



@fleet_bp.patch("/api/vehicles/<int:vehicle_id>/status")
def patch_vehicle_status(vehicle_id: int):
    if not request.is_json:
        return jsonify({"error": "Expected application/json"}), 415

    body = request.get_json(silent=True) or {}

    v = db.session.get(Vehicle, vehicle_id)
    if not v:
        return jsonify({"error": "Vehicle not found"}), 404
    if not v.is_active:
        return jsonify({"error": "Vehicle is inactive"}), 400

    updated_by = _str_or_none(body.get("updated_by"))
    if not updated_by:
        return jsonify({"error": "updated_by is required"}), 400

    raw_status = _str_or_none(body.get("status"))
    if not raw_status:
        return jsonify({"error": "status is required"}), 400

    new_status = raw_status.upper()

    allowed = {"OK", "DUE", "DEFICIENT", "BOOKED", "IN_SHOP"}
    if new_status not in allowed:
        return jsonify({"error": f"status must be one of: {', '.join(sorted(allowed))}"}), 400

    # ✅ NEW: optional fields
    notes = _str_or_none(body.get("notes"))  # empty/None clears
    last_service_date_raw = _str_or_none(body.get("last_service_date"))  # ISO string or None

    now = _utcnow()
    old_status = (v.status or "OK").upper()

    v.status = new_status

    # ✅ NEW: persist notes (clears if None)
    if hasattr(v, "notes"):
        v.notes = notes

    # Optional: keep your booked timestamp consistent
    if new_status == "BOOKED" and v.service_booked_at is None:
        v.service_booked_at = now

    # If you have these fields, set them. If not, omit.
    if hasattr(v, "last_status_updated_at"):
        v.last_status_updated_at = now
    if hasattr(v, "last_status_updated_by"):
        v.last_status_updated_by = updated_by

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Failed to patch vehicle status: %s", e)
        return jsonify({"error": "Failed to update vehicle status"}), 500

    return jsonify({
        "status": "ok",
        "vehicle": {
            "vehicle_id": v.id,
            "status": (v.status or "OK").upper(),
            "service_booked_at": v.service_booked_at.isoformat() if v.service_booked_at else None,
            "notes": v.notes if hasattr(v, "notes") else None,
        }
    }), 200


