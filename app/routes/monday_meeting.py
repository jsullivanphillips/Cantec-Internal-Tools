from datetime import date, datetime, timezone

import requests
from flask import Blueprint, jsonify, redirect, request, session, url_for
from sqlalchemy import and_, func

from app.db_models import Deficiency, DeficiencyServiceEligibility, Job, Quote, QuoteDeficiencyLink, db
from app.response_cache import cached_json_response, invalidate_cache_prefix
from app.routes.performance_summary import (
    _join_deficiency_service_eligibility,
    deficiency_service_eligible_filter,
    get_date_window,
    get_deficiency_insights,
    get_excluded_non_quoteable_deficiencies,
    get_manual_include_override_deficiencies,
    quote_excludes_inspection_job,
)
from app.deficiency.service_eligibility import (
    clear_deficiency_include_override,
    include_deficiency_override,
)
from app.spa import send_spa_index
from app.utils.business_days import business_days_between
from zoneinfo import ZoneInfo

PACIFIC_TZ = ZoneInfo("America/Vancouver")

monday_meeting_bp = Blueprint("monday_meeting", __name__)

DEFICIENCIES_REPAIRED_TARGET_PCT = 35
SCHEDULED_WITHIN_BUSINESS_DAYS_TARGET = 10
SCHEDULED_WITHIN_BUSINESS_DAYS_GOAL_PCT = 100


def _pct(numerator: int, denominator: int) -> float:
    if not denominator:
        return 0.0
    return round((numerator / denominator) * 100, 1)


def get_deficiency_classification_status() -> dict:
    classified_count = DeficiencyServiceEligibility.query.count() or 0
    last_classified_at = db.session.query(
        func.max(DeficiencyServiceEligibility.classified_at)
    ).scalar()
    return {
        "classified_count": classified_count,
        "needs_classification": classified_count == 0,
        "last_classified_at": (
            last_classified_at.isoformat() if last_classified_at is not None else None
        ),
    }


def _quote_window_filter(window_start, window_end):
    return and_(
        Quote.quote_created_on >= window_start,
        Quote.quote_created_on <= window_end,
    )


def _format_pacific_date(dt) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(PACIFIC_TZ).date().isoformat()


def _to_pacific_date(dt) -> date | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(PACIFIC_TZ).date()
    return None


def _deficiency_info_by_quote(quote_ids: list[int]) -> dict[int, dict]:
    """Earliest linked deficiency date and service line per quote."""
    if not quote_ids:
        return {}
    rows = (
        db.session.query(
            QuoteDeficiencyLink.quote_id,
            Deficiency.deficiency_created_on,
            Deficiency.service_line,
        )
        .join(Deficiency, QuoteDeficiencyLink.deficiency_id == Deficiency.deficiency_id)
        .filter(QuoteDeficiencyLink.quote_id.in_(tuple(quote_ids)))
        .all()
    )
    best: dict[int, tuple[date | None, str | None]] = {}
    for quote_id, created_on, service_line in rows:
        qid = int(quote_id)
        pacific = _to_pacific_date(created_on)
        prev = best.get(qid)
        if prev is None or (pacific is not None and (prev[0] is None or pacific < prev[0])):
            best[qid] = (pacific, service_line)
    out: dict[int, dict] = {}
    for qid, (pacific, service_line) in best.items():
        out[qid] = {
            "deficiency_reported_on": pacific,
            "deficiency_service_line": (service_line or "").strip() or None,
        }
    return out


def _display_user_label(value: str | None) -> str | None:
    if not value or not str(value).strip():
        return None
    text = str(value).strip()
    if "@" in text:
        text = text.split("@", 1)[0]
    text = text.replace(".", " ").replace("_", " ").strip()
    return text.title() if text else None


def _build_measurable_sla_row(
    quote: Quote,
    job: Job,
    *,
    business_day_limit: int,
    deficiency_reported: date | None,
    deficiency_service_line: str | None = None,
) -> dict:
    accepted_dt = quote.quote_accepted_on
    if accepted_dt.tzinfo is None:
        accepted_dt = accepted_dt.replace(tzinfo=timezone.utc)
    accepted_date = accepted_dt.astimezone(PACIFIC_TZ).date()

    action_dt = _job_scheduling_action_at(job)
    assert action_dt is not None
    scheduling_action_date = action_dt.astimezone(PACIFIC_TZ).date()

    appointment_dt = job.scheduled_date
    if appointment_dt is not None and appointment_dt.tzinfo is None:
        appointment_dt = appointment_dt.replace(tzinfo=timezone.utc)

    quote_created_date = _to_pacific_date(quote.quote_created_on)
    days_deficiency_to_quote = (
        business_days_between(deficiency_reported, quote_created_date)
        if deficiency_reported and quote_created_date
        else None
    )
    days_quote_to_approval = (
        business_days_between(quote_created_date, accepted_date) if quote_created_date else None
    )
    days_approval_to_scheduled = business_days_between(accepted_date, scheduling_action_date)
    days_deficiency_to_scheduled = (
        business_days_between(deficiency_reported, scheduling_action_date)
        if deficiency_reported
        else None
    )

    return {
        "quote_id": int(quote.quote_id),
        "job_id": int(job.job_id),
        "location_address": quote.location_address or job.address,
        "deficiency_service_line": deficiency_service_line,
        "quote_created_by": _display_user_label(quote.owner_email) or quote.owner_email,
        "job_created_by": (job.created_by_name or "").strip() or None,
        "deficiency_reported_on": deficiency_reported.isoformat() if deficiency_reported else None,
        "quote_created_on": quote_created_date.isoformat() if quote_created_date else None,
        "quote_accepted_on": _format_pacific_date(accepted_dt),
        "scheduled_on": _format_pacific_date(action_dt),
        "scheduled_date": _format_pacific_date(appointment_dt) if appointment_dt else None,
        "days_deficiency_to_quote": days_deficiency_to_quote,
        "days_quote_to_approval": days_quote_to_approval,
        "days_approval_to_scheduled": days_approval_to_scheduled,
        "days_deficiency_to_scheduled": days_deficiency_to_scheduled,
        "business_days": days_approval_to_scheduled,
        "within_sla": days_approval_to_scheduled <= business_day_limit,
        "job_url": f"https://app.servicetrade.com/job/{job.job_id}",
    }


def _pacific_today() -> date:
    return datetime.now(PACIFIC_TZ).date()


def _days_since_approval(quote: Quote, as_of: date) -> int | None:
    accepted_date = _to_pacific_date(quote.quote_accepted_on)
    if accepted_date is None:
        return None
    return business_days_between(accepted_date, as_of)


def _quote_detail_url(quote_id: int) -> str:
    return f"https://app.servicetrade.com/quotes/view/id/{quote_id}"


def _quote_has_repair_job(quote: Quote) -> bool:
    return bool(quote.job_created and quote.job_id is not None)


def _job_scheduling_action_at(job: Job) -> datetime | None:
    """When office first scheduled the job (appointment created), not the appointment date."""
    action_at = job.first_scheduled_at
    if action_at is None:
        return None
    if action_at.tzinfo is None:
        return action_at.replace(tzinfo=timezone.utc)
    return action_at


def _job_has_scheduling_action(job: Job | None) -> bool:
    return job is not None and _job_scheduling_action_at(job) is not None


def _build_missing_schedule_sla_row(
    quote: Quote,
    job: Job | None,
    *,
    deficiency_reported: date | None,
    deficiency_service_line: str | None = None,
) -> dict:
    accepted_dt = quote.quote_accepted_on
    if accepted_dt is not None:
        if accepted_dt.tzinfo is None:
            accepted_dt = accepted_dt.replace(tzinfo=timezone.utc)
        accepted_on = _format_pacific_date(accepted_dt)
    else:
        accepted_on = None

    quote_created_date = _to_pacific_date(quote.quote_created_on)
    has_job = _quote_has_repair_job(quote)
    job_id = int(job.job_id) if job is not None else (int(quote.job_id) if quote.job_id else None)
    if has_job and job_id is not None:
        job_url = f"https://app.servicetrade.com/job/{job_id}"
    else:
        job_url = _quote_detail_url(int(quote.quote_id))

    return {
        "quote_id": int(quote.quote_id),
        "job_id": job_id,
        "location_address": quote.location_address or (job.address if job else None),
        "deficiency_service_line": deficiency_service_line,
        "quote_created_by": _display_user_label(quote.owner_email) or quote.owner_email,
        "job_created_by": (job.created_by_name or "").strip() or None if job else None,
        "deficiency_reported_on": deficiency_reported.isoformat() if deficiency_reported else None,
        "quote_created_on": quote_created_date.isoformat() if quote_created_date else None,
        "quote_accepted_on": accepted_on,
        "scheduled_date": None,
        "no_job_created": not has_job,
        "no_job_record": has_job and job is None,
        "job_url": job_url,
    }


def _quote_approval_window_filter(window_start, window_end):
    return and_(
        Quote.quote_accepted_on.isnot(None),
        Quote.quote_accepted_on >= window_start,
        Quote.quote_accepted_on <= window_end,
    )


def _sla_quotes_for_approval_window(window_start, window_end) -> list[int]:
    """Accepted deficiency repair quotes approved in the window."""
    query = (
        db.session.query(Quote.quote_id)
        .join(QuoteDeficiencyLink, Quote.quote_id == QuoteDeficiencyLink.quote_id)
        .join(Deficiency, QuoteDeficiencyLink.deficiency_id == Deficiency.deficiency_id)
        .outerjoin(Job, Quote.job_id == Job.job_id)
        .filter(
            _quote_approval_window_filter(window_start, window_end),
            Quote.status == "accepted",
            quote_excludes_inspection_job(),
        )
    )
    query = _join_deficiency_service_eligibility(query).filter(
        deficiency_service_eligible_filter()
    )
    rows = query.distinct().all()
    return [int(r[0]) for r in rows]


def get_scheduled_within_sla_metrics(
    window_start,
    window_end,
    *,
    business_day_limit: int = SCHEDULED_WITHIN_BUSINESS_DAYS_TARGET,
    as_of_date: date | None = None,
) -> dict:
    """
    Measure business days from quote approval to when office first scheduled the job.

    Cohort: accepted deficiency repair quotes approved in the window.
    """
    linked_quote_ids = _sla_quotes_for_approval_window(window_start, window_end)
    measurable_rows: list[dict] = []
    within_sla_rows: list[dict] = []
    awaiting_job_under_sla_rows: list[dict] = []
    awaiting_job_over_sla_rows: list[dict] = []
    unscheduled_under_sla_rows: list[dict] = []
    unscheduled_over_sla_rows: list[dict] = []
    missing_approval_date = 0
    as_of = as_of_date or _pacific_today()

    if not linked_quote_ids:
        return {
            "actual_pct": 0.0,
            "target_pct": SCHEDULED_WITHIN_BUSINESS_DAYS_GOAL_PCT,
            "meeting_goal": False,
            "denominator_count": 0,
            "measurable_count": 0,
            "eligible_count": 0,
            "within_sla_count": 0,
            "business_day_limit": business_day_limit,
            "within_sla_jobs": [],
            "eligible_jobs": [],
            "awaiting_job_under_sla_jobs": [],
            "awaiting_job_over_sla_jobs": [],
            "unscheduled_under_sla_jobs": [],
            "unscheduled_over_sla_jobs": [],
            "missing_approval_date": 0,
            "awaiting_job_under_sla_count": 0,
            "awaiting_job_over_sla_count": 0,
            "unscheduled_under_sla_count": 0,
            "unscheduled_over_sla_count": 0,
        }

    sla_rows = (
        db.session.query(Quote, Job)
        .outerjoin(Job, Quote.job_id == Job.job_id)
        .filter(
            Quote.status == "accepted",
            Quote.quote_id.in_(linked_quote_ids),
        )
        .all()
    )

    denominator_count = len(sla_rows)
    quote_ids = [int(q.quote_id) for q, _ in sla_rows]
    deficiency_info = _deficiency_info_by_quote(quote_ids)

    for quote, job in sla_rows:
        if quote.quote_accepted_on is None:
            missing_approval_date += 1
            continue

        if not _quote_has_repair_job(quote):
            info = deficiency_info.get(int(quote.quote_id), {})
            row = _build_missing_schedule_sla_row(
                quote,
                job,
                deficiency_reported=info.get("deficiency_reported_on"),
                deficiency_service_line=info.get("deficiency_service_line"),
            )
            days_since_approval = _days_since_approval(quote, as_of)
            if days_since_approval is not None:
                row["days_since_approval"] = days_since_approval

            if days_since_approval is not None and days_since_approval > business_day_limit:
                awaiting_job_over_sla_rows.append(row)
            else:
                awaiting_job_under_sla_rows.append(row)
            continue

        if job is None or not _job_has_scheduling_action(job):
            info = deficiency_info.get(int(quote.quote_id), {})
            row = _build_missing_schedule_sla_row(
                quote,
                job,
                deficiency_reported=info.get("deficiency_reported_on"),
                deficiency_service_line=info.get("deficiency_service_line"),
            )
            days_since_approval = _days_since_approval(quote, as_of)
            if days_since_approval is not None:
                row["days_since_approval"] = days_since_approval

            if days_since_approval is not None and days_since_approval > business_day_limit:
                unscheduled_over_sla_rows.append(row)
            else:
                unscheduled_under_sla_rows.append(row)
            continue

        info = deficiency_info.get(int(quote.quote_id), {})
        row = _build_measurable_sla_row(
            quote,
            job,
            business_day_limit=business_day_limit,
            deficiency_reported=info.get("deficiency_reported_on"),
            deficiency_service_line=info.get("deficiency_service_line"),
        )
        measurable_rows.append(row)
        if row["within_sla"]:
            within_sla_rows.append(row)

    within_sla_count = len(within_sla_rows)
    measurable_count = len(measurable_rows)
    sla_pct = _pct(within_sla_count, denominator_count)

    return {
        "actual_pct": sla_pct,
        "target_pct": SCHEDULED_WITHIN_BUSINESS_DAYS_GOAL_PCT,
        "meeting_goal": denominator_count > 0 and sla_pct >= SCHEDULED_WITHIN_BUSINESS_DAYS_GOAL_PCT,
        "denominator_count": denominator_count,
        "measurable_count": measurable_count,
        "eligible_count": denominator_count,
        "within_sla_count": within_sla_count,
        "business_day_limit": business_day_limit,
        "within_sla_jobs": within_sla_rows,
        "eligible_jobs": measurable_rows,
        "awaiting_job_under_sla_jobs": awaiting_job_under_sla_rows,
        "awaiting_job_over_sla_jobs": awaiting_job_over_sla_rows,
        "unscheduled_under_sla_jobs": unscheduled_under_sla_rows,
        "unscheduled_over_sla_jobs": unscheduled_over_sla_rows,
        "missing_approval_date": missing_approval_date,
        "awaiting_job_under_sla_count": len(awaiting_job_under_sla_rows),
        "awaiting_job_over_sla_count": len(awaiting_job_over_sla_rows),
        "unscheduled_under_sla_count": len(unscheduled_under_sla_rows),
        "unscheduled_over_sla_count": len(unscheduled_over_sla_rows),
    }


def get_monday_meeting_service_metrics(
    window_start,
    window_end,
) -> dict:
    deficiency = get_deficiency_insights(
        window_start,
        window_end,
        exclude_inspection_jobs=True,
        exclude_non_quoteable=True,
    )
    total_deficiencies = deficiency["total_deficiencies"]
    quoted_deficiencies = deficiency["quoted_deficiencies"]
    approved_deficiencies = deficiency["approved_deficiencies"]
    quoted_with_job = deficiency["quoted_with_job"]
    quoted_pct = deficiency["percentages"]["quoted_pct"]
    not_quoted_pct = round(100 - quoted_pct, 1) if total_deficiencies else 0.0
    approved_of_quoted_pct = deficiency["percentages"]["approved_of_quoted_pct"]

    quote_window = _quote_window_filter(window_start, window_end)
    all_quotes_total = (
        db.session.query(func.count(Quote.id)).filter(quote_window).scalar() or 0
    )
    all_quotes_approved = (
        db.session.query(func.count(Quote.id))
        .filter(quote_window, Quote.status == "accepted")
        .scalar()
        or 0
    )

    repaired_count = deficiency["quoted_with_completed_job"]
    repaired_pct = deficiency["percentages"]["job_completed_pct"]

    sla_metrics = get_scheduled_within_sla_metrics(window_start, window_end)
    classification = get_deficiency_classification_status()

    return {
        "window": {
            "start": window_start.astimezone(PACIFIC_TZ).date().isoformat(),
            "end": window_end.astimezone(PACIFIC_TZ).date().isoformat(),
        },
        "all_quotes": {
            "total": all_quotes_total,
            "approved": all_quotes_approved,
            "approved_pct": _pct(all_quotes_approved, all_quotes_total),
        },
        "deficiency_pipeline": {
            "total": total_deficiencies,
            "quoted": quoted_deficiencies,
            "quoted_pct": quoted_pct,
            "not_quoted_pct": not_quoted_pct,
            "approved_of_quoted": approved_deficiencies,
            "approved_of_quoted_pct": approved_of_quoted_pct,
            "approved_with_job": quoted_with_job,
            "approved_with_job_pct": _pct(quoted_with_job, approved_deficiencies),
            "excluded_non_quoteable": deficiency.get("excluded_non_quoteable", 0),
            "excluded_keyword": deficiency.get("excluded_keyword", 0),
            "excluded_stale_cluster": deficiency.get("excluded_stale_cluster", 0),
            "classification": classification,
        },
        "goals": {
            "deficiencies_repaired": {
                "actual_pct": repaired_pct,
                "target_pct": DEFICIENCIES_REPAIRED_TARGET_PCT,
                "meeting_goal": repaired_pct >= DEFICIENCIES_REPAIRED_TARGET_PCT,
                "repaired_count": repaired_count,
                "total_deficiencies": total_deficiencies,
            },
            "scheduled_within_10_business_days": sla_metrics,
        },
    }


@monday_meeting_bp.route("/monday_meeting", methods=["GET"])
def monday_meeting_page():
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {
        "username": session.get("username"),
        "password": session.get("password"),
    }
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception:
        return redirect(url_for("auth.login"))
    return send_spa_index()


@monday_meeting_bp.route("/monday_meeting/service/admin", methods=["GET"])
def monday_meeting_service_admin_page():
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {
        "username": session.get("username"),
        "password": session.get("password"),
    }
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception:
        return redirect(url_for("auth.login"))
    return send_spa_index()


@monday_meeting_bp.route("/api/monday_meeting/service", methods=["GET"])
@cached_json_response(prefix="monday_meeting:service", ttl_seconds=180)
def monday_meeting_service():
    window_start, window_end = get_date_window()
    return jsonify(get_monday_meeting_service_metrics(window_start, window_end))


@monday_meeting_bp.route("/api/monday_meeting/service/excluded_deficiencies", methods=["GET"])
@cached_json_response(prefix="monday_meeting:service:excluded", ttl_seconds=180)
def monday_meeting_service_excluded_deficiencies():
    window_start, window_end = get_date_window()
    deficiencies = get_excluded_non_quoteable_deficiencies(window_start, window_end)
    manual_includes = get_manual_include_override_deficiencies(window_start, window_end)
    return jsonify(
        {
            "window": {
                "start": window_start.astimezone(PACIFIC_TZ).date().isoformat(),
                "end": window_end.astimezone(PACIFIC_TZ).date().isoformat(),
            },
            "count": len(deficiencies),
            "deficiencies": deficiencies,
            "manual_include_count": len(manual_includes),
            "manual_includes": manual_includes,
        }
    )


@monday_meeting_bp.route(
    "/api/monday_meeting/service/excluded_deficiencies/<int:deficiency_id>/include",
    methods=["POST"],
)
def monday_meeting_include_excluded_deficiency(deficiency_id: int):
    row = include_deficiency_override(deficiency_id)
    if row is None:
        return jsonify({"error": "not_found_or_not_excluded"}), 404
    invalidate_cache_prefix("monday_meeting:service")
    return jsonify(
        {
            "deficiency_id": deficiency_id,
            "included_override": True,
            "eligible": True,
        }
    )


@monday_meeting_bp.route(
    "/api/monday_meeting/service/excluded_deficiencies/<int:deficiency_id>/include",
    methods=["DELETE"],
)
def monday_meeting_clear_deficiency_include_override(deficiency_id: int):
    row = clear_deficiency_include_override(deficiency_id)
    if row is None:
        return jsonify({"error": "not_found"}), 404
    invalidate_cache_prefix("monday_meeting:service")
    return jsonify(
        {
            "deficiency_id": deficiency_id,
            "included_override": False,
            "eligible": bool(row.eligible),
            "reason": row.reason,
        }
    )
