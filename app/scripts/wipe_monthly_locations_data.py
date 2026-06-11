"""Remove all monthly library locations, runs, history, worksheet rows, and v2 site rows; keep ``monthly_route`` shells.

Includes **route-level** data tied to worksheets and history:

- Per-stop/month cells and technician edits: ``monthly_route_test_history``,
  ``monthly_route_worksheet_audit_event``, ``monthly_route_location_inspection_revision``
- Run files: ``monthly_route_run``
- Dashboard caches: ``monthly_route_specialist_month``, ``monthly_route_snapshot``
- Staff route notes: ``monthly_route_comment``

Run **after** ``backfill_monthly_key_bridge`` if you need key archives.

    python -m app.scripts.wipe_monthly_locations_data --dry-run
    python -m app.scripts.wipe_monthly_locations_data --execute

"""

from __future__ import annotations

import argparse

from sqlalchemy import func, text

from app import create_app, db
from app.db_models import (
    MonthlyKeyBridge,
    MonthlyLocation,
    MonthlyLocationComment,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteComment,
    MonthlyRouteRun,
    MonthlyRouteSnapshot,
    MonthlyRouteSpecialistMonth,
    MonthlyRouteWorksheetAuditEvent,
)


def _sqlite_table_exists(name: str) -> bool:
    """Avoid SQLAlchemy ``Inspector.has_table`` on SQLite — it can reflect metadata and
    cascade ORM bookkeeping that re-inserts rows deleted via plain SQL in this wipe."""
    row = db.session.execute(
        text(
            "SELECT 1 FROM sqlite_master WHERE type='table' "
            "AND name=:name COLLATE NOCASE LIMIT 1"
        ),
        {"name": name},
    ).scalar()
    return row is not None


def _counts() -> dict[str, int]:
    return {
        "monthly_route": db.session.query(func.count(MonthlyRoute.id)).scalar() or 0,
        "monthly_location": db.session.query(func.count(MonthlyLocation.id)).scalar() or 0,
        "monthly_key_bridge": db.session.query(func.count(MonthlyKeyBridge.id)).scalar() or 0,
    }


def _wipe_sqlite_style() -> None:
    """FK-safe DELETE order for SQLite tests (no TRUNCATE CASCADE).

    Uses plain ``DELETE FROM`` text so ORM cascade/sync never re-inserts rows after Core
    deletes (e.g. ``MonthlyRouteLocation.monthly_history`` delete-orphan cascade).

    SQLite validates FK targets even when using plain DELETE; minimal test schemas may omit
    referenced tables (e.g. ``monitoring_company_proposal``). Turn enforcement off for this
    ordered wipe only—we delete children before parents explicitly.
    """
    db.session.execute(text("PRAGMA foreign_keys=OFF"))
    # Drop ORM identity-map rows so a later flush/commit cannot re-INSERT children removed
    # via raw DELETE (e.g. MonthlyRouteLocation.monthly_history cascade bookkeeping).
    db.session.expunge_all()

    delete_order = [
        "monthly_stop_clock_event",
        "monthly_location_deficiency",
        MonthlyLocationMonth.__tablename__,
        MonthlyRouteWorksheetAuditEvent.__tablename__,
        "monthly_location_ticket_event",
        "monthly_location_ticket",
        "monthly_location_quarter_billed",
        MonthlyLocationComment.__tablename__,
        MonthlyRouteRun.__tablename__,
        MonthlyLocation.__tablename__,
        "monthly_route_calculated_path",
        MonthlyRouteSpecialistMonth.__tablename__,
        MonthlyRouteSnapshot.__tablename__,
        MonthlyRouteComment.__tablename__,
    ]

    try:
        for tbl in delete_order:
            if _sqlite_table_exists(tbl):
                db.session.execute(text(f'DELETE FROM "{tbl}"'))
                db.session.flush()
    finally:
        db.session.execute(text("PRAGMA foreign_keys=ON"))


def _wipe_postgres_truncate() -> None:
    """Single transaction TRUNCATE (preserves monthly_route)."""
    dialect = db.engine.dialect.name
    if dialect != "postgresql":
        _wipe_sqlite_style()
        return

    trunc_order = [
        "monthly_stop_clock_event",
        "monthly_location_deficiency",
        "monthly_location_month",
        "monthly_route_worksheet_audit_event",
        "monthly_location_ticket_event",
        "monthly_location_ticket",
        "monthly_location_quarter_billed",
        "monthly_location_comment",
        "monthly_route_run",
        "monthly_location",
        "monthly_route_calculated_path",
        "monthly_route_specialist_month",
        "monthly_route_snapshot",
        "monthly_route_comment",
    ]
    # RESTART IDENTITY clears sequences; CASCADE only needed if FK surprises — keep explicit list.
    for tbl in trunc_order:
        db.session.execute(text(f'TRUNCATE TABLE "{tbl}" RESTART IDENTITY CASCADE'))
    db.session.flush()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Wipe monthly locations, worksheet/history rows, route dashboard caches, "
            "route notes, and v2 site tables; keep monthly_route shells."
        ),
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Perform deletes/truncates (default dry-run).",
    )
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        before = _counts()
        print("[wipe_monthly] Before:", before)

        if not args.execute:
            print(
                "[wipe_monthly] Dry run — would remove locations, worksheet/history/run "
                "rows, dashboard caches, route comments, and v2 site rows; "
                "monthly_route count unchanged."
            )
            return 0

        _wipe_postgres_truncate()

        db.session.commit()

        after = _counts()
        print("[wipe_monthly] After:", after)
        print("[wipe_monthly] Done. Keys + monthly_key_bridge untouched.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
