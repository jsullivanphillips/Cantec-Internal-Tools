# app/routes/scheduling.py
from flask import Blueprint, render_template, request, session, redirect, url_for, current_app
from datetime import datetime, timedelta, time
import requests
import time as time_module
from app.services.scheduling_service import find_candidate_dates
from app.constants import TECH_CATEGORIES  # import our constant

scheduling_bp = Blueprint('scheduling', __name__)

@scheduling_bp.route('/find_schedule', methods=['GET', 'POST'])
def find_schedule():
    if request.method == 'POST':
        # Build dynamic tech rows from the form arrays.
        tech_counts = request.form.getlist("tech_count[]")
        tech_hours_list = request.form.getlist("tech_hours[]")
        tech_rows = []
        for i in range(len(tech_counts)):
            try:
                tech_count_val = int(tech_counts[i])
            except (TypeError, ValueError):
                tech_count_val = 0
            try:
                tech_hours_val = float(tech_hours_list[i])
            except (TypeError, ValueError):
                tech_hours_val = 0.0
            tech_types = request.form.getlist("tech_types_" + str(i) + "[]")
            tech_rows.append({
                "tech_count": tech_count_val,
                "tech_hours": tech_hours_val,
                "tech_types": tech_types
            })
        current_app.logger.info("Parsed tech rows: %s", tech_rows)
        
        include_rrsc = request.form.get("rrsc") == "on"

        weekday_values = request.form.getlist("weekdays")
        if weekday_values:
            selected_weekdays = [int(val) for val in weekday_values]
        else:
            selected_weekdays = [0, 1, 2, 3, 4]

        start_time_str = request.form.get("start_time")
        try:
            custom_start_time = datetime.strptime(start_time_str, "%H:%M").time()
        except (ValueError, TypeError):
            custom_start_time = time(8, 30)

        today = datetime.today().date()
        end_date = today + timedelta(days=90)
        scheduleDateFrom = int(time_module.mktime(datetime.combine(today, datetime.min.time()).timetuple()))
        scheduleDateTo = int(time_module.mktime(datetime.combine(end_date, datetime.min.time()).timetuple()))

        # Authenticate with the ServiceTrade API.
        api_session = requests.Session()
        auth_url = "https://api.servicetrade.com/api/auth"
        payload = {"username": session.get('username'), "password": session.get('password')}
        try:
            auth_response = api_session.post(auth_url, json=payload)
            auth_response.raise_for_status()
        except Exception as e:
            current_app.logger.error("Session authentication error: %s", e)
            session.clear()
            return redirect(url_for('auth.login'))

        query_params = {
            "windowBeginsAfter": scheduleDateFrom,
            "windowEndsBefore": scheduleDateTo,
            "status": "scheduled",
            "limit": 2000
        }

        appointments_url = "https://api.servicetrade.com/api/appointment/"
        try:
            appointments_response = api_session.get(appointments_url, params=query_params)
            appointments_response.raise_for_status()
        except Exception as e:
            current_app.logger.error("Error retrieving appointments: %s", e)
            error_message = f"Error retrieving appointments: {e}"
            return render_template("schedule_result.html", error=error_message)
        appointments_data = appointments_response.json().get("data", {}).get("appointments", [])

        absences_url = "https://api.servicetrade.com/api/user/absence"
        try:
            absences_response = api_session.get(absences_url)
            absences_response.raise_for_status()
        except Exception as e:
            current_app.logger.error("Error retrieving absences: %s", e)
            error_message = f"Error retrieving absences: {e}"
            return render_template("schedule_result.html", error=error_message)
        absences_data = absences_response.json().get("data", {}).get("userAbsences", [])

        # Build the list of allowable technicians from TECH_CATEGORIES.
        allowable_techs = []
        for tech_type, names in TECH_CATEGORIES.items():
            for name in names:
                allowable_techs.append({"name": name, "type": tech_type})
        
        # Call the scheduling service with the dynamic tech rows.
        candidate_results = find_candidate_dates(
            appointments_data, absences_data, allowable_techs,
            include_rrsc, selected_weekdays, custom_start_time, tech_rows
        )
        current_app.logger.info("Found %d candidate results", len(candidate_results))
        return render_template("schedule_result.html", candidate_results=candidate_results)

    return render_template("jobs_form.html")
