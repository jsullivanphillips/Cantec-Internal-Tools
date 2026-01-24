# app/routes/vehicle_maintenance.py
from __future__ import annotations
from flask import Blueprint, render_template, jsonify, request, session, current_app
from datetime import datetime, timezone
from typing import Optional
from flask import Blueprint, jsonify
from app.db_models import db, Vehicle, VehicleSubmission

fleet_bp = Blueprint("fleet", __name__, template_folder="templates")


@fleet_bp.get("/fleet_overview")
def fleet_overview():
    return render_template("fleet_overview.html")

@fleet_bp.get("/fleet/inspection")
def vehicle_inspection():
    return render_template("vehicle_inspection.html")

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
# POST /api/vehicle_submissions
# Saves one submission event and updates cached "latest_*" fields on Vehicle
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

    # Update cached "latest known" values on vehicle (only if provided)
    vehicle.latest_current_km = current_km

    if service_due_km is not None:
        vehicle.latest_service_due_km = service_due_km

    if oil_level is not None:
        vehicle.latest_oil_level = oil_level

    if coolant_level is not None:
        vehicle.latest_coolant_level = coolant_level

    # Only overwrite notes if they actually provided notes (avoid blowing away existing notes)
    if deficiency_notes:
        vehicle.latest_deficiency_notes = deficiency_notes

    # Always update last submission metadata
    vehicle.last_submission_at = now
    vehicle.last_submission_by = submitted_by

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


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

@fleet_bp.get("/api/fleet_overview")
def get_fleet_overview():
    vehicles = (
        db.session.query(Vehicle)
        .filter(Vehicle.is_active.is_(True))
        .order_by(Vehicle.make_model.asc(), Vehicle.license_plate.asc())
        .all()
    )

    payload = {
        "generated_at": _utc_now_iso(),
        "vehicles": [
            {
                "vehicle_id": v.id,
                "name": f"{v.make_model} ({v.license_plate})",
                "license_plate": v.license_plate,
                "make_model": v.make_model,
                "year": v.year,
                "color": v.color,
                "assigned_tech": v.current_driver_name,

                # office-managed reference fields
                "fuel_tank_size_l": v.fuel_tank_size_l,
                "fuel_economy_l_per_100km": v.fuel_economy_l_per_100km,

                # tech/cached fields (may be null until submissions exist)
                "current_km": v.latest_current_km,
                "next_service_km": v.latest_service_due_km,
                "fluids": {
                    "oil": v.latest_oil_level,
                    "coolant": v.latest_coolant_level,
                },
                "notes": v.latest_deficiency_notes,
                "last_inspection_at": v.last_submission_at.isoformat() if v.last_submission_at else None,
                "last_inspection_by": v.last_submission_by,
            }
            for v in vehicles
        ],
    }
    return jsonify(payload), 200