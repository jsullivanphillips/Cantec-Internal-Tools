from __future__ import annotations

import argparse

from sqlalchemy import func, select, update
from sqlalchemy.orm import aliased

from app import create_app, db
from app.db_models import MonthlyRouteLocation


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Clear MonthlyRouteLocation.building for rows that do not share the same "
            "address + property management company with another row."
        )
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Persist changes. If omitted, script runs in dry-run mode.",
    )
    return parser.parse_args()


def _pair_count_subquery():
    """Correlated count of rows sharing (address_normalized, property_management_company_normalized)."""
    M = MonthlyRouteLocation
    other = aliased(M)
    return (
        select(func.count())
        .select_from(other)
        .where(
            other.address_normalized == M.address_normalized,
            other.property_management_company_normalized == M.property_management_company_normalized,
        )
        .scalar_subquery()
    )


def run_cleanup(dry_run: bool = True) -> None:
    M = MonthlyRouteLocation
    pair_cnt = _pair_count_subquery()

    has_building = M.building.is_not(None) & (func.trim(M.building) != "")

    rows_with_building = db.session.scalar(
        select(func.count()).select_from(M).where(has_building)
    )

    to_clear_count = db.session.scalar(
        select(func.count()).select_from(M).where(has_building, pair_cnt <= 1)
    )

    rows_kept_due_to_conflicts = db.session.scalar(
        select(func.count()).select_from(M).where(has_building, pair_cnt > 1)
    )

    conflict_pairs_sq = (
        select(M.address_normalized, M.property_management_company_normalized)
        .where(has_building, pair_cnt > 1)
        .distinct()
        .subquery()
    )
    conflict_pairs = db.session.scalar(select(func.count()).select_from(conflict_pairs_sq))

    print(
        "[monthly-building-cleanup] Summary — "
        f"rows_with_building: {rows_with_building}, "
        f"rows_cleared: {to_clear_count}, "
        f"rows_kept_due_to_conflicts: {rows_kept_due_to_conflicts}, "
        f"conflict_pairs: {conflict_pairs}",
        flush=True,
    )

    if dry_run:
        db.session.rollback()
        print("[monthly-building-cleanup] Dry run complete. No database changes committed.", flush=True)
        return

    print("[monthly-building-cleanup] Applying UPDATE …", flush=True)
    stmt = (
        update(M)
        .where(has_building, pair_cnt <= 1)
        .values(building=None, building_normalized="")
    )
    result = db.session.execute(stmt)
    updated = result.rowcount

    print("[monthly-building-cleanup] Committing …", flush=True)
    db.session.commit()
    print(
        f"[monthly-building-cleanup] Changes committed (rowcount reported: {updated}).",
        flush=True,
    )


def main() -> None:
    args = parse_args()
    app = create_app()
    with app.app_context():
        run_cleanup(dry_run=not args.commit)


if __name__ == "__main__":
    main()
