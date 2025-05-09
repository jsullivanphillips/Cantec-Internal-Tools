# app/services/scheduling_service.py
from datetime import datetime, timedelta, time
from app.constants import TECH_CATEGORIES

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

def find_candidate_dates(appointments_data, absences_data, allowable_techs, include_rrsc, 
                         selected_weekdays, custom_start_time, tech_rows):
    """
    For each candidate date from tomorrow through the next 3 months, if the day's weekday is in selected_weekdays,
    compute the maximum contiguous free time available (within the working period defined by custom_start_time to 4:30PM)
    for each allowable technician.
    
    Busy intervals are derived from appointments and absences (with a daily clipping window of 7:00AM to 5:00PM).
    Appointments with a job.name of "RRSC AGENT" are skipped if include_rrsc is True.
    For appointments (and absences) that start before working_start, the actual start is used so the full busy time is captured.
    
    For each candidate date, the available free hours for each technician (available_info) is computed.
    Then, for each dynamic tech row (passed in as a dictionary with keys:
        - "tech_count": required number of techs,
        - "tech_types": list of acceptable tech types,
        - "tech_hours": required free hours),
    we check that the number of technicians (from the allowable_techs list) whose free time is at least tech_hours and 
    whose name is in the selected tech_types is at least equal to tech_count.
    
    If all tech rows are satisfied, the candidate date is accepted.
    
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
                            effective_start = appt_window_start if appt_window_start < working_start else working_start
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
            
            # Now check the dynamic tech row requirements.
            meets_all_requirements = True
            for row in tech_rows:
                required_count = int(row.get("tech_count", 0))
                required_hours = float(row.get("tech_hours", 0))
                tech_types = row.get("tech_types", [])
                # Count available techs that match one of the acceptable types and have free hours >= required_hours.
                count = 0
                for tech, free in available_info.items():
                    if free >= required_hours and tech in tech_types:
                        count += 1
                if count < required_count:
                    meets_all_requirements = False
                    break
            
            if meets_all_requirements:
                candidate_results.append((current_date, available_info))
        current_date += timedelta(days=1)
    return candidate_results
