from datetime import date, datetime, timezone

from app.utils.business_days import business_days_between


def test_get_scheduled_within_sla_metrics_shape(monkeypatch):
    """Smoke test payload shape without DB — uses mocked query loop."""
    from app.routes import monday_meeting as mm

    class FakeQuote:
        quote_id = 100
        customer_name = "Acme"
        location_address = "123 Main St"
        quote_created_on = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
        quote_accepted_on = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)
        job_created = True
        job_id = 555

    class FakeQuoteNoSchedule:
        quote_id = 101
        customer_name = "Beta"
        location_address = "456 Oak"
        quote_created_on = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)
        quote_accepted_on = datetime(2026, 6, 3, 12, 0, tzinfo=timezone.utc)
        job_created = True
        job_id = 556

    class FakeJob:
        job_id = 555
        address = "123 Main St"
        scheduled_date = datetime(2026, 6, 5, 12, 0, tzinfo=timezone.utc)

    class FakeJobUnscheduled:
        job_id = 556
        address = "456 Oak"
        scheduled_date = None

    monkeypatch.setattr(mm, "_earliest_deficiency_dates", lambda _ids: {100: date(2026, 5, 28)})
    monkeypatch.setattr(mm, "_deficiency_linked_quote_ids_in_window", lambda _s, _e: [100, 101])
    monkeypatch.setattr(
        mm.db.session,
        "query",
        lambda *args, **kwargs: type(
            "Q",
            (),
            {
                "outerjoin": lambda self, *a, **k: self,
                "filter": lambda self, *a, **k: self,
                "all": lambda self: [
                    (FakeQuote(), FakeJob()),
                    (FakeQuoteNoSchedule(), FakeJobUnscheduled()),
                ],
            },
        )(),
    )

    window_start = datetime(2026, 6, 1, tzinfo=timezone.utc)
    window_end = datetime(2026, 6, 30, tzinfo=timezone.utc)
    result = mm.get_scheduled_within_sla_metrics(window_start, window_end)

    assert result["denominator_count"] == 2
    assert result["measurable_count"] == 1
    assert result["within_sla_count"] == 1
    assert result["actual_pct"] == 50.0
    assert result["missing_schedule_date"] == 1
    job = result["within_sla_jobs"][0]
    assert job["job_id"] == 555
    assert job["deficiency_reported_on"] == "2026-05-28"
    assert job["days_deficiency_to_quote"] == 2
    assert job["days_approval_to_scheduled"] == job["business_days"]
    assert business_days_between(date(2026, 6, 2), date(2026, 6, 5)) == job["business_days"]
