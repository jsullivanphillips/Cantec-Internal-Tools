from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyLocation,
    MonthlyLocationComment,
    MonthlyLocationDeficiency,
    MonthlyLocationMonth,
    MonthlyLocationQuarterBilled,
    MonthlyLocationTicket,
    MonthlyLocationTicketEvent,
    MonthlyRoute,
    MonthlyRouteRun,
    MonthlyRouteWorksheetAuditEvent,
    MonthlyStopClockEvent,
    db,
)
from app.scripts.dedupe_monthly_locations_by_label_suffix import run_dedupe
from tests.monthly_location_helpers import make_location


@pytest.fixture
def dedupe_tables(monkeypatch, tmp_path):
    db_file = tmp_path / "dedupe_monthly_locations.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    tables = [
        Key.__table__,
        MonitoringCompany.__table__,
        MonthlyRoute.__table__,
        MonthlyRouteRun.__table__,
        MonthlyLocation.__table__,
        MonthlyLocationComment.__table__,
        MonthlyLocationMonth.__table__,
        MonthlyStopClockEvent.__table__,
        MonthlyRouteWorksheetAuditEvent.__table__,
        MonthlyLocationDeficiency.__table__,
        MonthlyLocationQuarterBilled.__table__,
        MonthlyLocationTicket.__table__,
        MonthlyLocationTicketEvent.__table__,
    ]
    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def _seed_route() -> None:
    db.session.add(MonthlyRoute(id=1, route_number=7, weekday_iso=2, week_occurrence=1))
    db.session.add(MonthlyRouteRun(id=1, monthly_route_id=1, month_date=date(2026, 5, 1)))
    db.session.commit()


def _make_pair(*, keep_id: int = 101, dup_id: int = 102, dup_label: str = "2471 Sidney Ave Oceana", **extra):
    keep = make_location(
        id=keep_id,
        address="2471 Sidney Ave",
        label="2471 Sidney Ave",
        property_management_company="PMC",
        property_management_company_normalized="pmc",
        monthly_route_id=1,
        route_stop_order=0,
        **extra,
    )
    dup = make_location(
        id=dup_id,
        address="2471 Sidney Ave",
        label=dup_label,
        label_normalized=dup_label.casefold(),
        property_management_company="PMC",
        property_management_company_normalized="pmc",
        monthly_route_id=1,
        route_stop_order=0,
        **extra,
    )
    db.session.add_all([keep, dup])
    db.session.commit()
    return keep, dup


def test_dry_run_reports_merge_candidate_and_keeps_rows(dedupe_tables, tmp_path):
    with dedupe_tables.app_context():
        _seed_route()
        _make_pair()
        rows = run_dedupe(execute=False, report_dir=tmp_path / "reports")
        assert len(rows) == 1
        assert rows[0]["status"] == "merge_candidate"
        assert MonthlyLocation.query.count() == 2


def test_non_label_difference_is_reported_and_skipped(dedupe_tables, tmp_path):
    with dedupe_tables.app_context():
        _seed_route()
        _make_pair(area="North Yard")
        dup = MonthlyLocation.query.filter_by(id=102).one()
        dup.area = "South Yard"
        db.session.commit()
        rows = run_dedupe(execute=False, report_dir=tmp_path / "reports")
        assert rows[0]["status"] == "skipped_non_label_difference"
        assert "area" in (rows[0]["detail"] or "")
        assert MonthlyLocation.query.count() == 2


def test_commit_moves_simple_child_rows_and_deletes_duplicate(dedupe_tables, tmp_path):
    with dedupe_tables.app_context():
        _seed_route()
        keep, dup = _make_pair()
        db.session.add(MonthlyLocationComment(id=1, location_id=int(dup.id), body="note", author_username="jamie"))
        db.session.add(
            MonthlyLocationDeficiency(
                id=1,
                monthly_location_id=int(dup.id),
                title="Battery",
                severity="low",
                status="new",
            )
        )
        db.session.add(
            MonthlyLocationTicket(
                id=1,
                monthly_location_id=int(dup.id),
                run_id=1,
                month_date=date(2026, 5, 1),
                title="Email customer",
                status="open",
            )
        )
        db.session.add(
            MonthlyLocationQuarterBilled(
                id=1,
                location_id=int(dup.id),
                year=2026,
                quarter=2,
                billed_at=datetime(2026, 5, 10, tzinfo=timezone.utc),
                billed_by_username="office",
            )
        )
        db.session.add(
            MonthlyLocationMonth(
                id=1,
                monthly_location_id=int(dup.id),
                month_date=date(2026, 5, 1),
                run_id=1,
                test_monthly_route_id=1,
                result_status="tested",
            )
        )
        db.session.commit()

        rows = run_dedupe(execute=True, report_dir=tmp_path / "reports")
        assert rows[0]["status"] == "merged"
        assert MonthlyLocation.query.count() == 1
        assert MonthlyLocationComment.query.one().location_id == int(keep.id)
        assert MonthlyLocationDeficiency.query.one().monthly_location_id == int(keep.id)
        assert MonthlyLocationTicket.query.one().monthly_location_id == int(keep.id)
        assert MonthlyLocationQuarterBilled.query.one().location_id == int(keep.id)
        assert MonthlyLocationMonth.query.one().monthly_location_id == int(keep.id)


def test_identical_same_month_rows_collapse_and_remap_clock_and_audit(dedupe_tables, tmp_path):
    with dedupe_tables.app_context():
        _seed_route()
        keep, dup = _make_pair()
        keep_row = MonthlyLocationMonth(
            id=11,
            monthly_location_id=int(keep.id),
            month_date=date(2026, 5, 1),
            run_id=1,
            test_monthly_route_id=1,
            result_status="tested",
            sheet_time_in_raw="9:00 AM",
        )
        dup_row = MonthlyLocationMonth(
            id=12,
            monthly_location_id=int(dup.id),
            month_date=date(2026, 5, 1),
            run_id=1,
            test_monthly_route_id=1,
            result_status="tested",
            sheet_time_in_raw="9:00 AM",
        )
        db.session.add_all(
            [
                keep_row,
                dup_row,
                MonthlyStopClockEvent(
                    id=1,
                    monthly_location_month_id=12,
                    sort_order=0,
                    time_in_raw="9:00 AM",
                ),
                MonthlyRouteWorksheetAuditEvent(
                    id=1,
                    monthly_route_id=1,
                    location_id=int(dup.id),
                    location_month_row_id=12,
                    month_date=date(2026, 5, 1),
                    field_name="result_status",
                    old_value=None,
                    new_value="tested",
                ),
            ]
        )
        db.session.commit()

        rows = run_dedupe(execute=True, report_dir=tmp_path / "reports")
        assert rows[0]["status"] == "merged"
        assert MonthlyLocationMonth.query.count() == 1
        assert MonthlyStopClockEvent.query.one().monthly_location_month_id == 11
        audit = MonthlyRouteWorksheetAuditEvent.query.one()
        assert audit.location_id == int(keep.id)
        assert audit.location_month_row_id == 11


def test_conflicting_same_month_rows_skip_delete(dedupe_tables, tmp_path):
    with dedupe_tables.app_context():
        _seed_route()
        keep, dup = _make_pair()
        db.session.add_all(
            [
                MonthlyLocationMonth(
                    id=11,
                    monthly_location_id=int(keep.id),
                    month_date=date(2026, 5, 1),
                    run_id=1,
                    test_monthly_route_id=1,
                    result_status="tested",
                ),
                MonthlyLocationMonth(
                    id=12,
                    monthly_location_id=int(dup.id),
                    month_date=date(2026, 5, 1),
                    run_id=1,
                    test_monthly_route_id=1,
                    result_status="skipped",
                ),
            ]
        )
        db.session.commit()

        rows = run_dedupe(execute=True, report_dir=tmp_path / "reports")
        assert rows[0]["status"] == "skipped_month_collision"
        assert MonthlyLocation.query.count() == 2


def test_equivalent_quarter_billed_rows_deduplicate(dedupe_tables, tmp_path):
    with dedupe_tables.app_context():
        _seed_route()
        keep, dup = _make_pair()
        billed_at = datetime(2026, 5, 10, tzinfo=timezone.utc)
        db.session.add_all(
            [
                MonthlyLocationQuarterBilled(
                    id=1,
                    location_id=int(keep.id),
                    year=2026,
                    quarter=2,
                    billed_at=billed_at,
                    billed_by_username="office",
                ),
                MonthlyLocationQuarterBilled(
                    id=2,
                    location_id=int(dup.id),
                    year=2026,
                    quarter=2,
                    billed_at=billed_at,
                    billed_by_username="office",
                ),
            ]
        )
        db.session.commit()

        rows = run_dedupe(execute=True, report_dir=tmp_path / "reports")
        assert rows[0]["status"] == "merged"
        assert MonthlyLocation.query.count() == 1
        assert MonthlyLocationQuarterBilled.query.count() == 1
