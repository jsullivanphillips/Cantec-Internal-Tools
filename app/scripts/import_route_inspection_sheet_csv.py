"""
Import a technician route inspection CSV (preamble + ``#,Address|Location Details,...`` data rows).

This script is a thin CLI wrapper over :mod:`app.monthly.route_inspection_csv_import`.
The shared module is also called from the route-detail "Upload run from CSV" button
in the web UI; logic and validation live there.

Run (from repo root, with app env configured)::

    python -m app.scripts.import_route_inspection_sheet_csv --csv path/to/sheet.csv --dry-run
    python -m app.scripts.import_route_inspection_sheet_csv --csv path/to/sheet.csv --commit
    python -m app.scripts.import_route_inspection_sheet_csv --csv path/to/sheet.csv --commit --sync-stop-order

``--sync-stop-order`` updates ``route_stop_order`` from the ``#`` column only for sites **already**
assigned to the sheet's route (won't move stops that switched routes).
"""

from __future__ import annotations

import argparse
import logging
from datetime import date
from pathlib import Path

from app import create_app, db
from app.db_models import MonthlyRoute
from app.monthly.route_inspection_csv_import import (
    parse_preamble_only,
    run_route_inspection_csv_import,
)
from app.monthly.runs import get_or_create_monthly_route_run

LOG = logging.getLogger("import_route_inspection_sheet_csv")


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )


def _run_cli(
    csv_path: Path,
    *,
    dry_run: bool,
    route_number_override: int | None,
    month_date_override: date | None,
    sync_route_meta: bool,
    sync_stop_order: bool,
    update_route_display_name: bool,
    restrict_to_route_id: int | None,
) -> int:
    csv_bytes = csv_path.read_bytes()
    preamble = parse_preamble_only(csv_bytes)
    route_number = (
        route_number_override
        if route_number_override is not None
        else preamble.route_number
    )
    month_date = month_date_override or preamble.month_date

    if route_number is None:
        raise SystemExit("Could not determine route number (add ROUTE row or pass --route-number).")
    if month_date is None:
        raise SystemExit("Could not determine month (add DATE row or pass --month-date YYYY-MM-DD).")

    route = MonthlyRoute.query.filter_by(route_number=route_number).one_or_none()
    if route is None:
        raise SystemExit(f"No MonthlyRoute with route_number={route_number}.")
    if restrict_to_route_id is not None and int(restrict_to_route_id) != int(route.id):
        raise SystemExit("--restrict-route-id does not match resolved route from route_number.")

    run = get_or_create_monthly_route_run(
        int(route.id),
        month_date,
        source="csv_import",
    )

    result = run_route_inspection_csv_import(
        csv_bytes=csv_bytes,
        run=run,
        route=route,
        month_date=month_date,
        dry_run=dry_run,
        sync_route_meta=sync_route_meta,
        sync_stop_order=sync_stop_order,
        update_route_display_name=update_route_display_name,
    )

    if not dry_run:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        from app.monthly.field_submission import capture_field_submission_for_run
        from app.monthly.run_workflow import (
            close_historical_run_from_csv_import,
            is_historical_run_month,
        )

        if is_historical_run_month(month_date):
            now = datetime.now(ZoneInfo("America/Vancouver"))
            close_historical_run_from_csv_import(
                run,
                username="csv_import",
                now=now,
            )
            capture_field_submission_for_run(run, captured_at=now)
            db.session.commit()
            print("[inspection-csv] Historical month — run marked completed.", flush=True)

    print(
        f"[inspection-csv] route_number={result.route_number} route_id={result.route_id} "
        f"month_date={month_date.isoformat()} run_id={result.run_id} "
        f"locations_updated={result.locations_updated} history_upserts={result.history_upserts} "
        f"rows_without_history_signal={result.skipped_no_history} issues={len(result.issues)}",
        flush=True,
    )
    if sync_route_meta or sync_stop_order:
        print(
            f"[inspection-csv] stop_order: applied_to_rows={result.stop_order_applied} "
            f"skipped_not_on_sheet_route_or_unassigned={result.stop_order_skipped_not_on_sheet_route}",
            flush=True,
        )
    for issue in result.issues[:50]:
        print(f"  [{issue.kind}] csv_row≈{issue.csv_row}: {issue.detail}", flush=True)
    if len(result.issues) > 50:
        print(f"  ... and {len(result.issues) - 50} more issues", flush=True)

    if dry_run:
        print("[inspection-csv] Rolled back (dry-run).", flush=True)
    else:
        print("[inspection-csv] Committed.", flush=True)

    fatal_kinds = frozenset({"missing_address", "unmatched", "ambiguous", "duplicate"})
    fatal = [i for i in result.issues if i.kind in fatal_kinds]
    if fatal:
        print(f"[inspection-csv] Non-zero exit: {len(fatal)} fatal row issue(s).", flush=True)
        return 1
    if result.issues:
        print(
            f"[inspection-csv] Completed with {len(result.issues)} warning(s) (route_mismatch / ...).",
            flush=True,
        )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="Path to inspection CSV")
    parser.add_argument("--dry-run", action="store_true", help="Parse and validate; roll back DB changes")
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Commit changes (omit for dry-run unless --dry-run set)",
    )
    parser.add_argument(
        "--route-number", type=int, default=None, help="Override route number from preamble"
    )
    parser.add_argument(
        "--month-date",
        type=str,
        default=None,
        help="Override sheet month as YYYY-MM-DD (first of month)",
    )
    parser.add_argument(
        "--sync-route-meta",
        action="store_true",
        help="Assign monthly_route_id to this sheet route for every matched row and set route_stop_order from #",
    )
    parser.add_argument(
        "--sync-stop-order",
        action="store_true",
        help=(
            "Set route_stop_order from # only when the location is already on this sheet route "
            "(does not change monthly_route_id — use when some sheet rows moved to other routes)"
        ),
    )
    parser.add_argument(
        "--update-route-display-name",
        action="store_true",
        help="Set MonthlyRoute.display_name from the sheet label column (e.g. Pac Pro 1)",
    )
    parser.add_argument(
        "--restrict-route-id",
        type=int,
        default=None,
        help="Safety check: abort unless resolved route matches this id",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    md_override = None
    if args.month_date:
        md_override = date.fromisoformat(args.month_date)

    dry_run = args.dry_run or not args.commit

    _configure_logging(args.verbose)
    app = create_app()
    with app.app_context():
        code = _run_cli(
            args.csv,
            dry_run=dry_run,
            route_number_override=args.route_number,
            month_date_override=md_override,
            sync_route_meta=args.sync_route_meta,
            sync_stop_order=args.sync_stop_order,
            update_route_display_name=args.update_route_display_name,
            restrict_to_route_id=args.restrict_route_id,
        )
    raise SystemExit(code)


if __name__ == "__main__":
    main()


# ``db`` re-exported for callers that previously imported it from this module (legacy).
__all__ = ["main", "db"]
