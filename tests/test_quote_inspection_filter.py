"""Tests for excluding inspection scheduling jobs from service metrics."""

from datetime import datetime, timezone

from app.routes.performance_summary import INSPECTION_SCHEDULING_JOB_TYPES


def test_inspection_scheduling_job_types():
    assert INSPECTION_SCHEDULING_JOB_TYPES == ("inspection",)


def test_deficiency_insights_accepts_exclude_flag(monkeypatch):
    from app.routes import performance_summary as ps

    calls: list[bool] = []

    def fake_query(*args, **kwargs):
        return type(
            "Q",
            (),
            {
                "filter": lambda self, *a, **k: self,
                "join": lambda self, *a, **k: self,
                "outerjoin": lambda self, *a, **k: self,
                "distinct": lambda self: self,
                "count": lambda self: calls.append(True) or 0,
            },
        )()

    monkeypatch.setattr(ps.db.session, "query", fake_query)

    window_start = datetime(2026, 6, 1, tzinfo=timezone.utc)
    window_end = datetime(2026, 6, 30, tzinfo=timezone.utc)

    ps.get_deficiency_insights(window_start, window_end, exclude_inspection_jobs=True)
    assert len(calls) == 4  # total + 3 quoted variants
