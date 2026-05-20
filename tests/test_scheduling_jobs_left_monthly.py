"""Tests for scheduling attack jobs-left monthly KPI API."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app import create_app
from app.db_models import SchedulingJobsLeftMonth, db
from app.routes import scheduling_attack as sa_mod


@pytest.fixture
def jobs_left_client(monkeypatch):
    """In-memory DB with Vancouver anchor date fixed to 2026-05-15."""
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(sa_mod, "_today_local_date", lambda: date(2026, 5, 15))
    monkeypatch.setattr(sa_mod, "_compute_jobs_left_from_servicetrade", lambda _months: {})  # noqa: E731
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=[SchedulingJobsLeftMonth.__table__])
        with app.test_client() as client:
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=[SchedulingJobsLeftMonth.__table__])


def test_get_returns_thirteen_months_ordered(jobs_left_client):
    client, _app = jobs_left_client
    r = client.get("/scheduling_attack/v2/jobs_left_monthly")
    assert r.status_code == 200
    data = r.get_json()
    assert data["timezone"] == "America/Vancouver"
    assert data["anchor_year_month"] == "2026-05"
    assert data["months_back"] == 6
    assert data["months_forward"] == 6
    months = data["months"]
    assert len(months) == 13
    assert [m["year_month"] for m in months] == [
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
        "2026-09",
        "2026-10",
        "2026-11",
    ]
    assert all(m["jobs_left"] is None for m in months)


def test_get_uses_servicetrade_when_no_manual_row(jobs_left_client, monkeypatch):
    monkeypatch.setattr(
        sa_mod,
        "_compute_jobs_left_from_servicetrade",
        lambda _months: {
            "2026-05": {"jobs_left": 25, "jobs_total": 140},
            "2026-06": {"jobs_left": 3, "jobs_total": 50},
        },
    )
    client, _app = jobs_left_client
    r = client.get("/scheduling_attack/v2/jobs_left_monthly")
    assert r.status_code == 200
    data = r.get_json()
    may = next(m for m in data["months"] if m["year_month"] == "2026-05")
    june = next(m for m in data["months"] if m["year_month"] == "2026-06")
    assert may["jobs_left"] == 25
    assert may["jobs_total"] == 140
    assert may["jobs_left_source"] == "servicetrade"
    assert june["jobs_left"] == 3
    assert june["jobs_total"] == 50


def test_manual_override_beats_servicetrade(jobs_left_client, monkeypatch):
    monkeypatch.setattr(
        sa_mod,
        "_compute_jobs_left_from_servicetrade",
        lambda _months: {"2026-05": {"jobs_left": 99, "jobs_total": 140}},
    )
    _client, app = jobs_left_client
    with app.app_context():
        db.session.add(
            SchedulingJobsLeftMonth(
                year_month=date(2026, 5, 1),
                jobs_left=11,
                updated_at=datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc),
                updated_by="office.staff",
            )
        )
        db.session.commit()
    r = _client.get("/scheduling_attack/v2/jobs_left_monthly")
    may = next(m for m in r.get_json()["months"] if m["year_month"] == "2026-05")
    assert may["jobs_left"] == 11
    assert may["jobs_total"] == 140
    assert may["jobs_left_source"] == "manual"
    assert may["jobs_total_source"] == "servicetrade"


def test_get_includes_saved_month_values(jobs_left_client):
    _client, app = jobs_left_client
    with app.app_context():
        db.session.add(
            SchedulingJobsLeftMonth(
                year_month=date(2026, 3, 1),
                jobs_left=42,
                updated_at=datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc),
                updated_by="office.staff",
            )
        )
        db.session.commit()

    r = _client.get("/scheduling_attack/v2/jobs_left_monthly")
    assert r.status_code == 200
    march = next(m for m in r.get_json()["months"] if m["year_month"] == "2026-03")
    assert march["jobs_left"] == 42
    assert march["jobs_total"] is None
    assert march["updated_by"] == "office.staff"


def test_put_requires_session(jobs_left_client):
    client, _app = jobs_left_client
    r = client.put(
        "/scheduling_attack/v2/jobs_left_monthly",
        json={"year_month": "2026-05", "jobs_left": 10},
    )
    assert r.status_code == 401


def test_put_accepts_window_edges(jobs_left_client):
    client, _app = jobs_left_client
    with client.session_transaction() as sess:
        sess["username"] = "office.staff"

    for ym in ("2025-11", "2026-11"):
        r = client.put(
            "/scheduling_attack/v2/jobs_left_monthly",
            json={"year_month": ym, "jobs_left": 7},
        )
        assert r.status_code == 200, r.get_json()
        assert r.get_json()["jobs_left"] == 7


def test_bucket_jobs_left_metrics_by_local_month():
    may_start = date(2026, 5, 1)
    month_starts = [may_start]
    may_ts = int(datetime(2026, 5, 15, 12, 0, 0, tzinfo=timezone.utc).timestamp())
    june_ts = int(datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc).timestamp())
    jobs = [
        {"id": 1, "status": "new", "dueBy": may_ts},
        {"id": 2, "status": "scheduled", "dueBy": may_ts},
        {"id": 3, "status": "new", "dueBy": may_ts},
        {"id": 4, "status": "scheduled", "dueBy": june_ts},
        {"id": 5},
    ]
    metrics = sa_mod._bucket_jobs_left_metrics_by_local_month(jobs, month_starts)
    assert metrics == {"2026-05": {"jobs_left": 2, "jobs_total": 3}}


def test_put_rejects_outside_window(jobs_left_client):
    client, _app = jobs_left_client
    with client.session_transaction() as sess:
        sess["username"] = "office.staff"

    for ym in ("2025-10", "2026-12"):
        r = client.put(
            "/scheduling_attack/v2/jobs_left_monthly",
            json={"year_month": ym, "jobs_left": 3},
        )
        assert r.status_code == 400
        assert "year_month" in (r.get_json() or {}).get("error", "")
