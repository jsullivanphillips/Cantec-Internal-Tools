"""Company-wide monthly billing board (active locations × calendar quarter)."""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload, selectinload

from app.db_models import (
    MonthlyLocationQuarterBilled,
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteTestHistory,
    MonthlySite,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
    db,
)
from app.monthly.test_day import parse_test_day
from app.monthly.monthly_sites_sync import rollup_price_per_month

_OUTCOME_PRIORITY: tuple[str, ...] = (
    "failed",
    "passed_with_problems",
    "skipped",
    "all_good",
    "tested",
    "annual",
    "pending",
)

_PORTAL_OUTCOMES = frozenset({"all_good", "passed_with_problems", "failed", "skipped"})

_ROUTE_ONLY_RE = re.compile(r"^R?(\d+)$", re.IGNORECASE)


def _route_number_from_filter(route: str) -> int | None:
    """Resolve billing board ``route`` query to a route number (``R10``, ``W1-R10``, etc.)."""
    text = route.strip()
    if not text:
        return None
    m = _ROUTE_ONLY_RE.match(text)
    if m:
        return int(m.group(1))
    try:
        parsed = parse_test_day(text)
    except ValueError:
        return None
    return parsed.route_number if parsed is not None else None


def _billing_board_route_options() -> list[str]:
    """Distinct ``R{n}`` labels for active locations (route-number filter, not raw TEST DAY)."""
    rows = (
        db.session.query(MonthlyRoute.route_number)
        .join(MonthlyRouteLocation, MonthlyRouteLocation.monthly_route_id == MonthlyRoute.id)
        .filter(MonthlyRouteLocation.status_normalized == "active")
        .distinct()
        .order_by(MonthlyRoute.route_number.asc())
        .all()
    )
    labels = [f"R{int(n)}" for (n,) in rows if n is not None]
    if labels:
        return labels
    legacy = (
        MonthlyRouteLocation.query.with_entities(MonthlyRouteLocation.test_day)
        .filter(
            MonthlyRouteLocation.status_normalized == "active",
            MonthlyRouteLocation.test_day.isnot(None),
            MonthlyRouteLocation.test_day != "",
        )
        .distinct()
        .order_by(MonthlyRouteLocation.test_day.asc())
        .all()
    )
    return [value for (value,) in legacy if value]


def _billing_search_filter(q: str):
    """Search address/PMC; match TEST DAY by route suffix when ``q`` looks like ``R10``."""
    clauses: list[object] = [
        func.lower(func.coalesce(MonthlyRouteLocation.address, "")).contains(q),
        func.lower(func.coalesce(MonthlyRouteLocation.display_address, "")).contains(q),
        func.lower(func.coalesce(MonthlyRouteLocation.property_management_company, "")).contains(q),
    ]
    rn = _route_number_from_filter(q)
    if rn is not None:
        clauses.append(func.lower(MonthlyRouteLocation.test_day).like(f"%-r{rn}"))
    else:
        clauses.append(func.lower(func.coalesce(MonthlyRouteLocation.test_day, "")).contains(q))
    return or_(*clauses)


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def quarter_from_anchor_month(month_first: date) -> tuple[int, int, list[date]]:
    """Return (year, quarter 1–4, three month-first dates) for the anchor month's calendar quarter."""
    m = int(month_first.month)
    q = (m - 1) // 3 + 1
    start_month = (q - 1) * 3 + 1
    year = int(month_first.year)
    months = [date(year, start_month + i, 1) for i in range(3)]
    return year, q, months


def resolve_quarter_params(
    *,
    anchor_month: date | None,
    year: int | None,
    quarter: int | None,
) -> tuple[int, int, list[date]] | None:
    if anchor_month is not None:
        return quarter_from_anchor_month(anchor_month)
    if year is not None and quarter is not None and 1 <= int(quarter) <= 4:
        start_month = (int(quarter) - 1) * 3 + 1
        months = [date(int(year), start_month + i, 1) for i in range(3)]
        return int(year), int(quarter), months
    return None


def _outcome_rank(key: str) -> int:
    try:
        return _OUTCOME_PRIORITY.index(key)
    except ValueError:
        return len(_OUTCOME_PRIORITY)


def _rollup_test_summary(
    *,
    test_outcomes: list[str | None],
    result_statuses: list[str | None],
    month_first: date,
    annual_month: str | None,
) -> dict[str, object]:
    """Worst-case test display for a location-month across testing sites."""
    from app.monthly.worksheet_stops import _is_annual_for_month

    keys: list[str] = []
    raw_outcomes: list[str] = []
    for outcome, rs in zip(test_outcomes, result_statuses, strict=False):
        o = (_normalize_text(outcome) or "").lower()
        r = (_normalize_text(rs) or "").lower()
        if o in _PORTAL_OUTCOMES:
            keys.append(o)
            raw_outcomes.append(o)
        elif r == "tested":
            keys.append("all_good")
            raw_outcomes.append("all_good")
        elif r == "skipped":
            keys.append("skipped")
            raw_outcomes.append("skipped")

    if not keys:
        if _is_annual_for_month(month_first, annual_month):
            summary_key = "annual"
        else:
            summary_key = "pending"
        return {
            "summary_key": summary_key,
            "outcomes": raw_outcomes,
            "testing_site_count": max(len(test_outcomes), len(result_statuses)),
        }

    summary_key = min(keys, key=_outcome_rank)
    return {
        "summary_key": summary_key,
        "outcomes": raw_outcomes,
        "testing_site_count": len(raw_outcomes) or max(len(test_outcomes), len(result_statuses)),
    }


def _billing_board_location_query(
    *,
    q: str,
    route: str,
    bill_any_month: bool,
    unset_any_month: bool,
    not_billed_quarter: bool,
    failed_any_month: bool,
    year: int,
    quarter: int,
    month_dates: list[date],
):
    location_query = MonthlyRouteLocation.query.filter(
        MonthlyRouteLocation.status_normalized == "active",
    )
    if q:
        location_query = location_query.filter(_billing_search_filter(q))
    if route:
        route_number = _route_number_from_filter(route)
        if route_number is not None:
            location_query = location_query.filter(
                or_(
                    MonthlyRouteLocation.monthly_route.has(
                        MonthlyRoute.route_number == route_number
                    ),
                    func.lower(MonthlyRouteLocation.test_day).like(f"%-r{route_number}"),
                )
            )
        else:
            location_query = location_query.filter(MonthlyRouteLocation.test_day == route)

    if bill_any_month:
        location_query = location_query.filter(
            MonthlyRouteLocation.id.in_(
                db.session.query(MonthlyRouteTestHistory.location_id).filter(
                    MonthlyRouteTestHistory.month_date.in_(month_dates),
                    MonthlyRouteTestHistory.billing_status == "bill",
                )
            )
        )
    if unset_any_month:
        location_query = location_query.filter(
            MonthlyRouteLocation.id.in_(
                db.session.query(MonthlyRouteTestHistory.location_id).filter(
                    MonthlyRouteTestHistory.month_date.in_(month_dates),
                    or_(
                        MonthlyRouteTestHistory.billing_status.is_(None),
                        MonthlyRouteTestHistory.billing_status == "unset",
                    ),
                )
            )
        )
    if not_billed_quarter:
        billed_ids = (
            db.session.query(MonthlyLocationQuarterBilled.location_id)
            .filter(
                MonthlyLocationQuarterBilled.year == year,
                MonthlyLocationQuarterBilled.quarter == quarter,
            )
        )
        location_query = location_query.filter(~MonthlyRouteLocation.id.in_(billed_ids))
    if failed_any_month:
        location_query = location_query.filter(
            MonthlyRouteLocation.id.in_(
                db.session.query(MonthlySite.legacy_monthly_route_location_id)
                .join(
                    MonthlyTestingSite,
                    MonthlyTestingSite.monthly_site_id == MonthlySite.id,
                )
                .join(
                    MonthlyTestingSiteMonth,
                    MonthlyTestingSiteMonth.monthly_testing_site_id == MonthlyTestingSite.id,
                )
                .filter(
                    MonthlyTestingSiteMonth.month_date.in_(month_dates),
                    MonthlyTestingSiteMonth.test_outcome == "failed",
                    MonthlySite.legacy_monthly_route_location_id.isnot(None),
                )
            )
        )

    return location_query.order_by(MonthlyRouteLocation.address.asc())


def _load_mtsm_by_location_month(
    location_ids: list[int],
    month_dates: list[date],
) -> dict[tuple[int, date], list[tuple[str | None, str | None]]]:
    """Map (location_id, month_date) -> list of (test_outcome, result_status) per testing site."""
    if not location_ids:
        return {}
    rows = (
        db.session.query(
            MonthlySite.legacy_monthly_route_location_id,
            MonthlyTestingSiteMonth.month_date,
            MonthlyTestingSiteMonth.test_outcome,
            MonthlyTestingSiteMonth.result_status,
        )
        .join(MonthlyTestingSite, MonthlyTestingSite.monthly_site_id == MonthlySite.id)
        .join(
            MonthlyTestingSiteMonth,
            MonthlyTestingSiteMonth.monthly_testing_site_id == MonthlyTestingSite.id,
        )
        .filter(
            MonthlySite.legacy_monthly_route_location_id.in_(location_ids),
            MonthlyTestingSiteMonth.month_date.in_(month_dates),
        )
        .all()
    )
    out: dict[tuple[int, date], list[tuple[str | None, str | None]]] = {}
    for lid, month_dt, outcome, rs in rows:
        if lid is None:
            continue
        key = (int(lid), month_dt)
        out.setdefault(key, []).append((outcome, rs))
    return out


def _serialize_board_row(
    loc: MonthlyRouteLocation,
    month_dates: list[date],
    hist_by_loc_month: dict[tuple[int, date], MonthlyRouteTestHistory],
    mtsm_pairs: dict[tuple[int, date], list[tuple[str | None, str | None]]],
    billed_row: MonthlyLocationQuarterBilled | None,
) -> dict[str, object]:
    months_payload: dict[str, dict[str, object]] = {}
    lid = int(loc.id)
    for month_first in month_dates:
        hist = hist_by_loc_month.get((lid, month_first))
        billing = _normalize_text(hist.billing_status) if hist is not None else None
        if billing is None:
            billing = "unset"
        pairs = mtsm_pairs.get((lid, month_first), [])
        if pairs:
            test_outcomes = [p[0] for p in pairs]
            result_statuses = [p[1] for p in pairs]
        elif hist is not None:
            test_outcomes = []
            result_statuses = [hist.result_status]
        else:
            test_outcomes = []
            result_statuses = []
        test_summary = _rollup_test_summary(
            test_outcomes=test_outcomes,
            result_statuses=result_statuses,
            month_first=month_first,
            annual_month=loc.annual_month,
        )
        months_payload[month_first.isoformat()] = {
            "billing_status": billing,
            "test_summary": test_summary,
            "test_monthly_route_id": (
                int(hist.test_monthly_route_id)
                if hist is not None and hist.test_monthly_route_id is not None
                else None
            ),
        }

    rollup: float | None = None
    if loc.monthly_site is not None:
        rp = rollup_price_per_month(loc.monthly_site)
        rollup = float(rp) if rp is not None else None

    from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy
    from app.monthly.testing_site_display import location_row_display_labels

    ts_rows: list[MonthlyTestingSite] = []
    if loc.monthly_site is not None:
        ts_rows = list(loc.monthly_site.testing_sites or [])
    if not ts_rows:
        ts_rows = sync_testing_sites_from_legacy(loc)
    location_label, testing_site_labels = location_row_display_labels(loc, ts_rows)
    route_number: int | None = None
    if loc.monthly_route is not None and loc.monthly_route.route_number is not None:
        route_number = int(loc.monthly_route.route_number)
    elif loc.test_day:
        try:
            parsed = parse_test_day(loc.test_day)
            if parsed is not None:
                route_number = int(parsed.route_number)
        except ValueError:
            pass
    return {
        "location_id": lid,
        "address": loc.address,
        "display_address": loc.display_address,
        "location_label": location_label,
        "testing_site_labels": testing_site_labels,
        "building": loc.building,
        "billing_comments": loc.billing_comments,
        "test_day": loc.test_day,
        "route_number": route_number,
        "monthly_route_id": loc.monthly_route_id,
        "rollup_price_per_month": rollup,
        "months": months_payload,
        "quarter_billed": billed_row is not None,
        "billed_at": billed_row.billed_at.isoformat() if billed_row is not None else None,
        "billed_by": billed_row.billed_by_username if billed_row is not None else None,
    }


def load_billing_board(
    year: int,
    quarter: int,
    month_dates: list[date],
    *,
    q: str = "",
    route: str = "",
    page: int = 1,
    page_size: int = 50,
    bill_any_month: bool = False,
    unset_any_month: bool = False,
    not_billed_quarter: bool = False,
    failed_any_month: bool = False,
) -> dict[str, Any]:
    location_query = _billing_board_location_query(
        q=q.strip().casefold(),
        route=route.strip(),
        bill_any_month=bill_any_month,
        unset_any_month=unset_any_month,
        not_billed_quarter=not_billed_quarter,
        failed_any_month=failed_any_month,
        year=year,
        quarter=quarter,
        month_dates=month_dates,
    ).options(
        joinedload(MonthlyRouteLocation.monthly_route),
        joinedload(MonthlyRouteLocation.monthly_site).selectinload(MonthlySite.testing_sites),
    )

    total_locations = location_query.count()
    total_pages = max((total_locations + page_size - 1) // page_size, 1)
    if page > total_pages:
        page = total_pages
    locations = location_query.offset((page - 1) * page_size).limit(page_size).all()
    location_ids = [int(loc.id) for loc in locations]

    hist_by_loc_month: dict[tuple[int, date], MonthlyRouteTestHistory] = {}
    if location_ids:
        for hist in MonthlyRouteTestHistory.query.filter(
            MonthlyRouteTestHistory.location_id.in_(location_ids),
            MonthlyRouteTestHistory.month_date.in_(month_dates),
        ).all():
            hist_by_loc_month[(int(hist.location_id), hist.month_date)] = hist

    mtsm_pairs = _load_mtsm_by_location_month(location_ids, month_dates)

    billed_by_loc: dict[int, MonthlyLocationQuarterBilled] = {}
    if location_ids:
        for row in MonthlyLocationQuarterBilled.query.filter(
            MonthlyLocationQuarterBilled.location_id.in_(location_ids),
            MonthlyLocationQuarterBilled.year == year,
            MonthlyLocationQuarterBilled.quarter == quarter,
        ).all():
            billed_by_loc[int(row.location_id)] = row

    rows = [
        _serialize_board_row(
            loc,
            month_dates,
            hist_by_loc_month,
            mtsm_pairs,
            billed_by_loc.get(int(loc.id)),
        )
        for loc in locations
    ]

    return {
        "year": year,
        "quarter": quarter,
        "month_dates": [m.isoformat() for m in month_dates],
        "locations": rows,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total_locations,
            "total_pages": total_pages,
        },
    }


def set_location_quarter_billed(
    location_id: int,
    year: int,
    quarter: int,
    *,
    billed: bool,
    username: str | None,
) -> dict[str, object]:
    loc = MonthlyRouteLocation.query.filter_by(id=location_id).one_or_none()
    if loc is None:
        raise LookupError("location_not_found")

    existing = MonthlyLocationQuarterBilled.query.filter_by(
        location_id=location_id,
        year=year,
        quarter=quarter,
    ).one_or_none()

    if not billed:
        if existing is not None:
            db.session.delete(existing)
            db.session.commit()
        return {
            "location_id": location_id,
            "year": year,
            "quarter": quarter,
            "quarter_billed": False,
            "billed_at": None,
            "billed_by": None,
        }

    now = datetime.now(timezone.utc)
    if existing is None:
        from app.monthly.worksheet_stops import _next_sqlite_bigint_id

        row_kw: dict[str, object] = {
            "location_id": location_id,
            "year": year,
            "quarter": quarter,
            "billed_at": now,
            "billed_by_username": username,
        }
        nid = _next_sqlite_bigint_id(MonthlyLocationQuarterBilled)
        if nid is not None:
            row_kw["id"] = nid
        row = MonthlyLocationQuarterBilled(**row_kw)
        db.session.add(row)
    else:
        existing.billed_at = now
        existing.billed_by_username = username
        row = existing
    db.session.commit()
    return {
        "location_id": location_id,
        "year": year,
        "quarter": quarter,
        "quarter_billed": True,
        "billed_at": row.billed_at.isoformat(),
        "billed_by": row.billed_by_username,
    }
