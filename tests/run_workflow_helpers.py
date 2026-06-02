"""Shared helpers for monthly run workflow API tests."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.db_models import MonthlyRouteRun, db

PACIFIC_TZ = ZoneInfo("America/Vancouver")


def office_prepare_run(
    client,
    route_id: int = 1,
    month_first: str = "2026-05-01",
) -> None:
    with client.session_transaction() as sess:
        sess["username"] = "office_tester"
    res = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/prepare",
        json={"month_date": month_first},
    )
    assert res.status_code == 200, res.get_json()


def portal_start_run(client, route_id: int = 1, month_first: str = "2026-05-01") -> dict:
    office_prepare_run(client, route_id, month_first)
    res = client.post(f"/api/technician_portal/routes/{route_id}/runs")
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def seed_prepared_started_run(
    route_id: int,
    month_first: date,
    *,
    run_id: int = 5001,
    prepared: bool = True,
    started: bool = True,
    field_ended: bool = False,
    review_complete: bool = False,
    completed: bool = False,
) -> MonthlyRouteRun:
    now = datetime.now(PACIFIC_TZ)
    run = MonthlyRouteRun(
        id=run_id,
        monthly_route_id=route_id,
        month_date=month_first,
        opened_at=now,
        prepared_at=now if prepared else None,
        prepared_by="office_tester" if prepared else None,
        started_at=now if started else None,
        field_ended_at=now if field_ended else None,
        office_review_completed_at=now if review_complete else None,
        office_review_completed_by="office_tester" if review_complete else None,
        completed_at=now if completed else None,
        status="completed" if completed else "open",
        source="technician_app",
    )
    db.session.add(run)
    db.session.commit()
    return run
