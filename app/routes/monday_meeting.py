from datetime import date, datetime, timezone

import requests
from flask import Blueprint, jsonify, redirect, request, session, url_for
from sqlalchemy import and_, func

from app.db_models import Deficiency, DeficiencyServiceEligibility, Job, Quote, QuoteDeficiencyLink, db
from app.response_cache import cached_json_response
from app.routes.performance_summary import (
    get_date_window,
    get_deficiency_insights,
    get_excluded_non_quoteable_deficiencies,
    quote_excludes_inspection_job,
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


def _earliest_deficiency_dates(quote_ids: list[int]) -> dict[int, date]:
    if not quote_ids:
        return {}
    rows = (
        db.session.query(
            QuoteDeficiencyLink.quote_id,
            func.min(Deficiency.deficiency_created_on),
        )
        .join(Deficiency, QuoteDeficiencyLink.deficiency_id == Deficiency.deficiency_id)
        .filter(QuoteDeficiencyLink.quote_id.in_(quote_ids))
        .group_by(QuoteDeficiencyLink.quote_id)
        .all()
    )
    out: dict[int, date] = {}
    for quote_id, created_on in rows:
        pacific = _to_pacific_date(created_on)
        if pacific is not None:
            out[int(quote_id)] = pacific
    return out


def _build_measurable_sla_row(
    quote: Quote,
    job: Job,
    *,
    business_day_limit: int,
    deficiency_reported: date | None,
) -> dict:
    accepted_dt = quote.quote_accepted_on
    if accepted_dt.tzinfo is None:
        accepted_dt = accepted_dt.replace(tzinfo=timezone.utc)
    accepted_date = accepted_dt.astimezone(PACIFIC_TZ).date()

    scheduled_dt = job.scheduled_date
    if scheduled_dt.tzinfo is None:
        scheduled_dt = scheduled_dt.replace(tzinfo=timezone.utc)
    scheduled_date = scheduled_dt.astimezone(PACIFIC_TZ).date()

    quote_created_date = _to_pacific_date(quote.quote_created_on)
    days_deficiency_to_quote = (
        business_days_between(deficiency_reported, quote_created_date)
        if deficiency_reported and quote_created_date
        else None
    )
    days_quote_to_approval = (
        business_days_between(quote_created_date, accepted_date) if quote_created_date else None
    )
    days_approval_to_scheduled = business_days_between(accepted_date, scheduled_date)
    days_deficiency_to_scheduled = (
        business_days_between(deficiency_reported, scheduled_date) if deficiency_reported else None
    )

    return {
        "quote_id": int(quote.quote_id),
        "job_id": int(job.job_id),
        "customer_name": quote.customer_name,
        "location_address": quote.location_address or job.address,
        "deficiency_reported_on": deficiency_reported.isoformat() if deficiency_reported else None,
        "quote_created_on": quote_created_date.isoformat() if quote_created_date else None,
        "quote_accepted_on": _format_pacific_date(accepted_dt),
        "scheduled_date": _format_pacific_date(scheduled_dt),
        "days_deficiency_to_quote": days_deficiency_to_quote,
        "days_quote_to_approval": days_quote_to_approval,
        "days_approval_to_scheduled": days_approval_to_scheduled,
        "days_deficiency_to_scheduled": days_deficiency_to_scheduled,
        "business_days": days_approval_to_scheduled,
        "within_sla": days_approval_to_scheduled <= business_day_limit,
        "job_url": f"https://app.servicetrade.com/job/{job.job_id}",
    }


def _service_quote_filters(window_start, window_end):
    """Quote window filter plus exclusion of inspection scheduling jobs."""
    return and_(
        _quote_window_filter(window_start, window_end),
        quote_excludes_inspection_job(),
    )


def _deficiency_linked_quote_ids_in_window(window_start, window_end) -> list[int]:
    """Accepted quotes in the window that have at least one deficiency link."""
    rows = (
        db.session.query(Quote.quote_id)
        .join(QuoteDeficiencyLink, Quote.quote_id == QuoteDeficiencyLink.quote_id)
        .outerjoin(Job, Quote.job_id == Job.job_id)
        .filter(
            _service_quote_filters(window_start, window_end),
            Quote.status == "accepted",
            Quote.job_created.is_(True),
            Quote.job_id.isnot(None),
        )
        .distinct()
        .all()
    )
    return [int(r[0]) for r in rows]


def get_scheduled_within_sla_metrics(
    window_start,
    window_end,
    *,
    business_day_limit: int = SCHEDULED_WITHIN_BUSINESS_DAYS_TARGET,
) -> dict:
    """
    Measure business days from quote approval (latestAccepted) to job schedule date.

    Cohort: accepted quotes with jobs in the window that are linked to a deficiency
    (repair quotes generated from deficiencies). Standalone quotes are excluded.
    """
    linked_quote_ids = _deficiency_linked_quote_ids_in_window(window_start, window_end)
    measurable_rows: list[dict] = []
    within_sla_rows: list[dict] = []
    missing_approval_date = 0
    missing_schedule_date = 0

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
            "missing_approval_date": 0,
            "missing_schedule_date": 0,
        }

    sla_rows = (
        db.session.query(Quote, Job)
        .outerjoin(Job, Quote.job_id == Job.job_id)
        .filter(
            _service_quote_filters(window_start, window_end),
            Quote.status == "accepted",
            Quote.job_created.is_(True),
            Quote.job_id.isnot(None),
            Quote.quote_id.in_(linked_quote_ids),
        )
        .all()
    )

    denominator_count = len(sla_rows)
    deficiency_dates = _earliest_deficiency_dates([int(q.quote_id) for q, _ in sla_rows])

    for quote, job in sla_rows:
        if quote.quote_accepted_on is None:
            missing_approval_date += 1
            continue

        if job is None or job.scheduled_date is None:
            missing_schedule_date += 1
            continue

        row = _build_measurable_sla_row(
            quote,
            job,
            business_day_limit=business_day_limit,
            deficiency_reported=deficiency_dates.get(int(quote.quote_id)),
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
        "missing_approval_date": missing_approval_date,
        "missing_schedule_date": missing_schedule_date,
    }


def get_monday_meeting_service_metrics(
    window_start,
    window_end,
    *,
    business_day_limit: int = SCHEDULED_WITHIN_BUSINESS_DAYS_TARGET,
) -> dict:
    deficiency = get_deficiency_insights(
        window_start,
        window_end,
        exclude_inspection_jobs=True,
        exclude_non_quoteable=True,
    )
    total_deficiencies = deficiency["total_deficiencies"]
    quoted_deficiencies = deficiency["quoted_deficiencies"]
    quoted_pct = deficiency["percentages"]["quoted_pct"]
    not_quoted_pct = round(100 - quoted_pct, 1) if total_deficiencies else 0.0

    service_quote_filter = _service_quote_filters(window_start, window_end)

    total_quotes = (
        db.session.query(func.count(Quote.id))
        .outerjoin(Job, Quote.job_id == Job.job_id)
        .filter(service_quote_filter)
        .scalar()
        or 0
    )
    approved_count = (
        db.session.query(func.count(Quote.id))
        .outerjoin(Job, Quote.job_id == Job.job_id)
        .filter(service_quote_filter, Quote.status == "accepted")
        .scalar()
        or 0
    )
    with_job_count = (
        db.session.query(func.count(Quote.id))
        .outerjoin(Job, Quote.job_id == Job.job_id)
        .filter(
            service_quote_filter,
            Quote.status == "accepted",
            Quote.job_created.is_(True),
        )
        .scalar()
        or 0
    )

    repaired_count = deficiency["quoted_with_completed_job"]
    repaired_pct = deficiency["percentages"]["job_completed_pct"]

    sla_metrics = get_scheduled_within_sla_metrics(
        window_start, window_end, business_day_limit=business_day_limit
    )
    classification = get_deficiency_classification_status()

    return {
        "window": {
            "start": window_start.astimezone(PACIFIC_TZ).date().isoformat(),
            "end": window_end.astimezone(PACIFIC_TZ).date().isoformat(),
        },
        "deficiency_quoting": {
            "total": total_deficiencies,
            "quoted": quoted_deficiencies,
            "quoted_pct": quoted_pct,
            "not_quoted_pct": not_quoted_pct,
            "excluded_non_quoteable": deficiency.get("excluded_non_quoteable", 0),
            "excluded_keyword": deficiency.get("excluded_keyword", 0),
            "excluded_stale_cluster": deficiency.get("excluded_stale_cluster", 0),
            "classification": classification,
        },
        "quote_approval": {
            "total_quotes": total_quotes,
            "approved": approved_count,
            "approved_pct": _pct(approved_count, total_quotes),
        },
        "approved_to_job": {
            "approved_total": approved_count,
            "with_job": with_job_count,
            "with_job_pct": _pct(with_job_count, approved_count),
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
    day_limit = SCHEDULED_WITHIN_BUSINESS_DAYS_TARGET
    raw_limit = request.args.get("business_day_limit")
    if raw_limit is not None:
        try:
            day_limit = max(0, int(raw_limit))
        except (TypeError, ValueError):
            pass
    return jsonify(
        get_monday_meeting_service_metrics(
            window_start, window_end, business_day_limit=day_limit
        )
    )


@monday_meeting_bp.route("/api/monday_meeting/service/excluded_deficiencies", methods=["GET"])
@cached_json_response(prefix="monday_meeting:service:excluded", ttl_seconds=180)
def monday_meeting_service_excluded_deficiencies():
    window_start, window_end = get_date_window()
    deficiencies = get_excluded_non_quoteable_deficiencies(window_start, window_end)
    return jsonify(
        {
            "window": {
                "start": window_start.astimezone(PACIFIC_TZ).date().isoformat(),
                "end": window_end.astimezone(PACIFIC_TZ).date().isoformat(),
            },
            "count": len(deficiencies),
            "deficiencies": deficiencies,
        }
    )
