from app.db_models import MonthlyLocation
from app.scripts.upload_monthly_sheet import (
    _apply_status_and_routes_update,
    _normalize_status,
    _status_and_test_day_from_row,
)


class _Loc:
    def __init__(
        self,
        *,
        status_normalized: str = "active",
        status_raw: str | None = "ACTIVE",
        test_day: str | None = "W1-R7",
        monthly_route_id: int | None = 12,
    ):
        self.status_normalized = status_normalized
        self.status_raw = status_raw
        self.test_day = test_day
        self.monthly_route_id = monthly_route_id


def test_status_and_test_day_from_row():
    row = {
        "STATUS- (ACTIVE, CANCELLED, ON HOLD)": "ON HOLD",
        "TEST DAY": "TH2-R15",
    }
    assert _status_and_test_day_from_row(row) == ("on_hold", "ON HOLD", "TH2-R15")


def test_apply_status_and_routes_update_status_only(monkeypatch):
    loc = _Loc()
    sync_called = False

    def _sync(_loc: MonthlyLocation) -> None:
        nonlocal sync_called
        sync_called = True

    monkeypatch.setattr(
        "app.scripts.upload_monthly_sheet.sync_monthly_route_fk_for_location",
        _sync,
    )
    changed, route_error = _apply_status_and_routes_update(
        loc,
        {
            "STATUS- (ACTIVE, CANCELLED, ON HOLD)": "CANCELLED",
            "TEST DAY": "W1-R7",
        },
    )
    assert changed is True
    assert route_error is None
    assert loc.status_normalized == "cancelled"
    assert loc.status_raw == "CANCELLED"
    assert sync_called is False


def test_apply_status_and_routes_update_test_day_triggers_route_sync(monkeypatch):
    loc = _Loc()
    synced_route_id = 99

    def _sync(target: MonthlyLocation) -> None:
        target.monthly_route_id = synced_route_id

    monkeypatch.setattr(
        "app.scripts.upload_monthly_sheet.sync_monthly_route_fk_for_location",
        _sync,
    )
    changed, route_error = _apply_status_and_routes_update(
        loc,
        {
            "STATUS- (ACTIVE, CANCELLED, ON HOLD)": "ACTIVE",
            "TEST DAY": "TH2-R15",
        },
    )
    assert changed is True
    assert route_error is None
    assert loc.test_day == "TH2-R15"
    assert loc.monthly_route_id == synced_route_id


def test_normalize_status_on_hold():
    assert _normalize_status("ON HOLD") == "on_hold"
