from flask import Blueprint, request, session, redirect, url_for, jsonify
from datetime import date, datetime, timedelta, time
from zoneinfo import ZoneInfo
import requests
import time as time_module
import json
from app.db_models import db, Technician
from app.services.scheduling_service import find_candidate_dates, find_candidate_blocks
from app.spa import send_spa_index

scheduling_bp = Blueprint('scheduling', __name__)


def _json_safe(obj):
    """Recursively normalize dict keys/values to JSON-safe primitives."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if isinstance(k, (str, int, float, bool)) or k is None:
                key = k
            elif isinstance(k, (date, datetime)):
                key = k.isoformat()
            else:
                key = str(k)
            out[key] = _json_safe(v)
        return out
    if isinstance(obj, list):
        return [_json_safe(x) for x in obj]
    if isinstance(obj, tuple):
        return [_json_safe(x) for x in obj]
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    return obj


# --- Technician Endpoints ---

@scheduling_bp.route('/api/technicians', methods=['GET'])
def get_technicians():
    """Return all active technicians grouped by type."""
    techs = Technician.query.filter_by(active=True).all()
    grouped = {}
    for tech in techs:
        grouped.setdefault(tech.type or "Unassigned", []).append({
            "id": tech.id,
            "name": tech.name
        })
    return jsonify(grouped)


@scheduling_bp.route('/api/technicians/<int:tech_id>', methods=['PATCH'])
def update_technician_type(tech_id):
    """Update a technician’s type (from UI edits)."""
    data = request.get_json()
    new_type = data.get("type")
    tech = Technician.query.get_or_404(tech_id)
    tech.type = new_type
    db.session.commit()
    return jsonify({
        "status": "ok",
        "tech": {"id": tech.id, "name": tech.name, "type": tech.type}
    })


def _st_auth_session():
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {
        "username": session.get('username'),
        "password": session.get('password')
    }
    auth_response = api_session.post(auth_url, json=payload)
    auth_response.raise_for_status()
    return api_session


def _compute_schedule_payload(body: dict):
    """
    body: rows[].tech_count, technician_ids[], technician_types[], day_hours[]
          include_rrsc, include_projects_blocking, weekdays, start_time (HH:MM)
    """
    rows_in = body.get("rows") or []
    tech_rows = []
    for i, row in enumerate(rows_in):
        try:
            tech_count_val = int(row.get("tech_count") or 0)
        except (TypeError, ValueError):
            tech_count_val = 0
        selected_ids = row.get("technician_ids") or []
        if not isinstance(selected_ids, list):
            selected_ids = []
        selected_types = row.get("technician_types") or []
        if not isinstance(selected_types, list):
            selected_types = []
        selected_types = [str(t).strip() for t in selected_types if str(t).strip()]

        selected_techs = []
        if selected_ids or selected_types:
            q = Technician.query.filter(Technician.active == True)
            if selected_ids and selected_types:
                selected_techs = q.filter(
                    (Technician.id.in_(selected_ids)) | (Technician.type.in_(selected_types))
                ).all()
            elif selected_ids:
                selected_techs = q.filter(Technician.id.in_(selected_ids)).all()
            else:
                selected_techs = q.filter(Technician.type.in_(selected_types)).all()
        day_hours_raw = row.get("day_hours") or []
        day_hours = []
        for dh in day_hours_raw:
            try:
                day_hours.append(float(dh))
            except (TypeError, ValueError):
                day_hours.append(0.0)
        tech_rows.append({
            "tech_count": tech_count_val,
            "technicians": [{"id": t.id, "name": t.name, "type": t.type} for t in selected_techs],
            "technician_types": selected_types,
            "day_hours": day_hours
        })

    include_rrsc = bool(body.get("include_rrsc"))
    include_projects_blocking = bool(body.get("include_projects_blocking"))
    weekday_values = body.get("weekdays")
    if weekday_values is not None and isinstance(weekday_values, list):
        selected_weekdays = [int(v) for v in weekday_values]
    else:
        selected_weekdays = [0, 1, 2, 3, 4]

    start_time_str = body.get("start_time") or "08:30"
    try:
        custom_start_time = datetime.strptime(start_time_str, "%H:%M").time()
    except (ValueError, TypeError):
        custom_start_time = time(8, 30)

    account_timezone = session.get("account_timezone", "UTC")
    today = datetime.now(ZoneInfo(account_timezone)).date()
    end_date = today + timedelta(days=90)
    scheduleDateFrom = int(time_module.mktime(datetime.combine(today, datetime.min.time()).timetuple()))
    scheduleDateTo = int(time_module.mktime(datetime.combine(end_date, datetime.min.time()).timetuple()))

    api_session = _st_auth_session()

    query_params = {
        "windowBeginsAfter": scheduleDateFrom,
        "windowEndsBefore": scheduleDateTo,
        "status": "scheduled",
        "limit": 2000
    }
    appointments_response = api_session.get(
        "https://api.servicetrade.com/api/appointment/", params=query_params
    )
    appointments_response.raise_for_status()
    appointments_data = appointments_response.json().get("data", {}).get("appointments", [])

    absences_response = api_session.get("https://api.servicetrade.com/api/user/absence")
    absences_response.raise_for_status()
    absences_data = absences_response.json().get("data", {}).get("userAbsences", [])

    allowable_techs = [
        {
            "id": t.id,
            "name": t.name,
            "type": (t.type or "Unassigned").strip()
        }
        for t in Technician.query.filter_by(active=True).all()
    ]

    daily_candidates = find_candidate_dates(
        appointments_data, absences_data, allowable_techs,
        include_rrsc, include_projects_blocking, selected_weekdays, custom_start_time, tech_rows
    )

    candidate_blocks = find_candidate_blocks(daily_candidates, tech_rows, allowable_techs)

    raw = {"candidate_blocks": candidate_blocks, "tech_rows": tech_rows}
    return _json_safe(raw)


@scheduling_bp.route('/api/scheduling/compute', methods=['POST'])
def api_scheduling_compute():
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        body = request.get_json(silent=True) or {}
        result = _compute_schedule_payload(body)
        return jsonify(result)
    except requests.HTTPError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- Scheduling page (SPA) ---
@scheduling_bp.route('/find_schedule', methods=['GET'])
def find_schedule():
    try:
        _st_auth_session()
    except Exception:
        return redirect(url_for("auth.login"))
    return send_spa_index()
