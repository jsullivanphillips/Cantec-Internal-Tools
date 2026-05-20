"""Regression tests for weekly scheduling volume API."""

from __future__ import annotations

from datetime import datetime, timezone
import datetime as dt_stdlib

import pytest

from app import create_app
from app.db_models import WeeklySchedulingStats, db
from app.routes import scheduling_attack as sa_mod


class _DatetimeStub:
    """Delegate to stdlib datetime except for now()."""

    def __init__(self, fixed_now: datetime):
        self._fixed_now = fixed_now

    def __getattr__(self, name: str):
        return getattr(dt_stdlib.datetime, name)

    def now(self, tz=None):
        return self._fixed_now


@pytest.fixture
def weekly_volume_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(sa_mod, "_live_weekly_scheduling_diff", lambda **kwargs: (0, 0))
    fixed_now = datetime(2026, 5, 20, 15, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(sa_mod, "datetime", _DatetimeStub(fixed_now))

    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=[WeeklySchedulingStats.__table__])
        # Prior week stored as UTC Monday 07:00 (Vancouver Monday 00:00 PDT).
        db.session.add(
            WeeklySchedulingStats(
                id=1,
                period_start=datetime(2026, 5, 11, 7, 0, 0, tzinfo=timezone.utc),
                period_end=datetime(2026, 5, 18, 7, 0, 0, tzinfo=timezone.utc),
                job_type="inspection,reinspection",
                scheduled_count=37,
                rescheduled_count=18,
                generated_at=fixed_now,
            )
        )
        db.session.commit()
        with app.test_client() as client:
            yield client
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=[WeeklySchedulingStats.__table__])


def test_weekly_volume_loads_prior_week_from_db(weekly_volume_client):
    r = weekly_volume_client.get("/scheduling_attack/v2/weekly_scheduling_volume")
    assert r.status_code == 200
    weeks = r.get_json()["weeks"]
    assert len(weeks) == 6
    prior_week = weeks[-2]
    assert prior_week["scheduled"] == 37
    assert prior_week["rescheduled"] == 18
