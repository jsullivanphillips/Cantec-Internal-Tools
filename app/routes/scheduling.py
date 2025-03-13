# app/routes/scheduling.py
from flask import Blueprint, render_template, request, session, redirect, url_for, current_app
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo
import requests
import time as time_module
from app.services.scheduling_service import find_candidate_dates, find_candidate_blocks
from app.constants import TECH_CATEGORIES  # for global tech list

scheduling_bp = Blueprint('scheduling', __name__)

@scheduling_bp.route('/find_schedule', methods=['GET', 'POST'])
def find_schedule():
    if request.method == 'POST':
        # Build dynamic tech rows from the form arrays.
        tech_counts = request.form.getlist("tech_count[]")
        tech_rows = []
        for i in range(len(tech_counts)):
            try:
                tech_count_val = int(tech_counts[i])
            except (TypeError, ValueError):
                tech_count_val = 0

            # Retrieve the selected tech types for this row.
            # Values can be either "Group" (e.g., "Senior Tech") or "Group:Name" (e.g., "Senior Tech:Adam Bendorffe")
            raw_selections = request.form.getlist("tech_types_" + str(i) + "[]")
            # Process the raw selections into a dictionary: { group: [list of technicians] }
            selected_techs = {}
            for item in raw_selections:
                if ':' in item:
                    group, tech_name = item.split(':', 1)
                    if group not in selected_techs:
                        selected_techs[group] = set()
                    selected_techs[group].add(tech_name)
                else:
                    # If only the group is selected, add all technicians from that group
                    group = item
                    selected_techs[group] = set(TECH_CATEGORIES.get(group, []))
            # Convert sets to lists
            for group in selected_techs:
                selected_techs[group] = list(selected_techs[group])

            # Retrieve the dynamic day hours for this row.
            day_hours_raw = request.form.getlist("tech_day_hours_" + str(i) + "[]")
            day_hours = []
            for dh in day_hours_raw:
                try:
                    day_hours.append(float(dh))
                except (TypeError, ValueError):
                    day_hours.append(0.0)

            tech_rows.append({
                "tech_count": tech_count_val,
                "tech_types": selected_techs,
                "day_hours": day_hours  # A list of required hours for each consecutive day.
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

        # Use the ServiceTrade account timezone from the session (default to UTC if not available)
        account_timezone = session.get("account_timezone", "UTC")
        today = datetime.now(ZoneInfo(account_timezone)).date()
        end_date = today + timedelta(days=90)
        scheduleDateFrom = int(time_module.mktime(datetime.combine(today, datetime.min.time()).timetuple()))
        scheduleDateTo = int(time_module.mktime(datetime.combine(end_date, datetime.min.time()).timetuple()))

        # Initialize API session.
        api_session = requests.Session()

        # Authenticate with the API.
        auth_url = "https://api.servicetrade.com/api/auth"
        payload = {"username": session.get('username'), "password": session.get('password')}
        try:
            auth_response = api_session.post(auth_url, json=payload)
            auth_response.raise_for_status()
        except Exception as e:
            current_app.logger.error("Session authentication error: %s", e)
            session.clear()
            return redirect(url_for('auth.login'))

        # Define query parameters for appointments.
        query_params = {
            "windowBeginsAfter": scheduleDateFrom,
            "windowEndsBefore": scheduleDateTo,
            "status": "scheduled",
            "limit": 2000
        }

        # Retrieve appointments.
        appointments_url = "https://api.servicetrade.com/api/appointment/"
        try:
            appointments_response = api_session.get(appointments_url, params=query_params)
            appointments_response.raise_for_status()
        except Exception as e:
            current_app.logger.error("Error retrieving appointments: %s", e)
            error_message = f"Error retrieving appointments: {e}"
            return render_template("schedule_result.html", error=error_message)
        appointments_data = appointments_response.json().get("data", {}).get("appointments", [])

        # Retrieve absences.
        absences_url = "https://api.servicetrade.com/api/user/absence"
        try:
            absences_response = api_session.get(absences_url)
            absences_response.raise_for_status()
        except Exception as e:
            current_app.logger.error("Error retrieving absences: %s", e)
            error_message = f"Error retrieving absences: {e}"
            return render_template("schedule_result.html", error=error_message)
        absences_data = absences_response.json().get("data", {}).get("userAbsences", [])

        # Build the global list of allowable technicians from TECH_CATEGORIES.
        allowable_techs = []
        for tech_type, names in TECH_CATEGORIES.items():
            for name in names:
                allowable_techs.append({"name": name, "type": tech_type})

        # Get daily candidate results.
        daily_candidates = find_candidate_dates(
            appointments_data, absences_data, allowable_techs,
            include_rrsc, selected_weekdays, custom_start_time, tech_rows
        )

        # Post-process daily candidate results into multi-day candidate blocks.
        candidate_blocks = find_candidate_blocks(daily_candidates, tech_rows, allowable_techs)
        current_app.logger.info("Found %d candidate blocks", len(candidate_blocks))
        return render_template("schedule_result.html", candidate_blocks=candidate_blocks, tech_rows=tech_rows)

    return render_template("jobs_form.html")
