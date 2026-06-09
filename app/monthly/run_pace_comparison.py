"""Compare current-month field pace to the prior calendar month using clock-event timestamps."""

from __future__ import annotations

import calendar
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import func

from app.db_models import MonthlyRouteRun, MonthlyStopClockEvent, MonthlyTestingSiteMonth

PACIFIC_TZ = ZoneInfo("America/Vancouver")

_TESTED_OUTCOMES = frozenset({"all_good", "passed_with_problems", "failed"})


def _prior_month_first(month_first: date) -> date:
    y, m = month_first.year, month_first.month
    if m == 1:
        return date(y - 1, 12, 1)
    return date(y, m - 1, 1)


def _comparison_date_in_month(month_first: date, day_of_month: int) -> date:
    last_day = calendar.monthrange(month_first.year, month_first.month)[1]
    return date(month_first.year, month_first.month, min(day_of_month, last_day))


def _format_time_label(value: time) -> str:
    hour12 = value.hour % 12 or 12
    suffix = "AM" if value.hour < 12 else "PM"
    if value.minute == 0:
        return f"{hour12}:00 {suffix}"
    return f"{hour12}:{value.minute:02d} {suffix}"


def _prior_month_label(month_first: date) -> str:
    return month_first.strftime("%b")


def _to_pacific(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(PACIFIC_TZ)


def _stop_has_closed_clock(mtsm_id: int) -> bool:
    return (
        MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(mtsm_id))
        .filter(MonthlyStopClockEvent.time_out_raw.isnot(None))
        .first()
        is not None
    )


def _completion_pacific_for_stop(mtsm: MonthlyTestingSiteMonth) -> datetime | None:
    """Pacific datetime when the stop's visit closed (first clock-out on the stop)."""
    closed = (
        MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(mtsm.id))
        .filter(MonthlyStopClockEvent.time_out_raw.isnot(None))
        .order_by(MonthlyStopClockEvent.updated_at.asc(), MonthlyStopClockEvent.id.asc())
        .first()
    )
    if closed is None or closed.updated_at is None:
        return None
    return _to_pacific(closed.updated_at)


def _tested_mtsms_for_run(run: MonthlyRouteRun) -> list[MonthlyTestingSiteMonth]:
    return (
        MonthlyTestingSiteMonth.query.filter(
            MonthlyTestingSiteMonth.run_id == int(run.id),
            MonthlyTestingSiteMonth.month_date == run.month_date,
            func.lower(MonthlyTestingSiteMonth.test_outcome).in_(_TESTED_OUTCOMES),
        )
        .all()
    )


def _prior_month_has_clock_events(route_id: int, prior_month_first: date) -> bool:
    prior_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=int(route_id),
        month_date=prior_month_first,
    ).one_or_none()
    if prior_run is None:
        return False
    tested = _tested_mtsms_for_run(prior_run)
    if not tested:
        return False
    return any(_stop_has_closed_clock(int(mtsm.id)) for mtsm in tested)


def _count_tested_stops_on_day_by_time(
    run: MonthlyRouteRun,
    comparison_date: date,
    cutoff_time: time,
) -> int:
    count = 0
    for mtsm in _tested_mtsms_for_run(run):
        completed_at = _completion_pacific_for_stop(mtsm)
        if completed_at is None:
            continue
        if completed_at.date() != comparison_date:
            continue
        if completed_at.time() <= cutoff_time:
            count += 1
    return count


def compute_run_pace_comparison(
    route_id: int,
    month_first: date,
    *,
    now_pacific: datetime | None = None,
) -> dict[str, object] | None:
    """Return pace payload for portal worksheet header, or ``None`` when not applicable."""
    if now_pacific is None:
        now_pacific = datetime.now(PACIFIC_TZ)
    elif now_pacific.tzinfo is None:
        now_pacific = now_pacific.replace(tzinfo=PACIFIC_TZ)
    else:
        now_pacific = now_pacific.astimezone(PACIFIC_TZ)

    current_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=int(route_id),
        month_date=month_first,
    ).one_or_none()
    if current_run is None:
        return None

    prior_month = _prior_month_first(month_first)
    prior_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=int(route_id),
        month_date=prior_month,
    ).one_or_none()
    if prior_run is None:
        return None

    if not _prior_month_has_clock_events(route_id, prior_month):
        return {"available": False}

    comparison_day = now_pacific.day
    cutoff_time = now_pacific.time().replace(microsecond=0)

    current_date = now_pacific.date()
    prior_date = _comparison_date_in_month(prior_month, comparison_day)

    current_count = _count_tested_stops_on_day_by_time(current_run, current_date, cutoff_time)
    prior_count = _count_tested_stops_on_day_by_time(prior_run, prior_date, cutoff_time)

    delta = current_count - prior_count
    if delta > 0:
        status = "ahead"
    elif delta < 0:
        status = "behind"
    else:
        status = "even"

    return {
        "available": True,
        "prior_month_label": _prior_month_label(prior_month),
        "comparison_day": comparison_day,
        "as_of_time_label": _format_time_label(cutoff_time),
        "current_tested_count": current_count,
        "prior_tested_count": prior_count,
        "delta": delta,
        "status": status,
    }
