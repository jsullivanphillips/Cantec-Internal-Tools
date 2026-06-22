"""Company-wide monthly billing board (active locations × calendar quarter)."""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload

from app.db_models import (
    MonthlyLocation,
    MonthlyLocationMonth,
    MonthlyLocationQuarterBilled,
    MonthlyRoute,
    MonthlyRouteRun,
    db,
)
from app.monthly.run_workflow import run_field_ended
from app.monthly.test_day import parse_test_day

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

_SKIP_CATEGORY_LABELS: dict[str, str] = {
    "access_issues": "Access issues",
    "construction": "Construction",
    "lack_of_time": "Lack of time",
    "testing_not_required": "Testing not required",
    "other": "Other",
}

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
        .join(MonthlyLocation, MonthlyLocation.monthly_route_id == MonthlyRoute.id)
        .filter(MonthlyLocation.status_normalized == "active")
        .distinct()
        .order_by(MonthlyRoute.route_number.asc())
        .all()
    )
    labels = [f"R{int(n)}" for (n,) in rows if n is not None]
    if labels:
        return labels
    legacy = (
        MonthlyLocation.query.with_entities(MonthlyLocation.test_day)
        .filter(
            MonthlyLocation.status_normalized == "active",
            MonthlyLocation.test_day.isnot(None),
            MonthlyLocation.test_day != "",
        )
        .distinct()
        .order_by(MonthlyLocation.test_day.asc())
        .all()
    )
    return [value for (value,) in legacy if value]


def _billing_search_filter(q: str):
    """Search address/PMC; match TEST DAY by route suffix when ``q`` looks like ``R10``."""
    clauses: list[object] = [
        func.lower(func.coalesce(MonthlyLocation.address, "")).contains(q),
        func.lower(func.coalesce(MonthlyLocation.display_address, "")).contains(q),
        func.lower(func.coalesce(MonthlyLocation.property_management_company, "")).contains(q),
        func.lower(func.coalesce(MonthlyLocation.label, "")).contains(q),
    ]
    rn = _route_number_from_filter(q)
    if rn is not None:
        clauses.append(func.lower(MonthlyLocation.test_day).like(f"%-r{rn}"))
    else:
        clauses.append(func.lower(func.coalesce(MonthlyLocation.test_day, "")).contains(q))
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


def _skip_category_label(category: str | None) -> str | None:
    key = (_normalize_text(category) or "").lower()
    if not key:
        return None
    return _SKIP_CATEGORY_LABELS.get(key)


def _legacy_skip_reason_category_label(skip_reason: str | None) -> str | None:
    from app.monthly.worksheet_locations import _sheet_skip_reason_is_annual

    if _sheet_skip_reason_is_annual(skip_reason):
        return "Annual"
    raw = _normalize_text(skip_reason)
    if not raw:
        return None
    direct = _skip_category_label(raw)
    if direct:
        return direct
    if ":" in raw:
        prefix = raw.split(":", 1)[0].strip()
        return _skip_category_label(prefix)
    return None


def _location_month_skip_reason_category_label(
    *,
    test_outcome: str | None,
    result_status: str | None,
    skip_category: str | None,
    skip_reason: str | None,
    annual_month: str | None,
    month_first: date,
    loc_annual_month: str | None,
) -> str | None:
    from app.monthly.worksheet_locations import _is_annual_for_month

    outcome = (_normalize_text(test_outcome) or "").lower()
    rs = (_normalize_text(result_status) or "").lower()
    annual = annual_month or loc_annual_month

    if outcome == "skipped" or rs == "skipped":
        if _legacy_skip_reason_category_label(skip_reason) == "Annual":
            return "Annual"
        if (_normalize_text(skip_category) or "").lower() == "annual":
            return "Annual"
        from app.monthly.worksheet_locations import (
            _explicit_skip_reason_blocks_annual_month_inference,
        )

        if not _explicit_skip_reason_blocks_annual_month_inference(
            skip_category=skip_category,
            skip_reason=skip_reason,
        ):
            if _is_annual_for_month(month_first, annual):
                return "Annual"
        cat_label = _skip_category_label(skip_category)
        if cat_label:
            return cat_label
        return _legacy_skip_reason_category_label(skip_reason)

    if _is_annual_for_month(month_first, annual):
        return "Annual"
    return None


def _location_month_skip_reason_note(
    *,
    skip_note: str | None,
    skip_reason: str | None,
) -> str | None:
    note = _normalize_text(skip_note)
    if note:
        return note
    raw = _normalize_text(skip_reason)
    if not raw:
        return None
    if ":" in raw:
        rest = raw.split(":", 1)[1].strip()
        return rest or None
    if _skip_category_label(raw):
        return None
    if _legacy_skip_reason_category_label(raw):
        return None
    return raw


def _rollup_test_summary(
    *,
    test_outcome: str | None,
    result_status: str | None,
    month_first: date,
    annual_month: str | None,
) -> dict[str, object]:
    """Test display for a flat location-month row."""
    from app.monthly.worksheet_locations import _is_annual_for_month

    o = (_normalize_text(test_outcome) or "").lower()
    r = (_normalize_text(result_status) or "").lower()
    raw_outcomes: list[str] = []
    keys: list[str] = []

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
            "testing_site_count": 0,
        }

    summary_key = min(keys, key=_outcome_rank)
    return {
        "summary_key": summary_key,
        "outcomes": raw_outcomes,
        "testing_site_count": 1,
    }


def _billing_board_location_query(
    *,
    q: str,
    route: str,
    do_not_bill_any_month: bool,
    unset_any_month: bool,
    not_billed_quarter: bool,
    non_empty_billing_notes: bool,
    pricing_updated: bool,
    year: int,
    quarter: int,
    month_dates: list[date],
):
    location_query = MonthlyLocation.query.filter(
        MonthlyLocation.status_normalized == "active",
    )
    if q:
        location_query = location_query.filter(_billing_search_filter(q))
    if route:
        route_number = _route_number_from_filter(route)
        if route_number is not None:
            location_query = location_query.filter(
                or_(
                    MonthlyLocation.monthly_route.has(
                        MonthlyRoute.route_number == route_number
                    ),
                    func.lower(MonthlyLocation.test_day).like(f"%-r{route_number}"),
                )
            )
        else:
            location_query = location_query.filter(MonthlyLocation.test_day == route)

    if do_not_bill_any_month:
        location_query = location_query.filter(
            MonthlyLocation.id.in_(
                db.session.query(MonthlyLocationMonth.monthly_location_id).filter(
                    MonthlyLocationMonth.month_date.in_(month_dates),
                    MonthlyLocationMonth.billing_status == "do_not_bill",
                )
            )
        )
    if unset_any_month:
        location_query = location_query.filter(
            MonthlyLocation.id.in_(
                db.session.query(MonthlyLocationMonth.monthly_location_id).filter(
                    MonthlyLocationMonth.month_date.in_(month_dates),
                    or_(
                        MonthlyLocationMonth.billing_status == "unset",
                        MonthlyLocationMonth.billing_status.is_(None),
                        func.trim(func.coalesce(MonthlyLocationMonth.billing_status, "")) == "",
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
        location_query = location_query.filter(~MonthlyLocation.id.in_(billed_ids))
    if non_empty_billing_notes:
        location_query = location_query.filter(
            func.coalesce(func.trim(MonthlyLocation.billing_comments), "") != "",
        )
    if pricing_updated:
        location_query = location_query.filter(MonthlyLocation.pricing_updated.is_(True))

    return location_query.order_by(MonthlyLocation.address.asc())


def _load_mlm_by_location_month(
    location_ids: list[int],
    month_dates: list[date],
) -> dict[tuple[int, date], MonthlyLocationMonth]:
    """Map (location_id, month_date) -> ``MonthlyLocationMonth`` for billing display."""
    if not location_ids:
        return {}
    rows = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.monthly_location_id.in_(location_ids),
            MonthlyLocationMonth.month_date.in_(month_dates),
        )
        .all()
    )
    return {(int(row.monthly_location_id), row.month_date): row for row in rows}


def _resolve_route_id_for_run(
    loc: MonthlyLocation,
    mlm: MonthlyLocationMonth | None,
) -> int | None:
    if mlm is not None and mlm.test_monthly_route_id is not None:
        return int(mlm.test_monthly_route_id)
    if loc.monthly_route_id is not None:
        return int(loc.monthly_route_id)
    return None


def _load_runs_by_route_month(
    pairs: set[tuple[int, date]],
) -> dict[tuple[int, date], MonthlyRouteRun]:
    if not pairs:
        return {}
    route_ids = {pair[0] for pair in pairs}
    month_set = {pair[1] for pair in pairs}
    rows = MonthlyRouteRun.query.filter(
        MonthlyRouteRun.monthly_route_id.in_(route_ids),
        MonthlyRouteRun.month_date.in_(month_set),
    ).all()
    out: dict[tuple[int, date], MonthlyRouteRun] = {}
    for run in rows:
        key = (int(run.monthly_route_id), run.month_date)
        if key in pairs:
            out[key] = run
    return out


def _location_display_label(loc: MonthlyLocation) -> str:
    label = _normalize_text(loc.label)
    if label:
        return label
    addr = _normalize_text(loc.display_address) or _normalize_text(loc.address)
    return addr or f"Location {int(loc.id)}"


def _serialize_board_row(
    loc: MonthlyLocation,
    month_dates: list[date],
    mlm_by_loc_month: dict[tuple[int, date], MonthlyLocationMonth],
    runs_by_route_month: dict[tuple[int, date], MonthlyRouteRun],
    billed_row: MonthlyLocationQuarterBilled | None,
) -> dict[str, object]:
    months_payload: dict[str, dict[str, object]] = {}
    lid = int(loc.id)
    for month_first in month_dates:
        mlm = mlm_by_loc_month.get((lid, month_first))
        billing = _normalize_text(mlm.billing_status) if mlm is not None else None
        if billing is None:
            billing = "unset"
        annual_month = (
            mlm.annual_month
            if mlm is not None and _normalize_text(mlm.annual_month)
            else loc.annual_month
        )
        test_summary = _rollup_test_summary(
            test_outcome=mlm.test_outcome if mlm is not None else None,
            result_status=mlm.result_status if mlm is not None else None,
            month_first=month_first,
            annual_month=annual_month,
        )
        skip_reason_category = None
        skip_reason_note = None
        if billing == "do_not_bill" and mlm is not None:
            skip_reason_category = _location_month_skip_reason_category_label(
                test_outcome=mlm.test_outcome,
                result_status=mlm.result_status,
                skip_category=mlm.skip_category,
                skip_reason=mlm.skip_reason,
                annual_month=mlm.annual_month,
                month_first=month_first,
                loc_annual_month=loc.annual_month,
            )
            skip_reason_note = _location_month_skip_reason_note(
                skip_note=mlm.skip_note,
                skip_reason=mlm.skip_reason,
            )
        route_id_for_run = _resolve_route_id_for_run(loc, mlm)
        run = (
            runs_by_route_month.get((route_id_for_run, month_first))
            if route_id_for_run is not None
            else None
        )
        months_payload[month_first.isoformat()] = {
            "billing_status": billing,
            "test_summary": test_summary,
            "test_monthly_route_id": (
                int(mlm.test_monthly_route_id)
                if mlm is not None and mlm.test_monthly_route_id is not None
                else None
            ),
            "skip_reason_category": skip_reason_category,
            "skip_reason_note": skip_reason_note,
            "field_work_ended": run_field_ended(run),
        }

    price: float | None = None
    if loc.price_per_month is not None:
        price = float(loc.price_per_month)

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
        "location_label": _location_display_label(loc),
        "testing_site_labels": None,
        "building": _normalize_text(loc.label),
        "property_management_company": loc.property_management_company,
        "billing_comments": loc.billing_comments,
        "test_day": loc.test_day,
        "route_number": route_number,
        "monthly_route_id": loc.monthly_route_id,
        "rollup_price_per_month": price,
        "pricing_updated": bool(loc.pricing_updated),
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
    do_not_bill_any_month: bool = False,
    unset_any_month: bool = False,
    not_billed_quarter: bool = False,
    non_empty_billing_notes: bool = False,
    pricing_updated: bool = False,
) -> dict[str, Any]:
    location_query = _billing_board_location_query(
        q=q.strip().casefold(),
        route=route.strip(),
        do_not_bill_any_month=do_not_bill_any_month,
        unset_any_month=unset_any_month,
        not_billed_quarter=not_billed_quarter,
        non_empty_billing_notes=non_empty_billing_notes,
        pricing_updated=pricing_updated,
        year=year,
        quarter=quarter,
        month_dates=month_dates,
    ).options(joinedload(MonthlyLocation.monthly_route))

    total_locations = location_query.count()
    total_pages = max((total_locations + page_size - 1) // page_size, 1)
    if page > total_pages:
        page = total_pages
    locations = location_query.offset((page - 1) * page_size).limit(page_size).all()
    location_ids = [int(loc.id) for loc in locations]

    mlm_by_loc_month = _load_mlm_by_location_month(location_ids, month_dates)

    route_month_pairs: set[tuple[int, date]] = set()
    for loc in locations:
        lid = int(loc.id)
        for month_first in month_dates:
            mlm = mlm_by_loc_month.get((lid, month_first))
            route_id = _resolve_route_id_for_run(loc, mlm)
            if route_id is not None:
                route_month_pairs.add((route_id, month_first))
    runs_by_route_month = _load_runs_by_route_month(route_month_pairs)

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
            mlm_by_loc_month,
            runs_by_route_month,
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
    loc = MonthlyLocation.query.filter_by(id=location_id).one_or_none()
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
        from app.monthly.worksheet_locations import _next_sqlite_bigint_id

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
