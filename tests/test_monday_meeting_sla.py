from datetime import date, datetime, timezone

from app.utils.business_days import business_days_between


def test_get_scheduled_within_sla_metrics_shape(monkeypatch):
    """Smoke test payload shape without DB — uses mocked query loop."""
    from app.routes import monday_meeting as mm

    class FakeQuote:
        quote_id = 100
        owner_email = "alex.service@cscfire.com"
        location_address = "123 Main St"
        quote_created_on = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
        quote_accepted_on = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)
        job_created = True
        job_id = 555

    class FakeQuoteNoSchedule:
        quote_id = 101
        owner_email = "jamie.admin@cscfire.com"
        location_address = "456 Oak"
        quote_created_on = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)
        quote_accepted_on = datetime(2026, 6, 3, 12, 0, tzinfo=timezone.utc)
        job_created = True
        job_id = 556

    class FakeJob:
        job_id = 555
        address = "123 Main St"
        created_by_name = "Verena Heinrich"
        scheduled_date = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
        first_scheduled_at = datetime(2026, 6, 5, 12, 0, tzinfo=timezone.utc)

    class FakeJobUnscheduled:
        job_id = 556
        address = "456 Oak"
        created_by_name = None
        scheduled_date = None
        first_scheduled_at = None

    class FakeQuoteOverSla:
        quote_id = 102
        owner_email = "sam.quotes@cscfire.com"
        location_address = "789 Pine"
        quote_created_on = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
        quote_accepted_on = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)
        job_created = True
        job_id = 557

    class FakeQuoteNoJobOverSla:
        quote_id = 103
        owner_email = "taylor.ops@cscfire.com"
        location_address = "321 Cedar"
        quote_created_on = datetime(2026, 6, 3, 12, 0, tzinfo=timezone.utc)
        quote_accepted_on = datetime(2026, 6, 4, 12, 0, tzinfo=timezone.utc)
        job_created = False
        job_id = None

    class FakeQuoteNoJobRecent:
        quote_id = 104
        owner_email = "casey.ops@cscfire.com"
        location_address = "654 Birch"
        quote_created_on = datetime(2026, 6, 17, 12, 0, tzinfo=timezone.utc)
        quote_accepted_on = datetime(2026, 6, 18, 12, 0, tzinfo=timezone.utc)
        job_created = False
        job_id = None

    class FakeJobOverSla:
        job_id = 557
        address = "789 Pine"
        created_by_name = "Sam Quotes"
        scheduled_date = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)
        first_scheduled_at = datetime(2026, 6, 25, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        mm,
        "_deficiency_info_by_quote",
        lambda _ids: {
            100: {
                "deficiency_reported_on": date(2026, 5, 28),
                "deficiency_service_line": "Fire Alarm",
            },
            102: {
                "deficiency_reported_on": date(2026, 5, 29),
                "deficiency_service_line": "Sprinkler",
            },
        },
    )
    monkeypatch.setattr(mm, "_sla_quotes_for_approval_window", lambda _s, _e: [100, 101, 102, 103, 104])
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
                    (FakeQuoteOverSla(), FakeJobOverSla()),
                    (FakeQuoteNoJobOverSla(), None),
                    (FakeQuoteNoJobRecent(), None),
                ],
            },
        )(),
    )

    window_start = datetime(2026, 6, 1, tzinfo=timezone.utc)
    window_end = datetime(2026, 6, 30, tzinfo=timezone.utc)
    result = mm.get_scheduled_within_sla_metrics(
        window_start,
        window_end,
        as_of_date=date(2026, 6, 20),
    )

    assert result["denominator_count"] == 5
    assert result["measurable_count"] == 2
    assert result["within_sla_count"] == 1
    assert result["actual_pct"] == round(100 / 5, 1)
    assert result["awaiting_job_under_sla_count"] == 1
    assert result["awaiting_job_over_sla_count"] == 1
    assert result["unscheduled_under_sla_count"] == 0
    assert result["unscheduled_over_sla_count"] == 1
    assert len(result["awaiting_job_under_sla_jobs"]) == 1
    awaiting = result["awaiting_job_under_sla_jobs"][0]
    assert awaiting["quote_id"] == 104
    assert awaiting["no_job_created"] is True
    over_no_job = result["awaiting_job_over_sla_jobs"][0]
    assert over_no_job["quote_id"] == 103
    assert over_no_job["no_job_created"] is True
    assert over_no_job["days_since_approval"] > 10
    unscheduled_over = result["unscheduled_over_sla_jobs"][0]
    assert unscheduled_over["job_id"] == 556
    assert unscheduled_over["scheduled_date"] is None
    assert len(result["eligible_jobs"]) == 2
    job = result["within_sla_jobs"][0]
    assert job["job_id"] == 555
    assert job["deficiency_reported_on"] == "2026-05-28"
    assert job["deficiency_service_line"] == "Fire Alarm"
    assert job["quote_created_by"] == "Alex Service"
    assert job["job_created_by"] == "Verena Heinrich"
    assert job["scheduled_on"] == "2026-06-05"
    assert job["scheduled_date"] == "2026-07-15"
    assert job["days_deficiency_to_quote"] == 2
    assert job["days_approval_to_scheduled"] == job["business_days"]
    assert business_days_between(date(2026, 6, 2), date(2026, 6, 5)) == job["business_days"]
    over = next(row for row in result["eligible_jobs"] if not row["within_sla"])
    assert over["job_id"] == 557
    assert over["deficiency_service_line"] == "Sprinkler"
    assert over["business_days"] > 10
