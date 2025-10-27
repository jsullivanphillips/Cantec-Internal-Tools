from flask import Blueprint, render_template, request, session, redirect, url_for, jsonify
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo
import requests
import time as time_module
from app.db_models import db, Technician
from app.services.scheduling_service import find_candidate_dates, find_candidate_blocks

scheduling_bp = Blueprint('scheduling', __name__)

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


# --- Scheduling Route ---

@scheduling_bp.route('/find_schedule', methods=['GET', 'POST'])
def find_schedule():
    if request.method == 'POST':
        # Build dynamic tech rows from the form arrays
        tech_counts = request.form.getlist("tech_count[]")
        tech_rows = []

        for i in range(len(tech_counts)):
            try:
                tech_count_val = int(tech_counts[i])
            except (TypeError, ValueError):
                tech_count_val = 0

            # Get selected technician IDs for this row
            selected_ids = request.form.getlist(f"techs_row_{i}[]")

            # Query the database for those technicians
            selected_techs = []
            if selected_ids:
                selected_techs = Technician.query.filter(
                    Technician.id.in_(selected_ids),
                    Technician.active == True
                ).all()

            # Collect the day/hour requirements
            day_hours_raw = request.form.getlist(f"tech_day_hours_{i}[]")
            day_hours = []
            for dh in day_hours_raw:
                try:
                    day_hours.append(float(dh))
                except (TypeError, ValueError):
                    day_hours.append(0.0)

            # Build structured row data
            tech_rows.append({
                "tech_count": tech_count_val,
                "technicians": [{"id": t.id, "name": t.name, "type": t.type} for t in selected_techs],
                "day_hours": day_hours
            })

        include_rrsc = request.form.get("rrsc") == "on"

        # Selected weekdays
        weekday_values = request.form.getlist("weekdays")
        selected_weekdays = [int(v) for v in weekday_values] if weekday_values else [0, 1, 2, 3, 4]

        # Start time
        start_time_str = request.form.get("start_time")
        try:
            custom_start_time = datetime.strptime(start_time_str, "%H:%M").time()
        except (ValueError, TypeError):
            custom_start_time = time(8, 30)

        # Time window
        account_timezone = session.get("account_timezone", "UTC")
        today = datetime.now(ZoneInfo(account_timezone)).date()
        end_date = today + timedelta(days=90)
        scheduleDateFrom = int(time_module.mktime(datetime.combine(today, datetime.min.time()).timetuple()))
        scheduleDateTo = int(time_module.mktime(datetime.combine(end_date, datetime.min.time()).timetuple()))

        # Authenticate ServiceTrade
        api_session = requests.Session()
        auth_url = "https://api.servicetrade.com/api/auth"
        payload = {"username": session.get('username'), "password": session.get('password')}
        try:
            auth_response = api_session.post(auth_url, json=payload)
            auth_response.raise_for_status()
        except Exception:
            session.clear()
            return redirect(url_for('auth.login'))

        # Get appointments
        query_params = {
            "windowBeginsAfter": scheduleDateFrom,
            "windowEndsBefore": scheduleDateTo,
            "status": "scheduled",
            "limit": 2000
        }
        try:
            appointments_response = api_session.get("https://api.servicetrade.com/api/appointment/", params=query_params)
            appointments_response.raise_for_status()
        except Exception as e:
            return render_template("schedule_result.html", error=f"Error retrieving appointments: {e}")

        appointments_data = appointments_response.json().get("data", {}).get("appointments", [])

        # Get absences
        try:
            absences_response = api_session.get("https://api.servicetrade.com/api/user/absence")
            absences_response.raise_for_status()
        except Exception as e:
            return render_template("schedule_result.html", error=f"Error retrieving absences: {e}")

        absences_data = absences_response.json().get("data", {}).get("userAbsences", [])

        # ✅ Get allowable techs from DB (safe for None types)
        allowable_techs = [
            {
                "id": t.id,
                "name": t.name,
                "type": (t.type or "Unassigned").strip()
            }
            for t in Technician.query.filter_by(active=True).all()
        ]

        # Run scheduling logic
        daily_candidates = find_candidate_dates(
            appointments_data, absences_data, allowable_techs,
            include_rrsc, selected_weekdays, custom_start_time, tech_rows
        )

        candidate_blocks = find_candidate_blocks(daily_candidates, tech_rows, allowable_techs)

        return render_template("schedule_result.html", candidate_blocks=candidate_blocks, tech_rows=tech_rows)

    return render_template("jobs_form.html")
