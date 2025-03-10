# app/routes/scheduling.py
from flask import Blueprint, render_template, request, session, redirect, url_for, current_app
from datetime import datetime, timedelta, time
import requests
import time as time_module
from app.services.scheduling_service import find_candidate_dates

scheduling_bp = Blueprint('scheduling', __name__)

@scheduling_bp.route('/find_schedule', methods=['GET', 'POST'])
def find_schedule():
    """
    Display a form to gather:
      - Total number of technicians needed (if no category requirements provided)
      - Allowable technicians (via checkboxes)
      - Required free hours (within working hours)
      - Whether scheduling a "Return or Repair" job (checkbox)
      - Weekdays to consider (Monday-Friday; all selected by default)
      - A custom start time (between 8:30 and 4:30)
      - For each technician category, an integer input for how many techs of that level are required.
    Then search for candidate dates in the next 3 months using the Appointment API.
    """
    if request.method == 'POST':
        num_techs_needed = int(request.form.get("num_techs"))
        required_hours = float(request.form.get("hours_needed"))
        allowable_techs = request.form.getlist("allowable_techs")
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

        def get_req(field):
            val = request.form.get(field)
            return int(val) if val and val.strip().isdigit() else 0

        required_by_category = {
            "senior": get_req("required_senior"),
            "mid": get_req("required_mid"),
            "junior": get_req("required_junior"),
            "trainee": get_req("required_trainee"),
            "sprinkler": get_req("required_sprinkler")
        }

        today = datetime.today().date()
        end_date = today + timedelta(days=90)
        scheduleDateFrom = int(time_module.mktime(datetime.combine(today, datetime.min.time()).timetuple()))
        scheduleDateTo = int(time_module.mktime(datetime.combine(end_date, datetime.min.time()).timetuple()))

        api_session = requests.Session()
        auth_url = "https://api.servicetrade.com/api/auth"
        payload = {"username": session.get('username'), "password": session.get('password')}
        try:
            auth_response = api_session.post(auth_url, json=payload)
            auth_response.raise_for_status()
        except Exception as e:
            current_app.logger.error("Session authentication error: %s", e)
            error = "Session authentication failed. Please log in again."
            session.clear()
            return redirect(url_for('login'))

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

        candidate_results = find_candidate_dates(
            appointments_data, absences_data, allowable_techs, required_hours, num_techs_needed,
            include_rrsc, selected_weekdays, custom_start_time, required_by_category
        )
        current_app.logger.info("Found %d candidate results", len(candidate_results))
        return render_template("schedule_result.html", candidate_results=candidate_results)

    return render_template("jobs_form.html")
