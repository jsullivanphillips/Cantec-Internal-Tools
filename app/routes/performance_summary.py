from flask import Blueprint, render_template, session, jsonify, request
import random
from app.db_models import db, Job, ClockEvent, Deficiency, Location, Quote, QuoteItem, InvoiceItem
from collections import defaultdict
from tqdm import tqdm
import requests
import numpy as np
import json
from datetime import datetime, timedelta, timezone
from sqlalchemy import func, distinct, case, and_
from sqlalchemy.orm import joinedload

HOURLY_RATE = {
    'fa':        125.0,
    'sprinkler': 145.0,
    'backflow':   75.0
}

# Constants
FA_LABOUR_DESCRIPTIONS = {
    "Annual Inspection",
    "Return for Repairs",
    "Service Call",
    "Project Verification & Programming",
    "Labour",
    "Verification",
    "On-Site Repairs",
    "Backflow Preventer Testing"
}
SPR_LABOUR_DESCRIPTIONS = {
    "Return for Repairs - Sprinkler/Backflow",
    "5-Year Standpipe Flow & FDC Hydrostatic Testing",
    "Backflow Preventer Testing",
    "Sprinkler Service Call",
    "3 Year Trip Test",
    "Annual Sprinkler Inspection"
}

OUTLIER_MARGIN_RATIO = 0.4

HOURLY_RATE = {
    'fa':        125.0,
    'sprinkler': 145.0,
    'backflow':   75.0
}

performance_summary_bp = Blueprint('performance_summary', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"

@performance_summary_bp.route('/performance_summary', methods=['GET'])
def performance_summary():
    # Serve the HTML page
    return render_template("performance_summary.html")


@performance_summary_bp.route('/api/performance_summary_data', methods=['GET'])
def performance_summary_data():
    # Parse optional start/end from query
    start_param = request.args.get("start_date")
    end_param   = request.args.get("end_date")

    # Default fallback
    window_start = datetime(2024, 5, 1, tzinfo=timezone.utc)
    window_end   = datetime(2025, 4, 30, tzinfo=timezone.utc)

    if start_param and end_param:
        try:
            window_start = datetime.fromisoformat(start_param).astimezone(timezone.utc)
            window_end   = datetime.fromisoformat(end_param).astimezone(timezone.utc)
        except ValueError:
            pass  # fallback to defaults if bad input

    print(f"[DEBUG] Using date range: {window_start.isoformat()} to {window_end.isoformat()}")
    
    completed_filter = and_(
        Job.completed_on.isnot(None),
        Job.completed_on >= window_start,
        Job.completed_on <= window_end
    )

    job_type_counts = get_job_type_counts(completed_filter)
    revenue_by_job_type = get_revenue_by_job_type(completed_filter)
    hours_by_job_type = get_hours_by_job_type(completed_filter)
    total_hours_by_tech = get_total_hours_by_tech(completed_filter)

    avg_revenue_by_job_type, jobs_by_job_type, bubble_data_by_type = get_job_type_analytics(
        job_type_counts, revenue_by_job_type, completed_filter
    )

    avg_revenue_per_hour_by_job_type = get_avg_revenue_per_hour(revenue_by_job_type, hours_by_job_type)
    deficiency_insights = get_deficiency_insights(window_start, window_end)
    time_to_quote_metrics = get_time_to_quote_metrics(window_start, window_end)
    technician_metrics = get_technician_metrics(window_start, window_end)
    weekly_revenue_over_time = get_weekly_revenue_over_time(window_start, window_end)
    location_service_type_counts = get_top_locations_by_service_type(window_start, window_end)
    top_customer_revenue = get_top_customers_by_revenue(window_start, window_end)
    deficiencies_by_tech_sl = get_deficiencies_created_by_tech_service_line(window_start, window_end)
    attachments_by_tech = get_attachments_by_technician(window_start, window_end)
    quote_statistics_by_user = get_quote_statistics_by_user(window_start, window_end)


    return jsonify({
        "job_type_counts": {jt or "Unknown": count for jt, count in job_type_counts.items()},
        "revenue_by_job_type": {jt or "Unknown": rev or 0 for jt, rev in revenue_by_job_type.items()},
        "hours_by_job_type": {jt or "Unknown": hrs or 0 for jt, hrs in hours_by_job_type.items()},
        "avg_revenue_by_job_type": avg_revenue_by_job_type,
        "avg_revenue_per_hour_by_job_type": avg_revenue_per_hour_by_job_type,
        "total_hours_by_tech": {tech or "Unknown": hrs or 0 for tech, hrs in total_hours_by_tech.items()},
        "jobs_by_job_type": jobs_by_job_type,
        "bubble_data_by_type": bubble_data_by_type,
        "deficiency_insights": deficiency_insights,
        "time_to_quote_metrics": time_to_quote_metrics,
        "technician_metrics": technician_metrics,
        "weekly_revenue_over_time": weekly_revenue_over_time,
        "weekly_jobs_over_time":     get_weekly_jobs_over_time(window_start, window_end),
        "location_service_type_counts": location_service_type_counts,
        "top_customer_revenue": top_customer_revenue,
        "deficiencies_by_service_line": get_deficiencies_by_service_line(window_start, window_end),
        "deficiencies_by_tech_service_line": deficiencies_by_tech_sl,
        "attachments_by_tech": attachments_by_tech,
        "quote_statistics_by_user": quote_statistics_by_user,
        "quote_cost_comparison_by_job_type": get_quote_cost_comparison_by_job_type(window_start, window_end),
        "quote_cost_breakdown_log": get_detailed_quote_job_stats(db.session, window_start, window_end),
    })




def make_aware(dt):
    if dt and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def get_detailed_quote_job_stats(session, window_start, window_end):
    """
    Returns a breakdown of *all* jobs that were created by one or more quotes,
    filtered by job completed_on date. Merges line-items from multiple quotes
    and lists all their quote IDs, grouped by quote owner (user).
    """
    SPRINKLER_TECHS = {"Colin Peterson", "Justin Walker"}

    quotes = (
        session.query(Quote)
        .filter(Quote.job_created.is_(True))
        .options(
            joinedload(Quote.items),
            joinedload(Quote.job).joinedload(Job.clock_events),
            joinedload(Quote.job).joinedload(Job.invoice_items)
        )
        .all()
    )

    quotes_by_job = defaultdict(list)
    for q in quotes:
        job = q.job
        if not job or not job.invoice_items or not job.completed_on:
            continue
        if not (window_start <= make_aware(job.completed_on) <= window_end):
            continue
        quotes_by_job[job.job_id].append(q)

    buckets_by_user = defaultdict(lambda: {"jobs": [], "margin_sum": 0.0})

    for job_id, quote_list in quotes_by_job.items():
        first_q = quote_list[0]
        job     = first_q.job
        user    = first_q.owner_email or "—"

        all_items = [item for q in quote_list for item in q.items]
        has_spr   = any(item.item_type == 'spr_labour' for item in all_items)
        has_fa    = any(item.item_type == 'fa_labour'  for item in all_items)
        spr_only  = has_spr and not has_fa

        quoted_labor = sum(item.total_price for item in all_items if item.item_type in ('fa_labour','spr_labour'))
        quoted_parts = sum(item.total_price for item in all_items if item.item_type == 'part')
        quoted_total = quoted_labor + quoted_parts

        raw_events = job.clock_events or []
        clock_events = [evt for evt in raw_events if evt.tech_name in SPRINKLER_TECHS] if spr_only else list(raw_events)

        total_hours  = sum(evt.hours for evt in clock_events)
        rate         = HOURLY_RATE['sprinkler'] if has_spr else HOURLY_RATE['fa']
        actual_labor = total_hours * rate
        actual_parts = sum(inv.total_price for inv in job.invoice_items if inv.item_type == 'part')

        original_invoice_revenue = sum(inv.total_price for inv in job.invoice_items)
        ai_amt = sum(inv.total_price for inv in job.invoice_items if "annual inspection" in inv.description.lower())
        invoice_revenue = original_invoice_revenue
        if not any("annual inspection" in item.description.lower() for item in all_items):
            invoice_revenue -= ai_amt

        margin_labor = quoted_labor - actual_labor
        margin_parts = quoted_parts - actual_parts
        total_margin = margin_labor + margin_parts

        if quoted_total > 0 and abs(total_margin) / quoted_total > OUTLIER_MARGIN_RATIO:
            continue

        quote_ids = ", ".join(str(q.quote_id) for q in quote_list)
        summary_lines = [
            "="*40,
            f"Job ID:          {job.job_id}",
            f"Quotes:          {quote_ids}",
            f"User:            {user}",
            f"Customer:        {first_q.customer_name}",
            f"Location Addr:   {first_q.location_address or '—'}",
            f"Job Completed:   {job.completed_on.isoformat()}",
            "-"*40,
            "Quoted Items:",
        ]
        for itm in all_items:
            summary_lines.append(
                f"  • [{itm.item_type}] {itm.description:<30} x{itm.quantity:<4} @ ${itm.unit_price:.2f} →  ${itm.total_price:.2f}"
            )

        summary_lines += ["", "Invoice Items:"]
        for inv in job.invoice_items:
            summary_lines.append(
                f"  • [{inv.item_type}] {inv.description:<30} x{inv.quantity:<4} @ ${inv.unit_price:.2f} →  ${inv.total_price:.2f}"
            )

        summary_lines += [ "", f"Invoice Total:         ${original_invoice_revenue:8.2f}" ]
        if invoice_revenue != original_invoice_revenue:
            summary_lines += [ f"Adjusted Invoice Total:${invoice_revenue:8.2f}  (-${ai_amt:.2f} Annual Inspection)" ]

        summary_lines += ["", "Clock Events:"]
        if clock_events:
            for evt in clock_events:
                summary_lines.append(f"  • {evt.tech_name:<20} {evt.hours:.2f}h")
        else:
            summary_lines.append("  (no clock events)")

        summary_lines += [
            "", "--- Summary ---",
            f"Quoted Labour:   ${quoted_labor:8.2f}",
            f"Actual Cost Lbr: ${actual_labor:8.2f}",
            f"Labour Δ:        ${margin_labor:8.2f}",
            f"Quoted Parts:    ${quoted_parts:8.2f}",
            f"Actual Cost Prt: ${actual_parts:8.2f}",
            f"Parts Δ:         ${margin_parts:8.2f}",
            f"Total Margin:    ${total_margin:8.2f}",
            ""
        ]

        job_payload = {
            "job_id":           job.job_id,
            "quote_ids":        [q.quote_id for q in quote_list],
            "location_address": first_q.location_address,
            "quoted_labor":     round(quoted_labor, 2),
            "actual_labor":     round(actual_labor, 2),
            "margin_labor":     round(margin_labor, 2),
            "quoted_parts":     round(quoted_parts, 2),
            "actual_parts":     round(actual_parts, 2),
            "margin_parts":     round(margin_parts, 2),
            "total_margin":     round(total_margin, 2),
            "invoice_revenue":  round(invoice_revenue, 2),
            "quote_items": [
                {
                    "item_type":   it.item_type,
                    "description": it.description,
                    "quantity":    it.quantity,
                    "unit_price":  it.unit_price,
                    "total_price": it.total_price
                }
                for it in all_items
            ],
            "invoice_items": [
                {
                    "item_type":   inv.item_type,
                    "description": inv.description,
                    "quantity":    inv.quantity,
                    "unit_price":  inv.unit_price,
                    "total_price": inv.total_price
                }
                for inv in job.invoice_items
            ],
            "clock_events": [
                {"tech_name": evt.tech_name, "hours": evt.hours}
                for evt in clock_events
            ],
            "summary_lines": summary_lines
        }

        buckets_by_user[user]["jobs"].append(job_payload)
        buckets_by_user[user]["margin_sum"] += total_margin

    results = []
    for user, data in buckets_by_user.items():
        count = len(data["jobs"])
        sum_m = data["margin_sum"]
        avg_m = (sum_m / count) if count else 0.0
        overall_summary = [
            "="*40,
            f"Across {count} jobs:",
            f"  Margin Sum:    ${sum_m:8.2f}",
            f"  Job Count:      {count}",
            f"  Average Margin:${avg_m:8.2f}",
            "="*40
        ]
        results.append({
            "user":                  user,
            "job_count":             count,
            "margin_sum":            round(sum_m, 2),
            "avg_margin":            round(avg_m, 2),
            "jobs":                  data["jobs"],
            "overall_summary_lines": overall_summary
        })

    return results


def get_quote_cost_comparison_by_job_type(window_start, window_end):
    """
    Returns average quoted vs actual cost margin per job_type,
    excluding any jobs with no invoices or whose margin ratio > OUTLIER_MARGIN_RATIO.
    Now groups multiple quotes per job into a single record.
    """
    quotes = (
        db.session.query(Quote)
        .filter(Quote.job_created.is_(True))
        .options(
            joinedload(Quote.items),
            joinedload(Quote.job).joinedload(Job.clock_events),
            joinedload(Quote.job).joinedload(Job.invoice_items)
        )
        .all()
    )

    # group by job_id
    quotes_by_job = defaultdict(list)
    for q in quotes:
        job = q.job
        if not job or not job.invoice_items or not job.completed_on:
            continue
        if not (window_start <= make_aware(job.completed_on) <= window_end):
            continue
        quotes_by_job[job.job_id].append(q)

    # compute per‐job margins, bucket by job_type
    type_margins = defaultdict(lambda: {"margin_sum": 0.0, "job_count": 0})
    for job_id, qlist in quotes_by_job.items():
        job = qlist[0].job
        jt  = job.job_type or "Unknown"

        # flatten items
        all_items = [it for q in qlist for it in q.items]

        # quoted totals
        quoted_labor = sum(it.total_price for it in all_items
                           if it.item_type in ('fa_labour','spr_labour'))
        quoted_parts = sum(it.total_price for it in all_items
                           if it.item_type == 'part')
        quoted_total = quoted_labor + quoted_parts

        # actual totals
        hours = sum(evt.hours for evt in (job.clock_events or []))
        spr_quoted = any(it.item_type == 'spr_labour' for it in all_items)
        rate = HOURLY_RATE['sprinkler'] if spr_quoted else HOURLY_RATE['fa']
        actual_labor = hours * rate
        actual_parts = sum(inv.total_price for inv in job.invoice_items
                           if inv.item_type == 'part')
        actual_total = actual_labor + actual_parts

        # outlier filter
        if quoted_total > 0 and abs(quoted_total - actual_total) / quoted_total > OUTLIER_MARGIN_RATIO:
            continue

        # accumulate
        margin = quoted_total - actual_total
        type_margins[jt]["margin_sum"] += margin
        type_margins[jt]["job_count"]  += 1

    # build results
    results = []
    for jt, vals in type_margins.items():
        count = vals["job_count"]
        if count == 0:
            continue
        avg_margin = vals["margin_sum"] / count
        results.append({
            "job_type":  jt,
            "avg_margin": round(avg_margin, 2),
            "job_count":  count
        })

    return results



def get_quote_statistics_by_user(window_start, window_end):
    """
    Returns a list of dicts, one per owner_email, with counts of:
      - submitted
      - accepted
      - canceled
      - rejected
      - draft
    Only includes quotes created within the given date range.
    """
    stats = (
        db.session.query(
            Quote.owner_email.label("user"),
            func.sum(case((Quote.status == "submitted", 1), else_=0)).label("submitted"),
            func.sum(case((Quote.status == "accepted", 1), else_=0)).label("accepted"),
            func.sum(case((Quote.status == "canceled", 1), else_=0)).label("canceled"),
            func.sum(case((Quote.status == "rejected", 1), else_=0)).label("rejected"),
            func.sum(case((Quote.status == "draft",    1), else_=0)).label("draft"),
        )
        .filter(
            Quote.quote_created_on >= window_start,
            Quote.quote_created_on <= window_end
        )
        .group_by(Quote.owner_email)
        .order_by(func.sum(case((Quote.status == "submitted", 1), else_=0)).desc())
        .all()
    )

    return [
        {
            "user":      row.user,
            "submitted": int(row.submitted),
            "accepted":  int(row.accepted),
            "canceled":  int(row.canceled),
            "rejected":  int(row.rejected),
            "draft":     int(row.draft),
        }
        for row in stats
    ]


def get_deficiencies_created_by_tech_service_line(window_start, window_end):
    """
    Returns a dict with:
      - technicians: sorted list of tech names
      - service_lines: sorted list of service line names
      - entries: list of { technician, service_line, count }
    """
    print(f"[DEBUG] Date range: {window_start.isoformat()} to {window_end.isoformat()}")

    rows = (
        db.session
        .query(
            Deficiency.reported_by,
            Deficiency.service_line,
            func.count(Deficiency.id)
        )
        .filter(
            Deficiency.deficiency_created_on >= window_start,
            Deficiency.deficiency_created_on <= window_end
        )
        .group_by(Deficiency.reported_by, Deficiency.service_line)
        .all()
    )

    print(f"[DEBUG] Raw query returned {len(rows)} rows")
    for i, row in enumerate(rows[:5]):
        print(f"[DEBUG] Row {i}: {row}")

    techs = set()
    service_lines = set()
    entries = []

    for tech, sl, cnt in rows:
        t = (tech or "Unknown")
        if t.lower() == "shop tech":
            continue
        s = (sl or "Unknown")
        techs.add(t)
        service_lines.add(s)
        entries.append({
            "technician": t,
            "service_line": s,
            "count": cnt
        })

    print(f"[DEBUG] Final entry count: {len(entries)}")

    return {
        "technicians": sorted(techs),
        "service_lines": sorted(service_lines),
        "entries": entries
    }



def get_attachments_by_technician(window_start, window_end):
    """
    Returns a list of dicts:
      [
        { "technician": "Alice Smith", "count": 12 },
        { "technician": "Bob Jones",   "count":  8 },
        ...
      ]
    Only counts those deficiencies with has_attachment=True,
    filtered by deficiency_created_on date range.
    """
    rows = (
        db.session.query(
            Deficiency.attachment_uploaded_by,
            func.count(Deficiency.id)
        )
        .filter(
            Deficiency.has_attachment.is_(True),
            Deficiency.deficiency_created_on >= window_start,
            Deficiency.deficiency_created_on <= window_end
        )
        .group_by(Deficiency.attachment_uploaded_by)
        .all()
    )

    return [
        {"technician": uploader or "Unknown", "count": cnt}
        for uploader, cnt in rows
    ]

def get_top_customers_by_revenue(window_start, window_end):
    results = (
        db.session.query(Job.customer_name, db.func.sum(Job.revenue))
        .filter(
            Job.completed_on.isnot(None),
            Job.revenue.isnot(None),
            Job.completed_on >= window_start,
            Job.completed_on <= window_end
        )
        .group_by(Job.customer_name)
        .all()
    )

    customer_map = {}

    for name, total in results:
        normalized_name = name or "Unknown"
        name_lower = normalized_name.lower()

        if "devon" in name_lower:
            key = "Devon Properties"
        elif "brown brothers" in name_lower:
            key = "Brown Brothers Property Management"
        else:
            key = normalized_name

        customer_map[key] = customer_map.get(key, 0) + (total or 0)

    sorted_customers = sorted(customer_map.items(), key=lambda x: x[1], reverse=True)

    return [
        {"customer": name, "revenue": round(revenue, 2)}
        for name, revenue in sorted_customers
    ]




def get_top_locations_by_service_type(window_start, window_end):
    # Aggregate service call counts for completed jobs within the date range
    location_stats = (
        db.session.query(
            Job.address,
            db.func.sum(db.case((Job.job_type == 'emergency_service_call', 1), else_=0)).label("emergency_count"),
            db.func.sum(db.case((Job.job_type == 'service_call', 1), else_=0)).label("service_count")
        )
        .filter(
            Job.job_type.in_(["emergency_service_call", "service_call"]),
            Job.completed_on.isnot(None),
            Job.completed_on >= window_start,
            Job.completed_on <= window_end
        )
        .group_by(Job.address)
        .all()
    )

    # Sort by combined emergency + service count
    sorted_locations = sorted(
        location_stats,
        key=lambda row: (row.emergency_count or 0) + (row.service_count or 0),
        reverse=True
    )

    return [
        {
            "address": row.address or "Unknown",
            "emergency": int(row.emergency_count or 0),
            "service": int(row.service_count or 0),
            "total": int((row.emergency_count or 0) + (row.service_count or 0))
        }
        for row in sorted_locations
    ]


def get_weekly_revenue_over_time(window_start, window_end):
    # Get all jobs with revenue and completed date within the date range
    jobs = (
        db.session.query(Job.completed_on, Job.revenue)
        .filter(
            Job.completed_on.isnot(None),
            Job.completed_on >= window_start,
            Job.completed_on <= window_end,
            Job.revenue.isnot(None)
        )
        .all()
    )

    revenue_by_week = defaultdict(float)

    for completed_on, revenue in jobs:
        if not completed_on:
            continue
        # Convert to Monday of the ISO week
        monday = completed_on - timedelta(days=completed_on.weekday())
        week_start = monday.date()
        revenue_by_week[week_start] += revenue or 0

    # Sort by week start date
    sorted_weekly = sorted(revenue_by_week.items())

    return [{"week_start": week.isoformat(), "revenue": round(rev, 2)} for week, rev in sorted_weekly]



def get_weekly_jobs_over_time(window_start, window_end):
    """
    Returns a list of dictionaries with job completion counts per ISO week,
    filtered by job completed date within the given window.
    """
    # 1. Fetch all completed_on dates within the window
    jobs = (
        db.session.query(Job.completed_on)
        .filter(
            Job.completed_on.isnot(None),
            Job.completed_on >= window_start,
            Job.completed_on <= window_end
        )
        .all()
    )

    # 2. Bucket by ISO-week Monday
    counts_by_week = defaultdict(int)
    for (completed_on,) in jobs:
        monday = completed_on - timedelta(days=completed_on.weekday())
        week_start = monday.date()
        counts_by_week[week_start] += 1

    # 3. Sort and format
    sorted_weeks = sorted(counts_by_week.items())
    return [
        {"week_start": week.isoformat(), "jobs_completed": count}
        for week, count in sorted_weeks
    ]

    


def get_technician_metrics(window_start, window_end):
    EXCLUDE = {"administrative", "delivery", "pickup", "consultation"}

    # --- Gather all clock data per job ---
    clock_data = (
        db.session.query(
            Job.job_id,
            Job.revenue,
            ClockEvent.tech_name,
            ClockEvent.hours,
            Job.job_type
        )
        .join(ClockEvent, Job.job_id == ClockEvent.job_id)
        .filter(
            Job.completed_on.isnot(None),
            Job.completed_on >= window_start,
            Job.completed_on <= window_end,
            ClockEvent.tech_name != "Shop Tech",
            ~func.lower(Job.job_type).in_(EXCLUDE)
        )
        .all()
    )

    # --- Build job-hour map to support proportional revenue split ---
    job_hours = {}
    for job_id, _, tech, hours, _ in clock_data:
        if job_id not in job_hours:
            job_hours[job_id] = 0
        job_hours[job_id] += hours or 0

    # --- Aggregate revenue/hours per tech ---
    revenue_by_tech = {}
    hours_by_tech = {}
    jobs_set = {}

    for job_id, revenue, tech, hours, job_type in clock_data:
        tech = tech or "Unknown"
        if job_hours[job_id] == 0:
            continue  # avoid div-by-zero
        proportion = (hours or 0) / job_hours[job_id]
        revenue_share = (revenue or 0) * proportion
        revenue_by_tech[tech] = revenue_by_tech.get(tech, 0) + revenue_share
        hours_by_tech[tech] = hours_by_tech.get(tech, 0) + (hours or 0)
        jobs_set.setdefault(tech, set()).add(job_id)

    # --- Metric calculations ---
    jobs_completed_by_tech = { tech: len(jobs) for tech, jobs in jobs_set.items() }

    revenue_per_hour = {
        tech: round(revenue_by_tech[tech] / hours_by_tech[tech], 2)
        if hours_by_tech[tech] else 0.0
        for tech in revenue_by_tech
    }

    # --- Breakdown by job type ---
    raw_counts = (
        db.session.query(
            ClockEvent.tech_name,
            Job.job_type,
            func.count(distinct(Job.job_id))
        )
        .join(Job, Job.job_id == ClockEvent.job_id)
        .filter(
            Job.completed_on.isnot(None),
            Job.completed_on >= window_start,
            Job.completed_on <= window_end,
            ClockEvent.tech_name != "Shop Tech",
            ~func.lower(Job.job_type).in_(EXCLUDE)
        )
        .group_by(ClockEvent.tech_name, Job.job_type)
        .all()
    )

    techs = set()
    job_types = set()
    entries = []

    for tech, jt, cnt in raw_counts:
        tech = tech or "Unknown"
        jt = jt or "Unknown"
        techs.add(tech)
        job_types.add(jt)
        entries.append({
            "technician": tech,
            "job_type": jt,
            "count": cnt
        })

    return {
        "revenue_per_hour": revenue_per_hour,
        "jobs_completed_by_tech": jobs_completed_by_tech,
        "jobs_completed_by_tech_job_type": {
            "technicians": sorted(techs),
            "job_types": sorted(job_types),
            "entries": entries
        }
    }

    



def get_job_type_counts(completed_filter):
    return dict(
        db.session.query(Job.job_type, db.func.count(Job.job_id))
        .filter(completed_filter)
        .group_by(Job.job_type)
        .all()
    )

def get_revenue_by_job_type(completed_filter):
    return dict(
        db.session.query(Job.job_type, db.func.sum(Job.revenue))
        .filter(completed_filter)
        .group_by(Job.job_type)
        .all()
    )

def get_hours_by_job_type(completed_filter):
    return dict(
        db.session.query(Job.job_type, db.func.sum(Job.total_on_site_hours))
        .filter(completed_filter)
        .group_by(Job.job_type)
        .all()
    )

def get_total_hours_by_tech(completed_filter):
    return dict(
        db.session.query(ClockEvent.tech_name, db.func.sum(ClockEvent.hours))
        .join(Job, ClockEvent.job_id == Job.job_id)
        .filter(completed_filter)
        .group_by(ClockEvent.tech_name)
        .all()
    )

def get_job_type_analytics(job_type_counts, revenue_by_job_type, completed_filter):
    avg_revenue_by_job_type = {}
    jobs_by_job_type = {}
    bubble_data_by_type = {}

    all_job_types = set(job_type_counts.keys()).union(revenue_by_job_type.keys())

    for jt in all_job_types:
        jobs = Job.query.filter(Job.job_type == jt, completed_filter).all()
        revenues = [j.revenue for j in jobs if j.revenue is not None]
        filtered_revenues = iqr_filter(revenues)

        used_jobs = [
            {"job_id": job.job_id, "revenue": round(job.revenue, 2)}
            for job in jobs
            if job.revenue is not None and job.revenue in filtered_revenues
        ]
        jobs_by_job_type[jt or "Unknown"] = used_jobs

        avg = round(sum(filtered_revenues) / len(filtered_revenues), 2) if filtered_revenues else 0
        avg_revenue_by_job_type[jt or "Unknown"] = avg

        bubble_data_by_type[jt or "Unknown"] = {
            "count": job_type_counts.get(jt, 0),
            "avg_revenue": avg,
            "total_revenue": revenue_by_job_type.get(jt, 0)
        }

    return avg_revenue_by_job_type, jobs_by_job_type, bubble_data_by_type

def get_avg_revenue_per_hour(revenue_by_job_type, hours_by_job_type):
    all_job_types = set(revenue_by_job_type.keys()).union(hours_by_job_type.keys())
    result = {}
    for jt in all_job_types:
        hours = hours_by_job_type.get(jt, 0)
        revenue = revenue_by_job_type.get(jt, 0)
        result[jt or "Unknown"] = round(revenue / hours, 2) if hours else 0.0
    return result

def get_deficiency_insights(start_date, end_date):
    # Base date filter on deficiency.created_on
    total_deficiencies = db.session.query(Deficiency)\
        .filter(
            Deficiency.deficiency_created_on >= start_date,
            Deficiency.deficiency_created_on <= end_date
        )\
        .count()

    # Quoted deficiencies created within range
    quoted_deficiencies = db.session.query(Quote.linked_deficiency_id)\
        .join(Deficiency, Quote.linked_deficiency_id == Deficiency.deficiency_id)\
        .filter(
            Quote.linked_deficiency_id.isnot(None),
            Deficiency.deficiency_created_on >= start_date,
            Deficiency.deficiency_created_on <= end_date
        )\
        .distinct()\
        .count()

    # Quoted + job created (filter by deficiency date)
    quoted_with_job = db.session.query(Quote.linked_deficiency_id)\
        .join(Deficiency, Quote.linked_deficiency_id == Deficiency.deficiency_id)\
        .filter(
            Quote.linked_deficiency_id.isnot(None),
            Quote.job_created.is_(True),
            Deficiency.deficiency_created_on >= start_date,
            Deficiency.deficiency_created_on <= end_date
        )\
        .distinct()\
        .count()

    # Quoted → job → completed (filter by job completed date)
    quoted_with_completed_job = db.session.query(Quote.linked_deficiency_id)\
        .join(Job, Quote.job_id == Job.job_id)\
        .join(Deficiency, Quote.linked_deficiency_id == Deficiency.deficiency_id)\
        .filter(
            Quote.linked_deficiency_id.isnot(None),
            Quote.job_created.is_(True),
            Job.completed_on.isnot(None),
            Job.completed_on >= start_date,
            Job.completed_on <= end_date
        )\
        .distinct()\
        .count()

    return {
        "total_deficiencies": total_deficiencies,
        "quoted_deficiencies": quoted_deficiencies,
        "quoted_with_job": quoted_with_job,
        "quoted_with_completed_job": quoted_with_completed_job
    }


def get_deficiencies_by_service_line(window_start, window_end):
    from sqlalchemy import func, distinct

    # 1️⃣ Total deficiencies per service line
    total_counts = dict(
        db.session.query(
            Deficiency.service_line,
            func.count(Deficiency.id)
        )
        .filter(
            Deficiency.deficiency_created_on >= window_start,
            Deficiency.deficiency_created_on <= window_end
        )
        .group_by(Deficiency.service_line)
        .all()
    )

    # 2️⃣ Deficiencies quoted (distinct linked)
    quoted_counts = dict(
        db.session.query(
            Deficiency.service_line,
            func.count(distinct(Quote.linked_deficiency_id))
        )
        .join(Quote, Quote.linked_deficiency_id == Deficiency.deficiency_id)
        .filter(
            Quote.linked_deficiency_id.isnot(None),
            Deficiency.deficiency_created_on >= window_start,
            Deficiency.deficiency_created_on <= window_end
        )
        .group_by(Deficiency.service_line)
        .all()
    )

    # 3️⃣ Quoted → job created but NOT yet completed
    quoted_job_counts = dict(
        db.session.query(
            Deficiency.service_line,
            func.count(distinct(Quote.linked_deficiency_id))
        )
        .join(Quote, Quote.linked_deficiency_id == Deficiency.deficiency_id)
        .join(Job, Quote.job_id == Job.job_id)
        .filter(
            Quote.linked_deficiency_id.isnot(None),
            Quote.job_created.is_(True),
            Job.completed_on.is_(None),
            Deficiency.deficiency_created_on >= window_start,
            Deficiency.deficiency_created_on <= window_end
        )
        .group_by(Deficiency.service_line)
        .all()
    )

    # 4️⃣ Quoted → job created → job completed
    quoted_completed_counts = dict(
        db.session.query(
            Deficiency.service_line,
            func.count(distinct(Quote.linked_deficiency_id))
        )
        .join(Quote, Quote.linked_deficiency_id == Deficiency.deficiency_id)
        .join(Job, Quote.job_id == Job.job_id)
        .filter(
            Quote.linked_deficiency_id.isnot(None),
            Quote.job_created.is_(True),
            Job.completed_on.isnot(None),
            Deficiency.deficiency_created_on >= window_start,
            Deficiency.deficiency_created_on <= window_end
        )
        .group_by(Deficiency.service_line)
        .all()
    )

    # 5️⃣ Build the final list, sorted by service line
    service_lines = sorted(
        set(total_counts) |
        set(quoted_counts) |
        set(quoted_job_counts) |
        set(quoted_completed_counts)
    )

    result = []
    for sl in service_lines:
        total       = total_counts.get(sl, 0)
        quoted      = quoted_counts.get(sl, 0)
        q_job       = quoted_job_counts.get(sl, 0)
        q_completed = quoted_completed_counts.get(sl, 0)

        result.append({
            "service_line":       sl or "Unknown",
            "no_quote":           total - quoted,
            "quoted_no_job":      q_job,
            "quoted_to_job":      q_job,
            "quoted_to_complete": q_completed
        })

    return result


def get_time_to_quote_metrics(window_start, window_end):
    deficiency_to_quote_deltas = []
    quote_to_job_deltas = []

    linked_quotes = (
        db.session.query(Quote, Deficiency, Job)
        .outerjoin(Deficiency, Quote.linked_deficiency_id == Deficiency.deficiency_id)
        .outerjoin(Job, Quote.job_id == Job.job_id)
        .filter(
            Quote.linked_deficiency_id.isnot(None),
            Quote.quote_created_on >= window_start,
            Quote.quote_created_on <= window_end
        )
        .all()
    )

    for quote, deficiency, job in linked_quotes:
        if deficiency and deficiency.deficiency_created_on and quote.quote_created_on:
            delta1 = make_aware(quote.quote_created_on) - make_aware(deficiency.deficiency_created_on)
            deficiency_to_quote_deltas.append(delta1.days)

        if quote.quote_created_on and job:
            job_date = job.scheduled_date or job.completed_on
            if job_date:
                if job_date.tzinfo is None:
                    job_date = job_date.replace(tzinfo=timezone.utc)
                if window_start <= job_date <= window_end:
                    delta2 = make_aware(job_date) - make_aware(quote.quote_created_on)
                    quote_to_job_deltas.append(delta2.days)

    avg_def_to_quote = (
        round(sum(deficiency_to_quote_deltas) / len(deficiency_to_quote_deltas), 1)
        if deficiency_to_quote_deltas else 0
    )
    avg_quote_to_job = (
        round(sum(quote_to_job_deltas) / len(quote_to_job_deltas), 1)
        if quote_to_job_deltas else 0
    )

    return {
        "avg_days_deficiency_to_quote": avg_def_to_quote,
        "avg_days_quote_to_job": avg_quote_to_job
    }



def iqr_filter(values):
    if not values:
        return []
    q1 = np.percentile(values, 25)
    q3 = np.percentile(values, 75)
    iqr = q3 - q1
    lower_bound = q1 - 1.5 * iqr
    upper_bound = q3 + 1.5 * iqr
    filtered = [v for v in values if lower_bound <= v <= upper_bound]
    return filtered


def authenticate():
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}

    if not payload["username"] or not payload["password"]:
        raise Exception("Missing ServiceTrade credentials in session.")

    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
        print("✅ Authenticated successfully with ServiceTrade!")
    except Exception as e:
        print("❌ Authentication with ServiceTrade failed!")
        raise e

def call_service_trade_api(endpoint, params):
    try:
        response = api_session.get(endpoint, params=params)
        response.raise_for_status()
        return response
    except requests.RequestException as e:
        print(f"[ServiceTrade API Error] Endpoint: {endpoint} | Params: {params} | Error: {str(e)}")
        return None


def fetch_invoice_and_clock(job, overwrite=False):
    job_id = job.get("id")
    existing_job = Job.query.filter_by(job_id=job_id).first()

    job_type = job.get("type")
    address = job.get("location", {}).get("address", {}).get("street", "Unknown")
    customer_name = job.get("customer", {}).get("name", "Unknown")
    job_status = job.get("displayStatus", "Unknown")
    scheduled_date = datetime.fromtimestamp(job.get("scheduledDate")) if job.get("scheduledDate") else None
    completed_on_raw = job.get("completedOn")
    completed_on = datetime.fromtimestamp(completed_on_raw) if completed_on_raw else None
    created_raw = job.get("created")
    created_on_st = datetime.fromtimestamp(created_raw, timezone.utc) if created_raw else None
    location_id = job.get("location", {}).get("id")

    if existing_job:
        if not overwrite:
            tqdm.write(f"Skipping job {job_id} (already exists in DB)")
            return job_id, {
                "job": existing_job,
                "clockEvents": {},
                "onSiteHours": existing_job.total_on_site_hours
            }

        # ✏️ Overwrite fields instead of creating new Job
        existing_job.job_type = job_type
        existing_job.address = address
        existing_job.customer_name = customer_name
        existing_job.job_status = job_status
        existing_job.scheduled_date = scheduled_date
        existing_job.completed_on = completed_on
        existing_job.created_on_st = created_on_st
        if location_id:
            existing_job.location_id = location_id
        db_job = existing_job
    else:
        db_job = Job(
            job_id=job_id,
            location_id=location_id,
            job_type=job_type,
            address=address,
            customer_name=customer_name,
            job_status=job_status,
            scheduled_date=scheduled_date,
            completed_on=completed_on,
            total_on_site_hours=0,
            revenue=0,
            created_on_st=created_on_st
        )
        db.session.add(db_job)

    # Fetch invoice and clock events only for completed jobs
    invoice_total = 0
    total_on_site_hours = 0
    clock_events = {}

    if completed_on:
        invoice_endpoint = f"{SERVICE_TRADE_API_BASE}/invoice"
        invoice_params = {"jobId": job_id}
        invoice_response = call_service_trade_api(invoice_endpoint, invoice_params)
        if invoice_response:
            try:
                invoices = invoice_response.json().get("data", {}).get("invoices", [])
                invoice_total = sum(inv.get("totalPrice", 0) for inv in invoices)
            except Exception as e:
                tqdm.write(f"⚠️ Failed parsing invoice data for job {job_id}: {e}")
        db_job.revenue = invoice_total

        clock_endpoint = f"{SERVICE_TRADE_API_BASE}/job/{job_id}/clockevent"
        clock_params = {"activity": "onsite"}
        clock_response = call_service_trade_api(clock_endpoint, clock_params)
        if clock_response:
            try:
                clock_event_pairs = clock_response.json().get("data", {}).get("pairedEvents", [])
                for pair in clock_event_pairs:
                    clock_in_raw = pair.get("start", {}).get("eventTime", 0)
                    clock_out_raw = pair.get("end", {}).get("eventTime", 0)
                    if not clock_in_raw or not clock_out_raw:
                        continue
                    clock_in = datetime.fromtimestamp(clock_in_raw)
                    clock_out = datetime.fromtimestamp(clock_out_raw)
                    delta = clock_out - clock_in
                    hours = delta.total_seconds() / 3600
                    tech = pair.get("start", {}).get("user", {}).get("name")
                    if not tech:
                        continue

                    existing_evt = ClockEvent.query.filter_by(job_id=job_id, tech_name=tech, hours=hours).first()
                    if existing_evt:
                        existing_evt.created_at = datetime.now(timezone.utc)
                    else:
                        db.session.add(ClockEvent(
                            job_id=job_id,
                            tech_name=tech,
                            hours=hours,
                            created_at=datetime.now(timezone.utc)
                        ))

                    clock_events[tech] = clock_events.get(tech, 0) + hours
                    total_on_site_hours += hours
            except Exception as e:
                tqdm.write(f"⚠️ Error processing clock events for job {job_id}: {e}")

    db_job.total_on_site_hours = total_on_site_hours
    db_job.revenue = invoice_total

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        tqdm.write(f"[ERROR] Failed to save job {job_id}: {e}")
        raise

    return job_id, {
        "job": db_job,
        "clockEvents": clock_events,
        "onSiteHours": total_on_site_hours
    }



def get_jobs_with_params(params, desc="Fetching Jobs"):
    """
    Generalized job fetcher based on params.
    Returns a full list of jobs across paginated responses.
    """
    jobs = []

    response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/job", params)
    if not response:
        tqdm.write("Failed to fetch jobs.")
        return jobs

    data = response.json().get("data", {})
    total_pages = data.get("totalPages", 1)
    jobs.extend(data.get("jobs", []))

    if total_pages > 1:
        for page_num in tqdm(range(2, total_pages + 1), desc=desc):
            params["page"] = page_num
            response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/job", params)
            if not response:
                tqdm.write(f"Failed to fetch page {page_num}")
                continue
            page_data = response.json().get("data", {})
            jobs.extend(page_data.get("jobs", []))
    tqdm.write(f"Number of jobs with params: {len(jobs)}")

    return jobs

def jobs_summary(overwrite=False, start_date=None, end_date=None):
    authenticate()

    db_job_entry = {}

    if not start_date or not end_date:
        start_date = datetime(2024, 5, 1, 0, 0)
        end_date   = datetime(2025, 4, 30, 23, 59)

    window_start = datetime.timestamp(start_date)
    window_end   = datetime.timestamp(end_date)

    base_params = {
        "status": "completed",
        "completedOnBegin": window_start,
        "completedOnEnd":   window_end,
        "page":  1,
        "limit": 100
    }


    jobs = get_jobs_with_params(base_params, desc="Fetching Completed Job Pages")

    tqdm.write(f"Jobs completed in {start_date} - {end_date}: {len(jobs)}")

    # Process completed jobs
    with tqdm(total=len(jobs), desc="Processing Completed Jobs") as pbar:
        for job in jobs:
            try:
                job_id, job_data = fetch_invoice_and_clock(job, overwrite=overwrite)
                db_job_entry[job_id] = job_data
            except Exception as exc:
                tqdm.write(f"A job failed with exception: {exc}")
            pbar.update(1)

    # --- Scheduled jobs that are not complete from fiscal year ---
    scheduled_job_params = {
        "status":             "scheduled",
        "scheduleDateFrom":   window_start,
        "scheduleDateTo":     window_end,
        "page":               1,
        "limit":              100
    }
    scheduled_jobs = get_jobs_with_params(
        scheduled_job_params,
        desc="Fetching Additional Jobs"
    )

    if scheduled_jobs:
        tqdm.write(f"Processing {len(scheduled_jobs)} additional jobs with alternate criteria.")
        with tqdm(total=len(scheduled_jobs), desc="Processing Additional Jobs") as pbar:
            for job in scheduled_jobs:
                try:
                    job_id, job_data = fetch_invoice_and_clock(job, overwrite=overwrite)
                    db_job_entry[job_id] = job_data
                except Exception as exc:
                    tqdm.write(f"A job failed with exception: {exc}")
                pbar.update(1)

    tqdm.write("\nAll jobs processed.")
    return db_job_entry



def get_deficiencies_with_params(params, desc="Fetching deficiencies"):
    """
    Generalized job fetcher based on params.
    Returns a full list of deficiencies across paginated responses.
    """
    deficiencies = []

    response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/deficiency", params)
    if not response:
        tqdm.write("Failed to fetch deficiencies.")
        return deficiencies

    data = response.json().get("data", {})
    total_pages = data.get("totalPages", 1)
    deficiencies.extend(data.get("deficiencies", []))

    if total_pages > 1:
        for page_num in tqdm(range(2, total_pages + 1), desc=desc):
            params["page"] = page_num
            response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/deficiency", params)
            if not response:
                tqdm.write(f"Failed to fetch page {page_num}")
                continue
            page_data = response.json().get("data", {})
            deficiencies.extend(page_data.get("deficiencies", []))
    tqdm.write(f"Number of deficiencies with params: {len(deficiencies)}")

    return deficiencies

def update_deficiencies(start_date=None, end_date=None):
    authenticate()
    if not start_date or not end_date:
        start_date = datetime(2024, 5, 1, 0, 0)
        end_date   = datetime(2025, 4, 30, 23, 59)

    window_start = start_date
    window_end   = end_date

    deficiency_params = {
        "createdAfter": datetime.timestamp(window_start),
        "createdBefore": datetime.timestamp(window_end),
        "limit": 500
    }

    deficiencies = get_deficiencies_with_params(params=deficiency_params)

    tqdm.write(f"Number of deficiencies fetched: {len(deficiencies)}")

    with tqdm(total=len(deficiencies), desc="Saving Deficiencies to DB") as pbar:
        for d in deficiencies:
            try:
                reporter = d.get("reporter")
                service_line = d.get("serviceLine")
                job = d.get("job")
                location = d.get("location")

                job_id = job["id"] if job else -1
                location_id = location["id"] if location else -1

                deficiency = Deficiency.query.filter_by(deficiency_id=d["id"]).first()
                if not deficiency:
                    deficiency = Deficiency(deficiency_id=d["id"])

                has_attachment = False
                attachment_uploaded_by = None
                attachment_endpoint = f"{SERVICE_TRADE_API_BASE}/attachment"
                attachment_params = {
                    "entityId": d["id"],
                    "entityType": 10     # 10 is deficiency
                }
                response = call_service_trade_api(attachment_endpoint, attachment_params)
                if response:
                    data = response.json().get("data")
                    attachments = data.get("attachments")
                    if len(attachments) > 0:
                        attachment_uploaded_by = attachments[0]["creator"]["name"]
                        has_attachment = True

                deficiency.attachment_uploaded_by = attachment_uploaded_by
                deficiency.has_attachment = has_attachment
                deficiency.description = d["description"]
                deficiency.status = d["status"]
                deficiency.reported_by = reporter["name"] if reporter else "Unknown"
                deficiency.service_line = service_line["name"] if service_line else "Unknown"
                deficiency.job_id = job_id
                deficiency.location_id = location_id
                deficiency.deficiency_created_on = datetime.fromtimestamp(d["created"])
                deficiency.orphaned = job_id == -1

                db.session.add(deficiency)

            except Exception as e:
                tqdm.write(f"[WARNING] Skipped deficiency {d.get('id')} | Error: {type(e).__name__}: {e}")
            pbar.update(1)

    db.session.commit()
    tqdm.write("✅ All deficiencies processed and saved.")


def update_deficiencies_attachments(start_date=None, end_date=None):
    authenticate()

    if not start_date or not end_date:
        start_date = datetime(2024, 5, 1, 0, 0)
        end_date   = datetime(2025, 4, 30, 23, 59)

    tqdm.write(f"Fetching deficiencies created between {start_date} and {end_date}...")

    # Filter deficiencies based on created_at range
    all_defs = Deficiency.query.filter(
        Deficiency.created_at >= start_date,
        Deficiency.created_at <= end_date
    ).all()

    tqdm.write(f"Updating attachment info on {len(all_defs)} deficiencies…")

    with tqdm(total=len(all_defs), desc="Updating Deficiencies") as pbar:
        for deficiency in all_defs:
            try:
                if deficiency.has_attachment is True:
                    pbar.update(1)
                    continue
                # hit the Service Trade API for attachments
                attachment_endpoint = f"{SERVICE_TRADE_API_BASE}/attachment"
                attachment_params = {
                    "entityId":   deficiency.deficiency_id,
                    "entityType": 10  # 10 = deficiency
                }
                response = call_service_trade_api(attachment_endpoint, attachment_params)

                has_att = False
                uploaded_by = None

                if response:
                    data = response.json().get("data", {})
                    attachments = data.get("attachments", [])
                    if attachments:
                        has_att = True
                        uploaded_by = attachments[0].get("creator", {}).get("name")
                        tqdm.write(f"Attachment on deficiency {deficiency.deficiency_id} uploaded by {uploaded_by}")

                # update fields
                deficiency.has_attachment         = has_att
                deficiency.attachment_uploaded_by = uploaded_by

                db.session.add(deficiency)

            except Exception as e:
                tqdm.write(f"[WARNING] Failed updating {deficiency.deficiency_id}: {e!r}")

            pbar.update(1)

    db.session.commit()
    tqdm.write("✅ All deficiencies’ attachment info updated.")

def get_locations_with_params(params, desc="Fetching locations"):
    """
    Generalized job fetcher based on params.
    Returns a full list of deficiencies across paginated responses.
    """
    locations = []

    response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/location", params)
    if not response:
        tqdm.write("Failed to fetch locations.")
        return locations

    data = response.json().get("data", {})
    total_pages = data.get("totalPages", 1)
    locations.extend(data.get("locations", []))

    if total_pages > 1:
        for page_num in tqdm(range(2, total_pages + 1), desc=desc):
            params["page"] = page_num
            response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/location", params)
            if not response:
                tqdm.write(f"Failed to fetch page {page_num}")
                continue
            page_data = response.json().get("data", {})
            locations.extend(page_data.get("locations", []))

    return locations 

def update_locations():
    authenticate()

    all_locations = []
    for status in ["active", "inactive"]:
        params = {
            "page": 1,
            "limit": 500,
            "status": status
        }
        locations = get_locations_with_params(params=params)
        tqdm.write(f"📦 {status.title()} locations fetched: {len(locations)}")
        for loc in locations:
            loc["status"] = status
        all_locations.extend(locations)

    tqdm.write(f"🔄 Processing {len(all_locations)} total locations...")

    with tqdm(total=len(all_locations), desc="Saving Locations to DB") as pbar:
        for loc in all_locations:
            try:
                location_id = loc.get("id")
                address     = loc.get("address", {})
                company     = loc.get("company", {})
                created_ts  = loc.get("created")

                street        = address.get("street", "Unknown")
                status        = loc.get("status", "Unknown")
                company_name  = company.get("name", "Unknown")
                company_id    = company.get("id")
                created_on_st = datetime.fromtimestamp(created_ts) if created_ts else None

                location = Location.query.filter_by(location_id=location_id).first()

                if not location:
                    # New location
                    location = Location(
                        location_id=location_id,
                        street=street,
                        status=status,
                        company_name=company_name,
                        company_id=company_id,
                        created_on_st=created_on_st
                    )
                    db.session.add(location)
                    tqdm.write(f"Added new location {location_id}")
                else:
                    # Existing: check if any field changed
                    updated = False
                    if location.street != street:
                        location.street = street
                        updated = True
                    if location.status != status:
                        location.status = status
                        updated = True
                    if location.company_name != company_name:
                        location.company_name = company_name
                        updated = True
                    if location.company_id != company_id:
                        location.company_id = company_id
                        updated = True
                    if location.created_on_st != created_on_st:
                        location.created_on_st = created_on_st
                        updated = True

                    if updated:
                        db.session.add(location)
                        tqdm.write(f"Updated location {location_id}")

            except Exception as e:
                tqdm.write(f"[WARNING] Skipped location {loc.get('id')} | {type(e).__name__}: {e}")
            pbar.update(1)

    db.session.commit()
    tqdm.write("✅ All locations processed and saved.")



def get_quotes_with_params(params, desc="Fetching quotes"):
    """
    Generalized job fetcher based on params.
    Returns a full list of quotes across paginated responses.
    """
    quotes = []

    response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/quote", params)
    if not response:
        tqdm.write("Failed to fetch quotes.")
        return quotes

    data = response.json().get("data", {})
    total_pages = data.get("totalPages", 1)
    quotes.extend(data.get("quotes", []))

    if total_pages > 1:
        for page_num in tqdm(range(2, total_pages + 1), desc=desc):
            params["page"] = page_num
            response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/quote", params)
            if not response:
                tqdm.write(f"Failed to fetch page {page_num}")
                continue
            page_data = response.json().get("data", {})
            quotes.extend(page_data.get("quotes", []))

    return quotes 

def update_quotes(start_date=None, end_date=None):
    authenticate()

    if not start_date or not end_date:
        start_date = datetime(2024, 5, 1, 0, 0)
        end_date   = datetime(2025, 4, 30, 23, 59)

    start_ts = datetime.timestamp(start_date)
    end_ts   = datetime.timestamp(end_date)

    base_params = {
        "createdAfter": start_ts,
        "createdBefore": end_ts,
    }

    # --- 1. Fetch all quotes within the timeframe
    all_quotes = get_quotes_with_params(params=base_params)
    tqdm.write(f"✅ Found {len(all_quotes)} quotes in {start_date} - {end_date}")

    # --- 2. Fetch deficiency-linked quotes in same window
    known_deficiencies = Deficiency.query.with_entities(Deficiency.deficiency_id).all()
    deficiency_ids = [d[0] for d in known_deficiencies]

    linked_quotes = []
    for d_id in tqdm(deficiency_ids, desc="Fetching linked quotes"):
        params = {
            "createdAfter": start_ts,
            "createdBefore": end_ts,
            "deficiencyId": d_id
        }
        quotes = get_quotes_with_params(params=params)
        for q in quotes:
            q["linked_deficiency_id"] = d_id
        linked_quotes.extend(quotes)

    # Index linked quotes by ID for later matching
    quote_deficiency_map = {q["id"]: q["linked_deficiency_id"] for q in linked_quotes}

    # --- 3. Save all quotes, with any link if present
    with tqdm(total=len(all_quotes), desc="Saving quotes to DB") as pbar:
        for q in all_quotes:
            try:
                quote_id = q["id"]
                customer_name = q["customer"]["name"]
                location_id = q["location"]["id"]
                location_address = q["location"]["address"]["street"]
                status = q["status"]
                quote_created_on = datetime.fromtimestamp(q["created"])
                total_price_raw = q["totalPrice"]
                total_price = float(total_price_raw.replace(",", "")) if isinstance(total_price_raw, str) else total_price_raw
                quote_request = q["quoteRequest"]["status"]
                owner_id = q["owner"]["id"]
                owner_email = q["owner"]["email"]

                job_created = len(q["jobs"]) > 0
                job_id = q["jobs"][0]["id"] if job_created else -1
                linked_deficiency_id = quote_deficiency_map.get(quote_id)

                quote = Quote.query.filter_by(quote_id=quote_id).first()
                if not quote:
                    quote = Quote(quote_id=quote_id)

                quote.customer_name = customer_name
                quote.location_id = location_id
                quote.location_address = location_address
                quote.status = status
                quote.quote_created_on = quote_created_on
                quote.total_price = total_price
                quote.quote_request = quote_request
                quote.owner_id = owner_id
                quote.owner_email = owner_email
                quote.job_created = job_created
                quote.job_id = job_id
                quote.linked_deficiency_id = linked_deficiency_id

                db.session.add(quote)

            except Exception as e:
                tqdm.write(f"[WARNING] Skipped quote {q.get('id')} | Error: {type(e).__name__}: {e}")
            pbar.update(1)

    db.session.commit()
    tqdm.write("✅ All quotes processed and saved.")


def test():
    authenticate()
    endpoint = f"{SERVICE_TRADE_API_BASE}/invoice/1876570907636161"
    params = {
        "page": 1
    }
    response = call_service_trade_api(endpoint, params)
    data = response.json().get("data")
    print(json.dumps(data, indent=4))

def test_update_invoice():
    authenticate()

    # hardcode the invoice you want to upsert
    invoice_id = '1954194748431297'
    endpoint   = f"{SERVICE_TRADE_API_BASE}/invoice/{invoice_id}"

    # fetch page 1 of that invoice
    resp = call_service_trade_api(endpoint, params={"page": 1})
    resp.raise_for_status()
    data = resp.json().get("data", {}) or {}

    # grab the job ID so we know how to link InvoiceItems
    job_id = data.get("job", {}).get("id")
    if not job_id:
        print(f"No job attached to invoice {invoice_id}, aborting")
        return

    items = data.get("items") or []
    if not isinstance(items, list):
        print(f"Unexpected items format for invoice {invoice_id}")
        return

    updated = 0
    for item in items:
        try:
            st_id_str = str(item.get("id", ""))
            desc      = item.get("description") or ""
            qty       = float(item.get("quantity") or 0)
            up        = float(item.get("price") or 0.0)
            total_pr  = float(item.get("totalPrice") or 0.0)

            # normalize once for performance
            desc_lower = desc.lower()

            if any(keyword.lower() in desc_lower for keyword in FA_LABOUR_DESCRIPTIONS):
                itype = 'fa_labour'
            elif any(keyword.lower() in desc_lower for keyword in SPR_LABOUR_DESCRIPTIONS):
                itype = 'spr_labour'
            else:
                itype = 'part'

            # upsert
            ii = InvoiceItem.query.filter_by(
                invoice_id=invoice_id,
                service_trade_id=st_id_str
            ).first()
            if not ii:
                ii = InvoiceItem(
                    invoice_id=invoice_id,
                    job_id=job_id,
                    service_trade_id=st_id_str
                )
            ii.description = desc
            ii.item_type   = itype
            ii.quantity    = qty
            ii.unit_price  = up
            ii.total_price = total_pr

            db.session.add(ii)
            updated += 1

        except Exception as e:
            db.session.rollback()
            print(f"[WARNING] Skipping item {item.get('id')} for invoice {invoice_id}: {e}")

    # commit all at once
    db.session.commit()
    print(f"✅ Updated {updated} invoice items for invoice {invoice_id}")

def test_update_quote():
    """
    Fetches a single quote by hardcoded ID, upserts its line items into the QuoteItem table.
    """
    # Authenticate to ServiceTrade API
    authenticate()

    

    # Hardcoded quote ID to update
    quote_id = '1926124817413889'
    endpoint = f"{SERVICE_TRADE_API_BASE}/quote/{quote_id}/item"

    # Fetch first page of items
    resp = call_service_trade_api(endpoint, params={"page": 1})
    resp.raise_for_status()
    data = resp.json().get('data', {}) or {}

    items = data.get('items') or []
    if not isinstance(items, list):
        print(f"Unexpected items format for quote {quote_id}")
        return

    updated = 0
    for item in items:
        try:
            st_id_str = str(item.get('id', ''))
            desc      = item.get('description') or ''
            qty       = float(item.get('quantity') or 0)
            up        = float(item.get('price') or 0.0)
            total_pr = qty * up

            # normalize once for performance
            desc_lower = desc.lower()

            if any(keyword.lower() in desc_lower for keyword in FA_LABOUR_DESCRIPTIONS):
                itype = 'fa_labour'
            elif any(keyword.lower() in desc_lower for keyword in SPR_LABOUR_DESCRIPTIONS):
                itype = 'spr_labour'
            else:
                itype = 'part'

            # Upsert QuoteItem
            qi = QuoteItem.query.filter_by(
                quote_id=quote_id,
                service_trade_id=st_id_str
            ).first()
            if not qi:
                qi = QuoteItem(quote_id=quote_id, service_trade_id=st_id_str)
            qi.description = desc
            qi.item_type   = itype
            qi.quantity    = qty
            qi.unit_price  = up
            qi.total_price = total_pr

            db.session.add(qi)
            updated += 1

        except Exception as e:
            db.session.rollback()
            print(f"[WARNING] Skipping item {item.get('id')} for quote {quote_id}: {e}")

    # Commit all
    db.session.commit()
    print(f"✅ Updated {updated} quote items for quote {quote_id}")

def quoteItemInvoiceItem(start_date=None, end_date=None, batch_size=100):
    authenticate()
    if not start_date or not end_date:
        start_date = datetime(2024, 5, 1)
        end_date   = datetime(2025, 4, 30, 23, 59)
    fy_start = datetime.timestamp(start_date)
    fy_end   = datetime.timestamp(end_date)
    base_params = {"createdAfter": fy_start, "createdBefore": fy_end}

    # Fetch quotes
    try:
        all_quotes = get_quotes_with_params(params=base_params) or []
    except Exception as e:
        tqdm.write(f"[ERROR] Failed to fetch quotes: {e}")
        return

    tqdm.write(f"✅ Found {len(all_quotes)} quotes in {fy_start} - {fy_end}")

    quote_counter = 0
    with tqdm(total=len(all_quotes), desc="Saving Quote Items to DB") as pbar:
        for q in all_quotes:
            quote_id = q.get("id")
            items_meta = q.get("items")
            if not isinstance(items_meta, list) or not items_meta:
                pbar.update(1)
                continue

            page = 1
            while True:
                try:
                    endpoint = f"{SERVICE_TRADE_API_BASE}/quote/{quote_id}/item"
                    resp = call_service_trade_api(endpoint, params={"page": page})
                    resp.raise_for_status()
                    data = resp.json().get("data", {}) or {}
                except Exception as e:
                    tqdm.write(f"[WARNING] Quote {quote_id} page {page} API error: {e}")
                    break

                items = data.get("items")
                if not isinstance(items, list):
                    tqdm.write(f"[WARNING] Unexpected items format for quote {quote_id} page {page}")
                    break

                for item in items:
                    try:
                        st_id_str = str(item.get("id", ""))
                        desc      = item.get("description") or ""
                        qty       = float(item.get("quantity") or 0)
                        up        = float(item.get("price") or 0.0)
                        raw_tax   = item.get("taxRate")
                        tax_pct   = float(raw_tax) if raw_tax not in (None, "") else 0.0
                        total_pr  = up * qty * (1 + tax_pct / 100.0)

                        # normalize once for performance
                        desc_lower = desc.lower()

                        if any(keyword.lower() in desc_lower for keyword in FA_LABOUR_DESCRIPTIONS):
                            itype = 'fa_labour'
                        elif any(keyword.lower() in desc_lower for keyword in SPR_LABOUR_DESCRIPTIONS):
                            itype = 'spr_labour'
                        else:
                            itype = 'part'

                        # upsert
                        qi = QuoteItem.query.filter_by(
                            quote_id=quote_id,
                            service_trade_id=st_id_str
                        ).first()
                        if not qi:
                            qi = QuoteItem(quote_id=quote_id, service_trade_id=st_id_str)
                        qi.description = desc
                        qi.item_type   = itype
                        qi.quantity    = qty
                        qi.unit_price  = up
                        qi.total_price = total_pr
                        db.session.add(qi)

                        quote_counter += 1
                        if quote_counter >= batch_size:
                            db.session.commit()
                            quote_counter = 0

                    except Exception as e:
                        db.session.rollback()
                        tqdm.write(f"[WARNING] Skipping bad quote item {item.get('id')} for quote {quote_id}: {e}")
                        continue

                total_pages = data.get("totalPages") or 1
                if page >= total_pages:
                    break
                page += 1

            pbar.update(1)

    if quote_counter:
        db.session.commit()
    tqdm.write("✅ All quote items saved to DB.")

    # --- INVOICES ---
    invoice_endpoint = f"{SERVICE_TRADE_API_BASE}/invoice"
    all_invoices = []
    page = 1
    while True:
        try:
            resp = call_service_trade_api(invoice_endpoint, params={
                "createdAfter": fy_start,
                "createdBefore": fy_end,
                "page": page
            })
            resp.raise_for_status()
            data = resp.json().get("data", {}) or {}
        except Exception as e:
            tqdm.write(f"[WARNING] Invoice page {page} API error: {e}")
            break

        invoices = data.get("invoices")
        if not isinstance(invoices, list):
            tqdm.write(f"[WARNING] Unexpected invoices format on page {page}")
            break
        all_invoices.extend(invoices)

        total_pages = data.get("totalPages") or 1
        tqdm.write(f"🔄 Fetched page {page}/{total_pages}, got {len(invoices)} invoices")
        if page >= total_pages:
            break
        page += 1

    tqdm.write(f"✅ Retrieved {len(all_invoices)} invoices")

    invoice_counter = 0
    with tqdm(total=len(all_invoices), desc="Saving Invoice Items to DB") as pbar2:
        for inv in all_invoices:
            invoice_id = inv.get("id")
            job_id     = inv.get("job").get("id")
            items      = inv.get("items")
            if not isinstance(items, list) or not items:
                pbar2.update(1)
                continue

            for item in items:
                try:
                    st_id_str   = str(item.get("id", ""))
                    desc        = item.get("description") or ""
                    qty         = float(item.get("quantity") or 0)
                    up          = float(item.get("price") or 0.0)
                    total_pr    = float(item.get("totalPrice") or 0.0)

                    if desc in FA_LABOUR_DESCRIPTIONS:
                        itype = 'fa_labour'
                    elif desc in SPR_LABOUR_DESCRIPTIONS:
                        itype = 'spr_labour'
                    else:
                        itype = 'part'

                    ii = InvoiceItem.query.filter_by(
                        invoice_id=invoice_id,
                        service_trade_id=st_id_str
                    ).first()
                    if not ii:
                        ii = InvoiceItem(
                            invoice_id=invoice_id,
                            job_id=job_id,
                            service_trade_id=st_id_str
                        )
                    ii.description = desc
                    ii.item_type   = itype
                    ii.quantity    = qty
                    ii.unit_price  = up
                    ii.total_price = total_pr
                    db.session.add(ii)

                    invoice_counter += 1
                    if invoice_counter >= batch_size:
                        db.session.commit()
                        invoice_counter = 0

                except Exception as e:
                    db.session.rollback()
                    tqdm.write(f"[WARNING] Skipping bad invoice item {item.get('id')} for invoice {invoice_id}: {e}")
                    continue

            pbar2.update(1)

    if invoice_counter:
        db.session.commit()
    tqdm.write("✅ All invoice items saved to DB.")


def backfill_created_on_st_for_jobs(batch_size=100):
    authenticate()
    tqdm.write("Backfilling created_on_st for existing jobs...")
    jobs = Job.query.filter(Job.created_on_st.is_(None)).all()

    updated = 0
    with tqdm(total=len(jobs), desc="Backfilling jobs") as pbar:
        for job in jobs:
            try:
                job_id = job.job_id
                job_resp = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/job/{job_id}", params={})
                if job_resp:
                    job_data = job_resp.json().get("data", {})
                    created_raw = job_data.get("created")
                    if created_raw:
                        job.created_on_st = datetime.fromtimestamp(created_raw, timezone.utc)
                        db.session.add(job)
                        updated += 1
                        if updated % batch_size == 0:
                            db.session.commit()
            except Exception as e:
                tqdm.write(f"[WARNING] Failed job {job.job_id}: {e}")
            pbar.update(1)

    if updated % batch_size != 0:
        db.session.commit()

    tqdm.write("✅ Finished backfilling created_on_st for jobs.")


def update_all_data(start_date=None, end_date=None):
    if not start_date or not end_date:
        start_date = datetime(2024, 5, 1)
        end_date   = datetime(2025, 4, 30, 23, 59)

    tqdm.write(f"\n🗓 Updating all data from {start_date.date()} to {end_date.date()}")

    jobs_summary(overwrite=True, start_date=start_date, end_date=end_date)
    update_deficiencies(start_date=start_date, end_date=end_date)
    update_quotes(start_date=start_date, end_date=end_date)
    quoteItemInvoiceItem(start_date=start_date, end_date=end_date)
    update_locations()
    update_deficiencies_attachments(start_date=start_date, end_date=end_date)

    tqdm.write("✅ Weekly update complete.")





    

            
                



    


    


