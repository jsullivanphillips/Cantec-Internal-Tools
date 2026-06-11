"""
Keep ``MonthlyLocation.monthly_route_id`` aligned with ``test_day``.

Does not touch ``keys`` / ``key_status``.
"""

from __future__ import annotations

from sqlalchemy import func

from app.db_models import MonthlyLocation, MonthlyRoute, db
from app.monthly.test_day import monthly_test_day_is_cancelled, parse_test_day


def sync_monthly_route_fk_for_location(loc: MonthlyLocation) -> None:
    """
    Set ``loc.monthly_route_id`` from ``loc.test_day``.

    Blank, cancelled (``-``), unparseable, or empty-after-parse values clear the FK.

    Raises:
        ValueError: Existing ``MonthlyRoute`` for the same route number disagrees
            with weekday / occurrence implied by ``test_day``.
    """
    td = (loc.test_day or "").strip()
    if not td or monthly_test_day_is_cancelled(td):
        loc.monthly_route_id = None
        return
    try:
        parsed = parse_test_day(td)
    except ValueError:
        loc.monthly_route_id = None
        return
    if parsed is None:
        loc.monthly_route_id = None
        return

    existing = MonthlyRoute.query.filter_by(route_number=parsed.route_number).one_or_none()
    if existing is not None:
        if (
            existing.weekday_iso != parsed.weekday_iso
            or existing.week_occurrence != parsed.week_occurrence
        ):
            raise ValueError(
                f"TEST DAY conflicts with route R{parsed.route_number}, which is "
                f"weekday {existing.weekday_iso} occurrence {existing.week_occurrence} "
                f"in the database"
            )
        loc.monthly_route_id = existing.id
        return

    row = MonthlyRoute(
        route_number=parsed.route_number,
        weekday_iso=parsed.weekday_iso,
        week_occurrence=parsed.week_occurrence,
    )
    bind = db.session.get_bind()
    if bind is not None and bind.dialect.name == "sqlite":
        mx = db.session.query(func.coalesce(func.max(MonthlyRoute.id), 0)).scalar()
        row.id = int(mx or 0) + 1
    db.session.add(row)
    db.session.flush()
    loc.monthly_route_id = row.id
