"""DEPRECATED — pre-flat-model script. Legacy tables removed after Alembic z11 cutover.

Backfill ``MonthlyTestingSiteMonth`` rows from legacy ``MonthlyRouteTestHistory``.

    python -m app.scripts.backfill_worksheet_stop_months
    python -m app.scripts.backfill_worksheet_stop_months --execute
"""

from __future__ import annotations

import argparse

from sqlalchemy.exc import IntegrityError

from app import create_app, db
from app.db_models import (
    MonthlyRouteLocation,
    MonthlyRouteTestHistory,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
)
from app.monthly.monthly_sites_sync import ensure_monthly_site_for_location, sync_testing_sites_from_legacy
from app.monthly.worksheet_stops import (
    _next_sqlite_bigint_id,
    _prior_mtsm_by_testing_site,
    primary_testing_site,
    seed_stop_month_fields,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backfill MonthlyTestingSiteMonth from attributed MonthlyRouteTestHistory."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Apply changes (default is dry-run counts only).",
    )
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        hist_rows = (
            MonthlyRouteTestHistory.query.filter(
                MonthlyRouteTestHistory.test_monthly_route_id.isnot(None),
            )
            .order_by(
                MonthlyRouteTestHistory.month_date.asc(),
                MonthlyRouteTestHistory.location_id.asc(),
            )
            .all()
        )
        need = 0
        for hist in hist_rows:
            loc = db.session.get(MonthlyRouteLocation, int(hist.location_id))
            if loc is None:
                continue
            site = ensure_monthly_site_for_location(loc)
            ts_rows = list(site.testing_sites) if site.testing_sites else sync_testing_sites_from_legacy(loc)
            for ts in ts_rows:
                existing = MonthlyTestingSiteMonth.query.filter_by(
                    monthly_testing_site_id=int(ts.id),
                    month_date=hist.month_date,
                ).one_or_none()
                if existing is None:
                    need += 1

        print(f"History rows with route attribution: {len(hist_rows)}")
        print(f"Missing stop-month rows: {need}")
        if not args.execute:
            print("Dry run — pass --execute to write.")
            return 0

        upserted = 0
        for hist in hist_rows:
            route_id = int(hist.test_monthly_route_id)
            month_first = hist.month_date
            loc = db.session.get(MonthlyRouteLocation, int(hist.location_id))
            if loc is None:
                continue
            site = ensure_monthly_site_for_location(loc)
            ts_rows = list(site.testing_sites) if site.testing_sites else sync_testing_sites_from_legacy(loc)
            if not ts_rows:
                continue
            primary = primary_testing_site(ts_rows)
            ts_ids = [int(t.id) for t in ts_rows]
            prior_by_ts = _prior_mtsm_by_testing_site(ts_ids, month_first)
            for ts in ts_rows:
                ts_id = int(ts.id)
                is_primary = primary is not None and int(primary.id) == ts_id
                prior = prior_by_ts.get(ts_id)
                fields = seed_stop_month_fields(
                    ts,
                    loc,
                    prior,
                    route_id=route_id,
                    run_id=hist.run_id,
                    month_first=month_first,
                    primary=is_primary,
                    location_hist=hist if is_primary else None,
                )
                row = MonthlyTestingSiteMonth.query.filter_by(
                    monthly_testing_site_id=ts_id,
                    month_date=month_first,
                ).one_or_none()
                if row is None:
                    fields["monthly_testing_site_id"] = ts_id
                    kw = dict(fields)
                    nid = _next_sqlite_bigint_id(MonthlyTestingSiteMonth)
                    if nid is not None:
                        kw["id"] = nid
                    try:
                        with db.session.begin_nested():
                            db.session.add(MonthlyTestingSiteMonth(**kw))
                            upserted += 1
                    except IntegrityError:
                        row = MonthlyTestingSiteMonth.query.filter_by(
                            monthly_testing_site_id=ts_id,
                            month_date=month_first,
                        ).one_or_none()
                if row is not None:
                    for key, val in fields.items():
                        if key in ("month_date", "monthly_testing_site_id"):
                            continue
                        setattr(row, key, val)
                    upserted += 1
        db.session.commit()
        print(f"Upserted/refreshed {upserted} stop-month rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
