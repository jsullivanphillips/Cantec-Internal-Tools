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
    Returns daily candidate results as a list of tuples: (date, available_info),
    where available_info is a dict mapping technician name to a dict containing:
       {"free_hours": float, "type": str}
    """
    from datetime import datetime, timedelta, time

    candidate_results = []
    today = datetime.today().date()
    current_date = today + timedelta(days=1)
    end_date = today + timedelta(days=120)
    
    while current_date <= end_date:
        if current_date.weekday() in selected_weekdays:
            working_start, working_end = get_working_hours_for_day(current_date, custom_start_time)
            available_info = {}
            for tech in allowable_techs:
                tech_name = tech.get("name", "").strip()
                tech_type = tech.get("type", "").strip()
                busy_intervals = []
                # Process appointments.
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
                                techs_in_appt = appt.get("techs", [])
                                for tech_obj in techs_in_appt:
                                    if tech_obj.get("name", "").strip().lower() == tech_name.lower():
                                        busy_intervals.append((effective_start, effective_end))
                                        break
                # Process absences similarly.
                for absence in absences_data:
                    absence_user = absence.get("user", {})
                    if absence_user.get("name", "").strip().lower() != tech_name.lower():
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
                # Compute free hours (assume max_free_interval is defined elsewhere).
                free_hours = max_free_interval(busy_intervals, working_start, working_end)
                available_info[tech_name] = {"free_hours": round(free_hours, 2), "type": tech_type}
            candidate_results.append((current_date, available_info))
        current_date += timedelta(days=1)
    return candidate_results


def find_candidate_blocks(daily_candidates, tech_rows, allowable_techs):
    """
    daily_candidates: list of tuples (date, available_info)
    tech_rows: list of dicts, each with keys:
       - "tech_count": int
       - "tech_types": list of acceptable tech types
       - "day_hours": list of required free hours per consecutive day
    allowable_techs: list of dicts, each with keys "name" and "type"

    Returns a list (up to 3) of candidate blocks. Each block is a dict:
      {
         'start_date': date,
         'end_date': date,
         'assignments': { row_index: [ { 'tech': tech_name,
                                         'span_dates': [list of dates],
                                         'daily_hours': { date: hours },
                                         'total_hours': float }, ... ]
                          ... }
      }
    """
    from datetime import timedelta

    # Global seniority ranking (lower value = lower seniority)
    tech_rank = {
        "Trainee Tech": 1,
        "Junior Tech": 2,
        "Mid-Level Tech": 3,
        "Senior Tech": 4,
        "Sprinkler Tech": 5
    }

    # Sort daily candidates by date.
    daily_candidates.sort(key=lambda x: x[0])
    
    # Group consecutive days into blocks.
    blocks = []
    current_block = []
    for candidate in daily_candidates:
        if not current_block:
            current_block = [candidate]
        else:
            last_date = current_block[-1][0]
            if (candidate[0] - last_date).days == 1:
                current_block.append(candidate)
            else:
                blocks.append(current_block)
                current_block = [candidate]
    if current_block:
        blocks.append(current_block)
    
    valid_blocks = []
    
    # Process each candidate block.
    for block in blocks:
        block_dates = [day for day, _ in block]
        block_length = len(block_dates)
        assignments = {}  # To store assignment results per tech row.
        block_valid = True
        
        # Process each tech row independently.
        for row_index, row in enumerate(tech_rows):
            required_count = row.get("tech_count", 0)
            required_day_hours = row.get("day_hours", [])  # e.g., [8, 2]
            L = len(required_day_hours)  # Number of consecutive days required.
            if L == 0:
                continue  # Skip if no day requirements.
            
            best_window_total = -1
            best_window_qualified = None  # This will hold the selected assignments for this row.
            
            if L == 1:
                # For a single-day requirement, always use the first day of the candidate block.
                let_window = [block[0]]  # Always take the earliest day.
                qualified = []
                for tech in allowable_techs:
                    if tech.get("type") not in row.get("tech_types", []):
                        continue
                    date, avail_info = let_window[0]
                    tech_name = tech.get("name")
                    if tech_name in avail_info and avail_info[tech_name]["free_hours"] >= required_day_hours[0]:
                        qualified.append({
                            'tech': tech.get("name"),
                            'span': [date],
                            'daily_hours': { date: avail_info[tech_name]["free_hours"] },
                            'total_hours': avail_info[tech_name]["free_hours"],
                            'ranking': tech_rank.get(tech.get("type"), 999)
                        })
                if len(qualified) >= required_count:
                    # Sort by ranking then by total_hours descending.
                    qualified.sort(key=lambda x: (x['ranking'], -x['total_hours']))
                    best_window_qualified = qualified[:required_count]
                    best_window_total = sum(q['total_hours'] for q in best_window_qualified)
                else:
                    block_valid = False
                    break
            else:
                # For multi-day requirements, slide a window of length L.
                for window_start in range(0, block_length - L + 1):
                    window = block[window_start: window_start + L]  # List of L tuples (date, available_info)
                    qualified = []
                    for tech in allowable_techs:
                        if tech.get("type") not in row.get("tech_types", []):
                            continue
                        qualifies = True
                        window_hours = []
                        for k in range(L):
                            date, avail_info = window[k]
                            tech_name = tech.get("name")
                            if tech_name in avail_info and avail_info[tech_name]["free_hours"] >= required_day_hours[k]:
                                window_hours.append(avail_info[tech_name]["free_hours"])
                            else:
                                qualifies = False
                                break
                        if qualifies:
                            total = sum(window_hours)
                            qualified.append({
                                'tech': tech.get("name"),
                                'span': [window[k][0] for k in range(L)],
                                'daily_hours': { window[k][0]: window[k][1][tech.get("name")]["free_hours"] for k in range(L) },
                                'total_hours': total,
                                'ranking': tech_rank.get(tech.get("type"), 999)
                            })
                    if len(qualified) >= required_count:
                        qualified.sort(key=lambda x: (x['ranking'], -x['total_hours']))
                        window_total = sum(q['total_hours'] for q in qualified[:required_count])
                        if window_total > best_window_total:
                            best_window_total = window_total
                            best_window_qualified = qualified[:required_count]
            # End for each window.
            if best_window_qualified is None:
                block_valid = False
                break  # This tech row cannot be satisfied in this block.
            else:
                # Record assignments for this tech row.
                assignments[row_index] = []
                for candidate_assignment in best_window_qualified:
                    assignments[row_index].append({
                        'tech': candidate_assignment['tech'],
                        'span_dates': candidate_assignment['span'],
                        'daily_hours': candidate_assignment['daily_hours'],
                        'total_hours': candidate_assignment['total_hours']
                    })
        # End for each tech row.
        
        # Optional: enforce that all tech row assignments have at least one overlapping day.
        if block_valid and assignments:
            common_days = None
            for row_index, assignment_list in assignments.items():
                row_span = set(assignment_list[0]['span_dates'])
                if common_days is None:
                    common_days = row_span
                else:
                    common_days = common_days.intersection(row_span)
            if not common_days:
                block_valid = False
        
        if block_valid:
            valid_blocks.append({
                'start_date': block_dates[0],
                'end_date': block_dates[-1],
                'assignments': assignments
            })
    # End for each candidate block.
    
    # Among valid blocks, sort by start_date and return the first 3.
    if valid_blocks:
        valid_blocks.sort(key=lambda b: b['start_date'])
        return valid_blocks[:3]
    else:
        return []





