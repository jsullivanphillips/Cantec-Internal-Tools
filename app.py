from flask import Flask, render_template, request, redirect, url_for, session
import requests
from datetime import datetime, timedelta, time
import time as time_module
from dotenv import load_dotenv
import os

load_dotenv()
app = Flask(__name__)
app.secret_key = "your_secret_key_here"  # Replace with a strong secret key

SERVICE_TRADE_USERNAME = os.getenv("SERVICE_TRADE_USERNAME")
SERVICE_TRADE_PASSWORD = os.getenv("SERVICE_TRADE_PASSWORD")

# Mapping of technician categories (should match the one used in the HTML)
TECH_CATEGORIES = {
    "senior": ["Adam Bendorffe", "Craig Shepherd", "Jonathan Graves", "James Martyn"],
    "mid": ["Alex Turko", "Austin Rasmussen", "Kyler Dickey", "Crosby Stewart", "Eric Turko"],
    "junior": ["Jonathan Palahicky", "Mariah Grier", "Seth Ealing"],
    "trainee": ["William Daniel", "Kevin Gao", "Hannah Feness", "James McNeil"],
    "sprinkler": ["Justin Walker", "Colin Peterson"]
}

def authenticate_api():
    """Authenticate with the ServiceTrade API and return an authenticated requests.Session."""
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": SERVICE_TRADE_USERNAME, "password": SERVICE_TRADE_PASSWORD}
    response = api_session.post(auth_url, json=payload)
    if response.status_code == 200:
        return api_session
    else:
        return None

def get_working_hours_for_day(date_obj, custom_start_time=None):
    """
    Return datetime objects representing working hours on the given date.
    If custom_start_time (a datetime.time object) is provided, use it as the start time.
    Otherwise, default to 8:30AM.
    End time is fixed at 4:30PM.
    """
    start_time = custom_start_time if custom_start_time else time(8, 30)
    start = datetime.combine(date_obj, start_time)
    end = datetime.combine(date_obj, time(16, 30))
    return start, end

def subtract_busy_intervals(working_start, working_end, busy_intervals):
    """
    Clip each busy interval to the working period and subtract them to produce free intervals.
    """
    clipped_intervals = []
    for s, e in busy_intervals:
        cs = max(s, working_start)
        ce = min(e, working_end)
        if cs < ce:
            clipped_intervals.append((cs, ce))
    clipped_intervals.sort(key=lambda interval: interval[0])
    free_intervals = []
    current = working_start
    for bstart, bend in clipped_intervals:
        if bstart > current:
            free_intervals.append((current, bstart))
        if bend > current:
            current = bend
    if current < working_end:
        free_intervals.append((current, working_end))
    return free_intervals

def max_free_interval(busy_intervals, working_start, working_end):
    """Return the maximum contiguous free time (in hours) within working_start and working_end."""
    free_ints = subtract_busy_intervals(working_start, working_end, busy_intervals)
    max_free = 0
    for start, end in free_ints:
        duration = (end - start).total_seconds() / 3600.0
        if duration > max_free:
            max_free = duration
    return max_free

def find_candidate_dates(appointments_data, absences_data, allowable_techs, required_hours, num_techs_needed, include_rrsc, selected_weekdays, custom_start_time, required_by_category):
    """
    For each candidate date from tomorrow through the next 3 months, if the day's weekday is in selected_weekdays,
    compute the maximum contiguous free time available (within the working period defined by custom_start_time to 4:30PM)
    for each allowable technician.
    
    Busy intervals are derived from appointments and absences (with a daily clipping window of 7:00AM to 5:00PM).
    Appointments with a job.name of "RRSC AGENT" are skipped if include_rrsc is True.
    For appointments (and absences) that start before working_start, the actual start is used so the full busy time is captured.
    
    Once free time is computed per technician (available_info), we group available techs by category.
    If any required count in required_by_category is > 0, then for each such category the count of techs (with free hours >= required_hours)
    must be at least that required number.
    
    Otherwise (if all required_by_category values are 0), we require that the overall number of available techs is >= num_techs_needed.
    
    Returns the first 5 candidate dates that meet the criteria.
    """
    candidate_results = []
    today = datetime.today().date()
    current_date = today + timedelta(days=1)
    end_date = today + timedelta(days=90)
    
    while current_date <= end_date and len(candidate_results) < 5:
        if current_date.weekday() in selected_weekdays:
            working_start, working_end = get_working_hours_for_day(current_date, custom_start_time)
            available_info = {}  # tech name -> free hours
            for tech in allowable_techs:
                busy_intervals = []
                # Process appointments
                for appt in appointments_data:
                    job_info = appt.get("job", {})
                    if include_rrsc and job_info.get("name", "").strip() == "RRSC AGENT":
                        continue
                    if "windowStart" in appt and "windowEnd" in appt:
                        appt_window_start = datetime.fromtimestamp(appt["windowStart"])
                        appt_window_end = datetime.fromtimestamp(appt["windowEnd"])
                        if appt_window_start.date() <= current_date <= appt_window_end.date():
                            day_start = datetime.combine(current_date, time(7, 0))
                            day_end = datetime.combine(current_date, time(17, 0))
                            if appt_window_start < working_start:
                                effective_start = appt_window_start
                            else:
                                effective_start = working_start
                            effective_end = min(appt_window_end, day_end, working_end)
                            if effective_start < effective_end:
                                techs = appt.get("techs", [])
                                for tech_obj in techs:
                                    tech_name = tech_obj.get("name", "")
                                    if tech_name.lower() == tech.lower():
                                        busy_intervals.append((effective_start, effective_end))
                                        break
                # Process absences similarly
                for absence in absences_data:
                    absence_user = absence.get("user", {})
                    if absence_user.get("name", "").lower() != tech.lower():
                        continue
                    absence_start = datetime.fromtimestamp(int(absence["windowStart"]))
                    absence_end = datetime.fromtimestamp(int(absence["windowEnd"]))
                    if absence_start.date() <= current_date <= absence_end.date():
                        day_start = datetime.combine(current_date, time(7, 0))
                        day_end = datetime.combine(current_date, time(17, 0))
                        effective_start = absence_start if absence_start < working_start else working_start
                        effective_end = min(absence_end, day_end, working_end)
                        if effective_start < effective_end:
                            busy_intervals.append((effective_start, effective_end))
                free_hours = max_free_interval(busy_intervals, working_start, working_end)
                available_info[tech] = round(free_hours, 2)
            
            # Now, check category-specific requirements.
            # First, build a count of available techs per category.
            category_counts = {cat: 0 for cat in TECH_CATEGORIES}
            for tech, free_hours in available_info.items():
                if free_hours >= required_hours:
                    # Find which category the tech belongs to.
                    for cat, tech_list in TECH_CATEGORIES.items():
                        if tech in tech_list:
                            category_counts[cat] += 1
                            break
            meets_category_requirements = True
            if sum(required_by_category.values()) > 0:
                for cat, req in required_by_category.items():
                    if req > 0 and category_counts.get(cat, 0) < req:
                        meets_category_requirements = False
                        break
            else:
                # If no category-specific requirements, enforce overall available tech count.
                total_available = sum(1 for free in available_info.values() if free >= required_hours)
                if total_available < num_techs_needed:
                    meets_category_requirements = False

            if meets_category_requirements:
                # Include only techs meeting the free hours requirement.
                filtered_info = {tech: hrs for tech, hrs in available_info.items() if hrs >= required_hours}
                candidate_results.append((current_date, filtered_info))
        current_date += timedelta(days=1)
    return candidate_results

@app.route('/')
def home():
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Display login form and authenticate ServiceTrade credentials using the Appointment API."""
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user_session = requests.Session()
        auth_url = "https://api.servicetrade.com/api/auth"
        payload = {"username": username, "password": password}
        auth_response = user_session.post(auth_url, json=payload)
        if auth_response.status_code == 200:
            session['authenticated'] = True
            session['username'] = username
            session['password'] = password
            return redirect(url_for('find_schedule'))
        else:
            error = f"Authentication failed (HTTP {auth_response.status_code}): {auth_response.text}"
            return render_template('login.html', error=error)
    return render_template('login.html')

@app.route('/find_schedule', methods=['GET', 'POST'])
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

        # Get selected weekdays (values "0" to "4")
        weekday_values = request.form.getlist("weekdays")
        if weekday_values:
            selected_weekdays = [int(val) for val in weekday_values]
        else:
            selected_weekdays = [0, 1, 2, 3, 4]

        # Get custom start time (format "HH:MM")
        start_time_str = request.form.get("start_time")
        try:
            custom_start_time = datetime.strptime(start_time_str, "%H:%M").time()
        except (ValueError, TypeError):
            custom_start_time = time(8, 30)

        # Read category-specific requirements; if empty, assume 0.
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
        auth_response = api_session.post(auth_url, json=payload)
        if auth_response.status_code != 200:
            error = "Session authentication failed. Please log in again."
            session.clear()
            return redirect(url_for('login'))

        # Retrieve appointments data
        query_params = {
            "windowBeginsAfter": scheduleDateFrom,
            "windowEndsBefore": scheduleDateTo,
            "status": "scheduled",
            "limit": 2000
        }
        appointments_url = "https://api.servicetrade.com/api/appointment/"
        appointments_response = api_session.get(appointments_url, params=query_params)
        if appointments_response.status_code != 200:
            error_message = f"Error {appointments_response.status_code}: {appointments_response.text}"
            return render_template("schedule_result.html", error=error_message)
        appointments_data = appointments_response.json().get("data", {}).get("appointments", [])

        # Retrieve absences data (for all technicians)
        absences_url = "https://api.servicetrade.com/api/user/absence"
        absences_response = api_session.get(absences_url)
        if absences_response.status_code != 200:
            error_message = f"Error retrieving absences (HTTP {absences_response.status_code}): {absences_response.text}"
            return render_template("schedule_result.html", error=error_message)
        absences_data = absences_response.json().get("data", {}).get("userAbsences", [])

        candidate_results = find_candidate_dates(
            appointments_data, absences_data, allowable_techs, required_hours, num_techs_needed,
            include_rrsc, selected_weekdays, custom_start_time, required_by_category
        )
        print(candidate_results)
        return render_template("schedule_result.html", candidate_results=candidate_results)

    return render_template("jobs_form.html")

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0")
