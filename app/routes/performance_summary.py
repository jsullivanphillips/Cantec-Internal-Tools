from flask import Blueprint, render_template, session, jsonify, request
import random
from app.db_models import db, Job, ClockEvent, Deficiency, Location, Quote, QuoteItem, InvoiceItem
from collections import defaultdict
from tqdm import tqdm
import requests
import numpy as np
import json
from datetime import datetime, timedelta, timezone
from sqlalchemy import func, distinct, case
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

performance_summary_bp = Blueprint('performance_summary', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"

@performance_summary_bp.route('/performance_summary', methods=['GET'])
def performance_summary():
    # Serve the HTML page
    return render_template("performance_summary.html")


@performance_summary_bp.route('/api/performance_summary_data', methods=['GET'])
def performance_summary_data():
    completed_filter = Job.completed_on.isnot(None)

    job_type_counts = get_job_type_counts(completed_filter)
    revenue_by_job_type = get_revenue_by_job_type(completed_filter)
    hours_by_job_type = get_hours_by_job_type(completed_filter)
    total_hours_by_tech = get_total_hours_by_tech()

    avg_revenue_by_job_type, jobs_by_job_type, bubble_data_by_type = get_job_type_analytics(
        job_type_counts, revenue_by_job_type, completed_filter
    )

    avg_revenue_per_hour_by_job_type = get_avg_revenue_per_hour(revenue_by_job_type, hours_by_job_type)
    deficiency_insights = get_deficiency_insights()
    time_to_quote_metrics = get_time_to_quote_metrics()
    technician_metrics = get_technician_metrics()
    weekly_revenue_over_time = get_weekly_revenue_over_time()
    location_service_type_counts = get_top_locations_by_service_type()
    top_customer_revenue = get_top_customers_by_revenue()
    deficiencies_by_tech_sl = get_deficiencies_created_by_tech_service_line()
    attachments_by_tech = get_attachments_by_technician()
    quote_statistics_by_user = get_quote_statistics_by_user()

    # determine your fiscal window (whatever you use for revenue)
    window_start = datetime(2024, 5, 1, tzinfo=timezone.utc)
    window_end   = datetime(2025, 4, 30, tzinfo=timezone.utc)


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
        "weekly_jobs_over_time":     get_weekly_jobs_over_time(),
        "location_service_type_counts": location_service_type_counts,
        "top_customer_revenue": top_customer_revenue,
        "deficiencies_by_service_line": get_deficiencies_by_service_line(),
        "deficiencies_by_tech_service_line": deficiencies_by_tech_sl,
        "attachments_by_tech": attachments_by_tech,
        "quote_statistics_by_user": quote_statistics_by_user,
        "quote_cost_comparison_by_job_type": get_quote_cost_comparison_by_job_type(),
        "quote_accuracy_by_user": get_quote_efficiency_by_user(),
        "quote_cost_breakdown_log": get_detailed_quote_job_stats(db.session),
    })


HOURLY_RATE = {
    'fa':        125.0,
    'sprinkler': 145.0,
    'backflow':   75.0
}

def get_detailed_quote_job_stats(session):
    """
    Returns a breakdown of *all* jobs that were created by one or more quotes,
    merging line‐items from multiple quotes and listing all their quote IDs.
    Grouped by quote owner (user). Excludes in-progress jobs.
    - If the quote did not include “Annual Inspection”, subtract that
      invoice line from the invoice total.
    - If the quote has ONLY spr_labour (and no fa_labour), only count
      clock events for Colin Peterson and Justin Walker.
    - Remove outlier jobs where margin deviates too far from quoted total.
    """
    SPRINKLER_TECHS = {"Colin Peterson", "Justin Walker"}

    # 1) Load every quote that created a completed job
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

    # 2) Group quotes under each job_id
    quotes_by_job = defaultdict(list)
    for q in quotes:
        job = q.job
        if not job or not job.invoice_items or job.completed_on is None:
            continue
        quotes_by_job[job.job_id].append(q)

    # 3) For each job, compute metrics and bucket by owner_email
    buckets_by_user = defaultdict(lambda: {"jobs": [], "margin_sum": 0.0})

    for job_id, quote_list in quotes_by_job.items():
        first_q = quote_list[0]
        job     = first_q.job
        user    = first_q.owner_email or "—"

        # Combine all quote‐items
        all_items = [item for q in quote_list for item in q.items]
        has_spr   = any(item.item_type == 'spr_labour' for item in all_items)
        has_fa    = any(item.item_type == 'fa_labour'  for item in all_items)
        spr_only  = has_spr and not has_fa

        # Quoted totals
        quoted_labor = sum(item.total_price for item in all_items
                           if item.item_type in ('fa_labour','spr_labour'))
        quoted_parts = sum(item.total_price for item in all_items
                           if item.item_type == 'part')
        quoted_total = quoted_labor + quoted_parts

        # Select clock events
        raw_events = job.clock_events or []
        if spr_only:
            clock_events = [evt for evt in raw_events
                            if evt.tech_name in SPRINKLER_TECHS]
        else:
            clock_events = list(raw_events)

        # Actual labor cost
        total_hours  = sum(evt.hours for evt in clock_events)
        rate         = (HOURLY_RATE['sprinkler'] if has_spr else HOURLY_RATE['fa'])
        actual_labor = total_hours * rate

        # Actual parts cost
        actual_parts = sum(inv.total_price for inv in job.invoice_items
                           if inv.item_type == 'part')

        # Compute and adjust invoice revenue
        original_invoice_revenue = sum(inv.total_price for inv in job.invoice_items)
        ai_amt = sum(inv.total_price for inv in job.invoice_items
                     if "annual inspection" in inv.description.lower())
        invoice_revenue = original_invoice_revenue
        if not any("annual inspection" in item.description.lower() for item in all_items):
            invoice_revenue -= ai_amt

        # Margins (quoted vs cost)
        margin_labor = quoted_labor - actual_labor
        margin_parts = quoted_parts - actual_parts
        total_margin = margin_labor + margin_parts

        # Outlier removal
        if quoted_total > 0:
            if abs(total_margin) / quoted_total > OUTLIER_MARGIN_RATIO:
                # skip this job as an outlier
                continue

        # Build human-readable summary lines
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
                f"  • [{itm.item_type}] {itm.description:<30}"
                f" x{itm.quantity:<4} @ ${itm.unit_price:.2f}"
                f" →  ${itm.total_price:.2f}"
            )

        summary_lines += ["", "Invoice Items:"]
        for inv in job.invoice_items:
            summary_lines.append(
                f"  • [{inv.item_type}] {inv.description:<30}"
                f" x{inv.quantity:<4} @ ${inv.unit_price:.2f}"
                f" →  ${inv.total_price:.2f}"
            )

        # Show invoice revenue adjustment
        summary_lines += [
            "",
            f"Invoice Total:         ${original_invoice_revenue:8.2f}"
        ]
        if invoice_revenue != original_invoice_revenue:
            summary_lines += [
                f"Adjusted Invoice Total:${invoice_revenue:8.2f}  "
                f"(-${ai_amt:.2f} Annual Inspection)"
            ]

        summary_lines += ["", "Clock Events:"]
        if clock_events:
            for evt in clock_events:
                summary_lines.append(
                    f"  • {evt.tech_name:<20} {evt.hours:.2f}h"
                )
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

        # Build and store payload
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

    # 4) Assemble and return final results
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

def get_quote_cost_comparison_by_job_type():
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
        if not job or not job.invoice_items:
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
        spr_quoted = any(it.item_type=='spr_labour' for it in all_items)
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


def get_quote_efficiency_by_user():
    """
    Returns per-user quote efficiency:
      - labor_accuracy = avg(actual labor cost / quoted labor cost) per job
      - parts_accuracy = avg(actual parts cost / quoted parts cost) per job
    Excludes outliers where |margin|/quoted_total > OUTLIER_MARGIN_RATIO.
    """
    EXCLUDED_USERS = {"lisa.smirfitt@cantec.ca", "j.zwicker@cantec.ca"}
    EXCLUDED_JOB_TYPES = {
        "installation", "upgrade", "replacement", "inspection",
        "delivery", "pickup", "testing", "unknown", "administrative"
    }

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

    # filter + group by job_id
    quotes_by_job = defaultdict(list)
    for q in quotes:
        user = q.owner_email
        job  = q.job
        jt   = (job.job_type or "").strip().lower() if job else ""
        if (not job
            or not job.invoice_items
            or user in EXCLUDED_USERS
            or jt in EXCLUDED_JOB_TYPES):
            continue
        quotes_by_job[job.job_id].append(q)

    # compute ratios per job, bucket by user
    user_data = defaultdict(lambda: {"labor_ratios": [], "parts_ratios": []})
    for job_id, qlist in quotes_by_job.items():
        first_q = qlist[0]
        user    = first_q.owner_email
        job     = first_q.job

        # flatten items
        all_items = [it for q in qlist for it in q.items]

        # quoted totals
        quoted_labor = sum(it.total_price for it in all_items if it.item_type=='fa_labour') \
                     + sum(it.total_price for it in all_items if it.item_type=='spr_labour')
        quoted_parts = sum(it.total_price for it in all_items if it.item_type=='part')
        quoted_total = quoted_labor + quoted_parts

        # actual cost
        hours = sum(evt.hours for evt in (job.clock_events or []))
        if quoted_labor > 0:
            fa_ratio  = sum(it.total_price for it in all_items if it.item_type=='fa_labour') / quoted_labor
            spr_ratio = sum(it.total_price for it in all_items if it.item_type=='spr_labour') / quoted_labor
            actual_labor = hours * (fa_ratio * HOURLY_RATE['fa'] + spr_ratio * HOURLY_RATE['sprinkler'])
        else:
            actual_labor = hours * HOURLY_RATE['fa']

        actual_parts = sum(inv.total_price for inv in (job.invoice_items or []) if inv.item_type=='part')
        actual_total = actual_labor + actual_parts

        # outlier filter
        if quoted_total > 0 and abs(quoted_total - actual_total) / quoted_total > OUTLIER_MARGIN_RATIO:
            continue

        # efficiency ratios
        labor_ratio = actual_labor / quoted_labor if quoted_labor else None
        parts_ratio = actual_parts / quoted_parts if quoted_parts else None

        if labor_ratio is not None:
            user_data[user]["labor_ratios"].append(labor_ratio)
        if parts_ratio is not None:
            user_data[user]["parts_ratios"].append(parts_ratio)

    # finalize averages
    results = []
    for user, vals in user_data.items():
        lrs = vals["labor_ratios"]
        prs = vals["parts_ratios"]
        avg_labor = round(sum(lrs)/len(lrs), 2) if lrs else None
        avg_parts = round(sum(prs)/len(prs), 2) if prs else None

        results.append({
            "user":           user,
            "labor_accuracy": avg_labor,
            "parts_accuracy": avg_parts
        })

    return results



def get_quote_statistics_by_user():
    """
    Returns a list of dicts, one per owner_email, with counts of:
      - submitted
      - accepted
      - canceled
      - rejected
      - draft
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
        .group_by(Quote.owner_email)
        # optional: order by most submitted first
        .order_by(func.sum(case((Quote.status == "submitted", 1), else_=0)).desc())
        .all()
    )

    # Convert to plain Python dicts
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

def get_deficiencies_created_by_tech_service_line():
    """
    Returns a dict with:
      - technicians: sorted list of tech names
      - service_lines: sorted list of service line names
      - entries: list of { technician, service_line, count }
    """
    rows = (
        db.session
        .query(
            Deficiency.reported_by,
            Deficiency.service_line,
            func.count(Deficiency.id)
        )
        .group_by(Deficiency.reported_by, Deficiency.service_line)
        .all()
    )

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

    return {
        "technicians": sorted(techs),
        "service_lines": sorted(service_lines),
        "entries": entries
    }


def get_attachments_by_technician():
    """
    Returns a list of dicts:
      [
        { "technician": "Alice Smith", "count": 12 },
        { "technician": "Bob Jones",   "count":  8 },
        ...
      ]
    Only counts those deficiencies with has_attachment=True.
    """
    rows = (
        db.session.query(
            Deficiency.attachment_uploaded_by,
            func.count(Deficiency.id)
        )
        .filter(Deficiency.has_attachment.is_(True))
        .group_by(Deficiency.attachment_uploaded_by)
        .all()
    )

    # turn None into "Unknown" (or you can skip if you know it's never null)
    return [
        {"technician": uploader or "Unknown", "count": cnt}
        for uploader, cnt in rows
    ]

def get_top_customers_by_revenue():
    results = (
        db.session.query(Job.customer_name, db.func.sum(Job.revenue))
        .filter(Job.completed_on.isnot(None), Job.revenue.isnot(None))
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




def get_top_locations_by_service_type():
    # Aggregate service call counts separately
    location_stats = (
        db.session.query(
            Job.address,
            db.func.sum(db.case((Job.job_type == 'emergency_service_call', 1), else_=0)).label("emergency_count"),
            db.func.sum(db.case((Job.job_type == 'service_call', 1), else_=0)).label("service_count")
        )
        .filter(
            Job.job_type.in_(["emergency_service_call", "service_call"]),
            Job.completed_on.isnot(None)
        )
        .group_by(Job.address)
        .all()
    )

    # Sort by combined total descending
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


def get_weekly_revenue_over_time():
    # Get all jobs with revenue and completed date
    jobs = db.session.query(Job.completed_on, Job.revenue)\
        .filter(Job.completed_on.isnot(None), Job.revenue.isnot(None))\
        .all()

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


def get_weekly_jobs_over_time():
    # 1. Fetch all completed_on dates
    jobs = (
        db.session.query(Job.completed_on)
        .filter(Job.completed_on.isnot(None))
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


def get_technician_metrics():
    # types to exclude
    EXCLUDE = {"administrative", "delivery", "pickup", "consultation"}
    
    # --- Base filters: only real techs, only completed jobs ---
    base_q = (
        db.session.query(Job.job_id, Job.revenue, ClockEvent.tech_name, ClockEvent.hours, Job.job_type)
        .join(ClockEvent, Job.job_id == ClockEvent.job_id)
        .filter(
            Job.completed_on.isnot(None),
            ClockEvent.tech_name != "Shop Tech",
            ~func.lower(Job.job_type).in_(EXCLUDE)
        )
    )

    # 1️⃣ Gather raw clock+job data for revenue & hours
    revenue_by_tech = {}
    hours_by_tech   = {}
    jobs_set        = {}

    for job_id, revenue, tech, hours, job_type in base_q.all():
        tech = tech or "Unknown"
        jobs_set.setdefault(tech, set()).add(job_id)
        revenue_by_tech[tech] = revenue_by_tech.get(tech, 0) + (revenue or 0)
        hours_by_tech[tech]   = hours_by_tech.get(tech, 0)   + (hours or 0)

    jobs_completed_by_tech = { tech: len(jobs) for tech, jobs in jobs_set.items() }

    revenue_per_hour = {
        tech: round(revenue_by_tech[tech] / hours_by_tech[tech], 2)
              if hours_by_tech[tech] else 0.0
        for tech in revenue_by_tech
    }

    # 2️⃣ Now get the breakdown: jobs completed per job type per tech,
    #    excluding the same four job types.
    raw_counts = (
        db.session.query(
            ClockEvent.tech_name,
            Job.job_type,
            func.count(distinct(Job.job_id))
        )
        .join(Job, Job.job_id == ClockEvent.job_id)
        .filter(
            Job.completed_on.isnot(None),
            ClockEvent.tech_name != "Shop Tech",
            ~func.lower(Job.job_type).in_(EXCLUDE)
        )
        .group_by(ClockEvent.tech_name, Job.job_type)
        .all()
    )

    techs     = set()
    job_types = set()
    entries   = []

    for tech, jt, cnt in raw_counts:
        tech = tech or "Unknown"
        jt   = jt   or "Unknown"
        techs.add(tech)
        job_types.add(jt)
        entries.append({
            "technician": tech,
            "job_type":   jt,
            "count":      cnt
        })

    technicians = sorted(techs)
    job_types   = sorted(job_types)

    return {
        "revenue_per_hour": revenue_per_hour,
        "jobs_completed_by_tech": jobs_completed_by_tech,
        "jobs_completed_by_tech_job_type": {
            "technicians": technicians,
            "job_types":   job_types,
            "entries":     entries
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

def get_total_hours_by_tech():
    return dict(
        db.session.query(ClockEvent.tech_name, db.func.sum(ClockEvent.hours))
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

def get_deficiency_insights():
    total_deficiencies = db.session.query(Deficiency).count()

    quoted_deficiencies = db.session.query(Quote.linked_deficiency_id)\
        .filter(Quote.linked_deficiency_id.isnot(None))\
        .distinct()\
        .count()

    quoted_with_job = db.session.query(Quote.linked_deficiency_id)\
        .filter(Quote.linked_deficiency_id.isnot(None), Quote.job_created.is_(True))\
        .distinct()\
        .count()

    quoted_with_completed_job = db.session.query(Quote.linked_deficiency_id)\
        .join(Job, Quote.job_id == Job.job_id)\
        .filter(
            Quote.linked_deficiency_id.isnot(None),
            Quote.job_created.is_(True),
            Job.completed_on.isnot(None)
        )\
        .distinct()\
        .count()

    return {
        "total_deficiencies": total_deficiencies,
        "quoted_deficiencies": quoted_deficiencies,
        "quoted_with_job": quoted_with_job,
        "quoted_with_completed_job": quoted_with_completed_job
    }

def get_deficiencies_by_service_line():
    from sqlalchemy import func, distinct

    # 1️⃣ Total deficiencies per service line
    total_counts = dict(
        db.session.query(
            Deficiency.service_line,
            func.count(Deficiency.id)
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
        .filter(Quote.linked_deficiency_id.isnot(None))
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
            Job.completed_on.is_(None)        # <— only include jobs not completed
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
            Job.completed_on.isnot(None)
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
            "quoted_no_job":      q_job,          # now only quotes with jobs not yet completed
            "quoted_to_job":      q_job,
            "quoted_to_complete": q_completed
        })

    return result

def get_time_to_quote_metrics():
    deficiency_to_quote_deltas = []
    quote_to_job_deltas = []

    linked_quotes = (
        db.session.query(Quote, Deficiency, Job)
        .outerjoin(Deficiency, Quote.linked_deficiency_id == Deficiency.deficiency_id)
        .outerjoin(Job, Quote.job_id == Job.job_id)
        .filter(Quote.linked_deficiency_id.isnot(None))
        .all()
    )

    for quote, deficiency, job in linked_quotes:
        if deficiency and deficiency.deficiency_created_on and quote.quote_created_on:
            delta1 = quote.quote_created_on - deficiency.deficiency_created_on
            deficiency_to_quote_deltas.append(delta1.days)

        if quote.quote_created_on and job:
            job_date = job.scheduled_date or job.completed_on
            if job_date:
                delta2 = job_date - quote.quote_created_on
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

    # See if we already have this job
    existing_job = Job.query.filter_by(job_id=job_id).first()
    if existing_job:
        # Patch missing location_id if present in payload
        if not existing_job.location_id:
            new_loc = job.get("location", {}).get("id")
            if new_loc:
                existing_job.location_id = new_loc
                db.session.commit()
                tqdm.write(f"✅ Patched location_id for job {job_id} → {new_loc}")

        if not overwrite:
            tqdm.write(f"Skipping job {job_id} (already exists)")
            return job_id, {
                "job": existing_job,
                "clockEvents": {},
                "onSiteHours": existing_job.total_on_site_hours
            }

        # Overwrite=True: update only invoice/revenue, skip any clock logic
        invoice_total = 0
        if existing_job.completed_on:
            inv_ep     = f"{SERVICE_TRADE_API_BASE}/invoice"
            inv_params = {"jobId": job_id}
            inv_resp   = call_service_trade_api(inv_ep, inv_params)
            if inv_resp:
                try:
                    invs = inv_resp.json().get("data", {}).get("invoices", [])
                    invoice_total = sum(inv.get("totalPrice", 0) for inv in invs)
                except Exception as e:
                    tqdm.write(f"⚠️ Failed parsing invoice for job {job_id}: {e}")
            existing_job.revenue = invoice_total
            db.session.commit()

        return job_id, {
            "job": existing_job,
            "clockEvents": {},
            "onSiteHours": existing_job.total_on_site_hours
        }

    # --- Job does not exist: create it and fetch invoice only ---
    job_type      = job.get("type")
    address       = job.get("location", {}).get("address", {}).get("street", "Unknown")
    customer_name = job.get("customer", {}).get("name", "Unknown")
    job_status    = job.get("displayStatus", "Unknown")
    sched_raw     = job.get("scheduledDate")
    scheduled_date = datetime.fromtimestamp(sched_raw, timezone.utc) if sched_raw else None
    comp_raw      = job.get("completedOn")
    completed_on  = datetime.fromtimestamp(comp_raw, timezone.utc) if comp_raw else None

    db_job = Job(
        job_id              = job_id,
        location_id         = job.get("location", {}).get("id"),
        job_type            = job_type,
        address             = address,
        customer_name       = customer_name,
        job_status          = job_status,
        scheduled_date      = scheduled_date,
        completed_on        = completed_on,
        total_on_site_hours = 0,
        revenue             = 0
    )
    db.session.add(db_job)
    db.session.commit()

    # Invoice fetch (if completed)
    invoice_total = 0
    if completed_on:
        inv_ep     = f"{SERVICE_TRADE_API_BASE}/invoice"
        inv_params = {"jobId": job_id}
        inv_resp   = call_service_trade_api(inv_ep, inv_params)
        if inv_resp:
            try:
                invs = inv_resp.json().get("data", {}).get("invoices", [])
                invoice_total = sum(inv.get("totalPrice", 0) for inv in invs)
            except Exception as e:
                tqdm.write(f"⚠️ Failed parsing invoice for job {job_id}: {e}")

        db_job.revenue = invoice_total
        db.session.commit()

    return job_id, {
        "job":        db_job,
        "clockEvents": {},
        "onSiteHours": db_job.total_on_site_hours
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

def jobs_summary(short_run=False, overwrite=False):
    authenticate()

    db_job_entry = {}

    # --- Standard completed jobs from fiscal year ---
    window_start = datetime.timestamp(datetime(2024, 5, 1, 0, 0))
    window_end   = datetime.timestamp(datetime(2025, 4, 30, 23, 59))

    base_params = {
        "status": "completed",
        "completedOnBegin": window_start,
        "completedOnEnd":   window_end,
        "page":  1,
        "limit": 100
    }

    # Fetch completed jobs
    if short_run:
        tqdm.write("Running in short mode (fetching only first page).")
        resp = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/job", base_params)
        jobs = resp.json().get("data", {}).get("jobs", []) if resp else []
    else:
        jobs = get_jobs_with_params(base_params, desc="Fetching Completed Job Pages")

    tqdm.write(f"Jobs completed in 2024–2025 fiscal year: {len(jobs)}")

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

def update_deficiencies():
    authenticate()

    fiscal_year_start = datetime.timestamp(datetime(2024, 5, 1, 0, 0))
    fiscal_year_end = datetime.timestamp(datetime(2025, 4, 30, 23, 59))

    deficiency_params = {
        "createdAfter": fiscal_year_start,
        "createdBefore": fiscal_year_end,
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


def update_deficiencies_attachments():
    authenticate()

    # grab every deficiency in the DB
    all_defs = Deficiency.query.all()
    tqdm.write(f"Updating attachment info on {len(all_defs)} deficiencies…")

    with tqdm(total=len(all_defs), desc="Updating Deficiencies") as pbar:
        for deficiency in all_defs:
            try:
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

                # set fields on the existing object
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
        tqdm.write(f"Number of {status} locations: {len(locations)}")

        for loc in locations:
            loc["status"] = status  # attach status inline
        all_locations.extend(locations)

    tqdm.write(f"Total locations to process: {len(all_locations)}")

    with tqdm(total=len(all_locations), desc="Saving Locations to DB") as pbar:
        for l in all_locations:
            try:
                location_id = l["id"]
                street = l["address"]["street"]
                status = l["status"]
                company_name = l["company"]["name"]
                company_id = l["company"]["id"]

                location = Location.query.filter_by(location_id=location_id).first()
                if not location:
                    location = Location(location_id=location_id)

                location.street = street
                location.status = status
                location.company_name = company_name
                location.company_id = company_id

                db.session.add(location)

            except Exception as e:
                tqdm.write(f"[WARNING] Skipped location {l.get('id')} | Error: {type(e).__name__}: {e}")
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

def update_quotes():
    authenticate()

    fiscal_year_start = datetime.timestamp(datetime(2024, 5, 1, 0, 0))
    fiscal_year_end = datetime.timestamp(datetime(2025, 4, 30, 23, 59))

    base_params = {
        "createdAfter": fiscal_year_start,
        "createdBefore": fiscal_year_end,
    }

    # --- 1. Fetch all quotes within the timeframe
    all_quotes = get_quotes_with_params(params=base_params)
    tqdm.write(f"✅ Found {len(all_quotes)} quotes in fiscal year")

    # --- 2. Fetch deficiency-linked quotes in same window
    known_deficiencies = Deficiency.query.with_entities(Deficiency.deficiency_id).all()
    deficiency_ids = [d[0] for d in known_deficiencies]

    linked_quotes = []
    for d_id in tqdm(deficiency_ids, desc="Fetching linked quotes"):
        params = {
            "createdAfter": fiscal_year_start,
            "createdBefore": fiscal_year_end,
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

def quoteItemInvoiceItem(batch_size=100):

    # Authenticate
    try:
        authenticate()
    except Exception as e:
        tqdm.write(f"[ERROR] Authentication failed: {e}")
        return

    # Time window
    fy_start = datetime.timestamp(datetime(2024, 5, 1))
    fy_end   = datetime.timestamp(datetime(2025, 4, 30, 23, 59))
    base_params = {"createdAfter": fy_start, "createdBefore": fy_end}

    # Fetch quotes
    try:
        all_quotes = get_quotes_with_params(params=base_params) or []
    except Exception as e:
        tqdm.write(f"[ERROR] Failed to fetch quotes: {e}")
        return

    tqdm.write(f"✅ Found {len(all_quotes)} quotes in fiscal year")

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

    # # --- INVOICES ---
    # invoice_endpoint = f"{SERVICE_TRADE_API_BASE}/invoice"
    # all_invoices = []
    # page = 1
    # while True:
    #     try:
    #         resp = call_service_trade_api(invoice_endpoint, params={
    #             "createdAfter": fy_start,
    #             "createdBefore": fy_end,
    #             "page": page
    #         })
    #         resp.raise_for_status()
    #         data = resp.json().get("data", {}) or {}
    #     except Exception as e:
    #         tqdm.write(f"[WARNING] Invoice page {page} API error: {e}")
    #         break

    #     invoices = data.get("invoices")
    #     if not isinstance(invoices, list):
    #         tqdm.write(f"[WARNING] Unexpected invoices format on page {page}")
    #         break
    #     all_invoices.extend(invoices)

    #     total_pages = data.get("totalPages") or 1
    #     tqdm.write(f"🔄 Fetched page {page}/{total_pages}, got {len(invoices)} invoices")
    #     if page >= total_pages:
    #         break
    #     page += 1

    # tqdm.write(f"✅ Retrieved {len(all_invoices)} invoices")

    # invoice_counter = 0
    # with tqdm(total=len(all_invoices), desc="Saving Invoice Items to DB") as pbar2:
    #     for inv in all_invoices:
    #         invoice_id = inv.get("id")
    #         job_id     = inv.get("job").get("id")
    #         items      = inv.get("items")
    #         if not isinstance(items, list) or not items:
    #             pbar2.update(1)
    #             continue

    #         for item in items:
    #             try:
    #                 st_id_str   = str(item.get("id", ""))
    #                 desc        = item.get("description") or ""
    #                 qty         = float(item.get("quantity") or 0)
    #                 up          = float(item.get("price") or 0.0)
    #                 total_pr    = float(item.get("totalPrice") or 0.0)

    #                 if desc in FA_LABOUR_DESCRIPTIONS:
    #                     itype = 'fa_labour'
    #                 elif desc in SPR_LABOUR_DESCRIPTIONS:
    #                     itype = 'spr_labour'
    #                 else:
    #                     itype = 'part'

    #                 ii = InvoiceItem.query.filter_by(
    #                     invoice_id=invoice_id,
    #                     service_trade_id=st_id_str
    #                 ).first()
    #                 if not ii:
    #                     ii = InvoiceItem(
    #                         invoice_id=invoice_id,
    #                         job_id=job_id,
    #                         service_trade_id=st_id_str
    #                     )
    #                 ii.description = desc
    #                 ii.item_type   = itype
    #                 ii.quantity    = qty
    #                 ii.unit_price  = up
    #                 ii.total_price = total_pr
    #                 db.session.add(ii)

    #                 invoice_counter += 1
    #                 if invoice_counter >= batch_size:
    #                     db.session.commit()
    #                     invoice_counter = 0

    #             except Exception as e:
    #                 db.session.rollback()
    #                 tqdm.write(f"[WARNING] Skipping bad invoice item {item.get('id')} for invoice {invoice_id}: {e}")
    #                 continue

    #         pbar2.update(1)

    # if invoice_counter:
    #     db.session.commit()
    # tqdm.write("✅ All invoice items saved to DB.")





    

            
                



    


    


