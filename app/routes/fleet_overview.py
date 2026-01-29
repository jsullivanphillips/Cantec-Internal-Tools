# app/routes/vehicle_maintenance.py
from __future__ import annotations
from flask import Blueprint, render_template, redirect, url_for, jsonify, request, current_app, abort, session
from datetime import datetime, timezone, date, timedelta
from typing import Optional
from flask import Blueprint, jsonify
from app.db_models import db, Vehicle, VehicleSubmission
import requests

VALID_SERVICE_STATUSES = {"OK", "DUE", "BOOKED", "IN_SHOP"}

fleet_bp = Blueprint("fleet", __name__, template_folder="templates")


@fleet_bp.get("/fleet_overview")
def fleet_overview():
    """
    Home page (HTML + JS).
    For now: just render home.html.
    (Auth check left in place to match previous behavior.)
    """
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
    """
    Home page (HTML + JS).
    For now: just render home.html.
    (Auth check left in place to match previous behavior.)
    """
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
        # If you prefer, you can show a "vehicle inactive" page instead
        abort(404)

    # For now we just render a shell. We'll populate via JS using the API route below.
    return render_template(
        "vehicle_details.html",
        vehicle_id=vehicle.id,
        page_title=f"{vehicle.make_model} ({vehicle.license_plate})",
    )


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
ALLOWED_FLUID_LEVELS = {"empty", "1/3", "2/3", "full"}


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

def _date_or_none(val):
    """
    Accepts:
      - None
      - "YYYY-MM-DD"
    Returns: datetime.date | None
    """
    if val is None:
        return None
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s:
        return None
    try:
        # Python 3.11+: date.fromisoformat
        return date.fromisoformat(s)
    except Exception:
        return None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



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

                # Optional extras (useful if you later want to show them)
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

    def _km_remaining(v: Vehicle):
        if v.latest_current_km is None or v.latest_service_due_km is None:
            return None
        try:
            return int(v.latest_service_due_km) - int(v.latest_current_km)
        except Exception:
            return None

    payload = {
        "vehicle": {
            "vehicle_id": vehicle.id,

            # identity
            "license_plate": vehicle.license_plate,
            "make_model": vehicle.make_model,
            "year": vehicle.year,
            "color": vehicle.color,
            "current_driver_name": vehicle.current_driver_name,

            # office workflow fields
            "service_status": vehicle.service_status or "OK",
            "service_notes": vehicle.service_notes,
            "service_flagged_at": vehicle.service_flagged_at.isoformat() if vehicle.service_flagged_at else None,
            "service_booked_at": vehicle.service_booked_at.isoformat() if vehicle.service_booked_at else None,
            "last_service_date": vehicle.last_service_date.isoformat() if vehicle.last_service_date else None,

            # cached “latest known”
            "latest_current_km": vehicle.latest_current_km,
            "latest_service_due_km": vehicle.latest_service_due_km,
            "km_remaining": _km_remaining(vehicle),
            "latest_oil_level": vehicle.latest_oil_level,
            "latest_coolant_level": vehicle.latest_coolant_level,
            "latest_deficiency_notes": vehicle.latest_deficiency_notes,

            # inspection tracking
            "last_submission_at": vehicle.last_submission_at.isoformat() if vehicle.last_submission_at else None,
            "last_submission_by": vehicle.last_submission_by,
        },
        "recent_submissions": [
            {
                "submission_id": s.id,
                "submitted_at": s.submitted_at.isoformat(),
                "submitted_by": s.submitted_by,
                "current_km": s.current_km,
                "service_due_km": s.service_due_km,
                "oil_level": s.oil_level,
                "coolant_level": s.coolant_level,
                "deficiency_notes": s.deficiency_notes,
            }
            for s in recent_subs
        ],
    }

    return jsonify(payload), 200



# -----------------------------------------------------------------------------
# POST /api/vehicles/<int:vehicle_id>/service
# Office owned update to vehicles
# -----------------------------------------------------------------------------
@fleet_bp.patch("/api/vehicles/<int:vehicle_id>/service")
def update_vehicle_service(vehicle_id: int):
    if not request.is_json:
        return jsonify({"error": "Expected application/json"}), 415

    body = request.get_json(silent=True) or {}

    vehicle = db.session.get(Vehicle, vehicle_id)
    if not vehicle:
        return jsonify({"error": "Vehicle not found"}), 404
    if not vehicle.is_active:
        return jsonify({"error": "Vehicle is inactive"}), 400

    now = _utcnow()

    # ---- service_status (optional) ----
    if "service_status" in body:
        raw = body.get("service_status")
        if raw is None:
            return jsonify({"error": "service_status cannot be null"}), 400

        new_status = str(raw).strip().upper()
        if new_status not in VALID_SERVICE_STATUSES:
            return jsonify({"error": f"service_status must be one of {sorted(VALID_SERVICE_STATUSES)}"}), 400

        old_status = (vehicle.service_status or "OK").upper()
        vehicle.service_status = new_status

        # stamp workflow dates on transitions
        if new_status == "DUE" and vehicle.service_flagged_at is None:
            vehicle.service_flagged_at = now

        if new_status == "BOOKED" and vehicle.service_booked_at is None:
            vehicle.service_booked_at = now

        # (optional policy)
        # If you want moving to OK to imply "resolved", you can choose to clear flagged/booked timestamps
        # but I'd recommend NOT clearing them (audit trail). This code does not clear them.

    # ---- service_notes (optional) ----
    # IMPORTANT: allow clearing notes by sending empty string ""
    if "service_notes" in body:
        notes_val = body.get("service_notes")

        if notes_val is None:
            # Treat explicit null as clearing (you can also reject if you prefer)
            vehicle.service_notes = None
        else:
            s = str(notes_val)
            s_stripped = s.strip()
            vehicle.service_notes = s_stripped if s_stripped else None

    # ---- last_service_date (optional) ----
    if "last_service_date" in body:
        d = _date_or_none(body.get("last_service_date"))
        if body.get("last_service_date") is not None and d is None:
            return jsonify({"error": "last_service_date must be YYYY-MM-DD or null"}), 400
        vehicle.last_service_date = d

        # Optional: if they set a last_service_date, it usually implies OK
        # Uncomment if you want that behavior:
        # if d is not None:
        #     vehicle.service_status = "OK"

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Failed to update vehicle service fields: %s", e)
        return jsonify({"error": "Failed to update vehicle"}), 500

    return jsonify({
        "status": "ok",
        "vehicle": {
            "vehicle_id": vehicle.id,
            "license_plate": vehicle.license_plate,
            "make_model": vehicle.make_model,
            "current_driver_name": vehicle.current_driver_name,
            "service_status": vehicle.service_status,
            "service_notes": vehicle.service_notes,
            "service_flagged_at": vehicle.service_flagged_at.isoformat() if vehicle.service_flagged_at else None,
            "service_booked_at": vehicle.service_booked_at.isoformat() if vehicle.service_booked_at else None,
            "last_service_date": vehicle.last_service_date.isoformat() if vehicle.last_service_date else None,
        }
    }), 200

# -----------------------------------------------------------------------------
# POST /api/vehicle_submissions
# Saves one submission event and updates cached "latest_*" fields on Vehicle
# Also escalates service workflow fields when deficiency notes are submitted.
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

    # _str_or_none should return None for "" / whitespace. We'll treat None as "no notes provided".
    deficiency_notes = _str_or_none(body.get("deficiency_notes"))

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
        deficiency_notes=deficiency_notes,
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

    # IMPORTANT:
    # latest_deficiency_notes should represent what the LATEST inspection said.
    # This is separate from office-owned service_notes, which should not be cleared
    # by an inspection that has no notes.
    vehicle.latest_deficiency_notes = deficiency_notes  # can become None

    # Always update last submission metadata
    vehicle.last_submission_at = now
    vehicle.last_submission_by = submitted_by

    # -------------------------------------------------------------------------
    # Service workflow escalation (office-owned fields)
    # Only when inspection provides non-empty deficiency notes.
    # -------------------------------------------------------------------------
    new_def_notes = (deficiency_notes or "").strip()
    if new_def_notes:
        # Flagged timestamp: set once (first time we ever flag it)
        if vehicle.service_flagged_at is None:
            vehicle.service_flagged_at = now

        # Status: move OK -> DUE. Do not auto-downgrade BOOKED.
        # If status is somehow null/blank, treat as OK.
        current_status = (vehicle.service_status or "OK").upper()
        if current_status == "OK":
            vehicle.service_status = "DUE"

        # Seed office notes only if office hasn't already set something.
        if not (vehicle.service_notes or "").strip():
            vehicle.service_notes = new_def_notes

    try:
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
    }), 201



# -----------------------------------------------------------------------------
# GET /api/fleet_overview/triage
# Option 1 UI (Two-lane Triage Board):
#   - needs_service: vehicles office must book service for (DUE / BOOKED)
#   - overdue_inspections: vehicles late/missing weekly inspection
# -----------------------------------------------------------------------------
@fleet_bp.get("/api/fleet_overview/triage")
def get_fleet_overview_triage():
    # Allow UI to pass window; default weekly inspection requirement = 7 days
    overdue_days = _int_or_none(request.args.get("inspection_overdue_days"))
    if overdue_days is None:
        overdue_days = 7
    if overdue_days < 1 or overdue_days > 365:
        return jsonify({"error": "inspection_overdue_days must be between 1 and 365"}), 400

    now = _utcnow()
    cutoff = now - timedelta(days=overdue_days)

    # ----------------------------
    # Needs service lane
    # ----------------------------
    needs_service_rows = (
        db.session.query(Vehicle)
        .filter(Vehicle.is_active.is_(True))
        .filter(Vehicle.service_status.in_(["DUE", "BOOKED"]))
        .order_by(
            # DUE first, then BOOKED
            (Vehicle.service_status == "DUE").desc(),
            # then oldest flagged first (nulls last)
            Vehicle.service_flagged_at.asc().nullslast(),
            Vehicle.make_model.asc(),
            Vehicle.license_plate.asc(),
        )
        .all()
    )

    def _km_remaining(v: Vehicle):
        if v.latest_current_km is None or v.latest_service_due_km is None:
            return None
        try:
            return int(v.latest_service_due_km) - int(v.latest_current_km)
        except Exception:
            return None

    needs_service = []
    for v in needs_service_rows:
        needs_service.append({
            "vehicle_id": v.id,
            "license_plate": v.license_plate,
            "make_model": v.make_model,
            "label": f"{v.make_model} ({v.license_plate})",
            "assigned_tech": v.current_driver_name,

            # office workflow
            "service_status": (v.service_status or "OK"),
            "service_notes": v.service_notes,
            "service_flagged_at": v.service_flagged_at.isoformat() if v.service_flagged_at else None,
            "service_booked_at": v.service_booked_at.isoformat() if v.service_booked_at else None,
            "last_service_date": v.last_service_date.isoformat() if v.last_service_date else None,

            # latest submission snapshot (secondary in UI)
            "latest_deficiency_notes": v.latest_deficiency_notes,
            "last_submission_at": v.last_submission_at.isoformat() if v.last_submission_at else None,
            "last_submission_by": v.last_submission_by,

            # helpful context (optional display)
            "current_km": v.latest_current_km,
            "service_due_km": v.latest_service_due_km,
            "km_remaining": _km_remaining(v),
            "fluids": {"oil": v.latest_oil_level, "coolant": v.latest_coolant_level},
        })

    # ----------------------------
    # Overdue inspections lane
    # ----------------------------
    # Overdue if never submitted OR last submission older than cutoff
    overdue_rows = (
        db.session.query(Vehicle)
        .filter(Vehicle.is_active.is_(True))
        .filter(
            db.or_(
                Vehicle.last_submission_at.is_(None),
                Vehicle.last_submission_at < cutoff,
            )
        )
        .order_by(
            # most overdue first: NULL last_submission_at first, then oldest
            Vehicle.last_submission_at.asc().nullsfirst(),
            Vehicle.make_model.asc(),
            Vehicle.license_plate.asc(),
        )
        .all()
    )

    overdue_inspections = []
    for v in overdue_rows:
        if v.last_submission_at is None:
            days_overdue = None  # unknown / never submitted
            overdue_by = None
        else:
            delta = now - v.last_submission_at
            days_since = int(delta.total_seconds() // 86400)
            overdue_by = max(days_since - overdue_days, 0)
            days_overdue = overdue_by

        overdue_inspections.append({
            "vehicle_id": v.id,
            "license_plate": v.license_plate,
            "make_model": v.make_model,
            "label": f"{v.make_model} ({v.license_plate})",
            "assigned_tech": v.current_driver_name,

            "last_submission_at": v.last_submission_at.isoformat() if v.last_submission_at else None,
            "last_submission_by": v.last_submission_by,

            # for UI display
            "inspection_overdue_days": days_overdue,   # can be null if never submitted
            "inspection_overdue_threshold_days": overdue_days,
        })

    # ----------------------------
    # All vehicles list (for search + click-through)
    # ----------------------------
    all_vehicle_rows = (
        db.session.query(Vehicle)
        .filter(Vehicle.is_active.is_(True))
        .order_by(Vehicle.make_model.asc(), Vehicle.license_plate.asc())
        .all()
    )

    all_vehicles = [
        {
            "vehicle_id": v.id,
            "license_plate": v.license_plate,
            "make_model": v.make_model,
            "current_driver_name": v.current_driver_name,
            "last_submission_at": v.last_submission_at.isoformat() if v.last_submission_at else None,
        }
        for v in all_vehicle_rows
    ]


    payload = {
        "generated_at": now.isoformat(),
        "thresholds": {
            "inspection_overdue_days": overdue_days,
        },
        "counts": {
            "needs_service": len(needs_service),
            "overdue_inspections": len(overdue_inspections),
        },
        "needs_service": needs_service,
        "overdue_inspections": overdue_inspections,
        "all_vehicles": all_vehicles,
    }
    return jsonify(payload), 200
