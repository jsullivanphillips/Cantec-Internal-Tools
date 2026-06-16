"""Diagnose why approved no-job quotes are missing from SLA open buckets."""
from datetime import datetime, timedelta, timezone

from app import create_app
from app.db_models import DeficiencyServiceEligibility, Quote, QuoteDeficiencyLink, Deficiency, db
from app.routes.monday_meeting import (
    _days_since_approval,
    _pacific_today,
    _quote_has_repair_job,
    _sla_quotes_for_approval_window,
    get_scheduled_within_sla_metrics,
)
from app.routes.performance_summary import _parse_date_param


def main() -> None:
    app = create_app()
    with app.app_context():
        as_of = _pacific_today()
        print(f"Today Pacific: {as_of}")

        for label, start, end in [
            ("Q1 2026", "2026-01-01", "2026-03-31"),
            ("Q2 2026", "2026-04-01", "2026-06-30"),
        ]:
            ws = _parse_date_param(start, end_of_day=False)
            we = _parse_date_param(end, end_of_day=True)
            sla = get_scheduled_within_sla_metrics(ws, we, as_of_date=as_of)
            print(f"\n{label} SLA buckets:")
            print(f"  awaiting_job_under: {sla['awaiting_job_under_sla_count']}")
            print(f"  awaiting_job_over: {sla['awaiting_job_over_sla_count']}")
            print(f"  unscheduled_under: {sla['unscheduled_under_sla_count']}")
            print(f"  unscheduled_over: {sla['unscheduled_over_sla_count']}")
            print(f"  denominator: {sla['denominator_count']}")

        ws = _parse_date_param("2026-04-01", end_of_day=False)
        we = _parse_date_param("2026-06-30", end_of_day=True)
        cohort_ids = set(_sla_quotes_for_approval_window(ws, we))

        recent = datetime.now(timezone.utc) - timedelta(days=45)
        rows = (
            db.session.query(Quote, Deficiency)
            .join(QuoteDeficiencyLink, Quote.quote_id == QuoteDeficiencyLink.quote_id)
            .join(Deficiency, QuoteDeficiencyLink.deficiency_id == Deficiency.deficiency_id)
            .filter(Quote.status == "accepted")
            .filter(Quote.quote_accepted_on.isnot(None))
            .filter(Quote.quote_accepted_on >= recent)
            .order_by(Quote.quote_accepted_on.desc())
            .limit(30)
            .all()
        )
        print("\nRecent accepted deficiency quotes (45d):")
        for quote, deficiency in rows:
            eligibility = DeficiencyServiceEligibility.query.filter_by(
                deficiency_id=deficiency.deficiency_id
            ).first()
            has_job = _quote_has_repair_job(quote)
            days = _days_since_approval(quote, as_of)
            in_cohort = int(quote.quote_id) in cohort_ids
            eligible = None if eligibility is None else eligibility.eligible
            bucket = "awaiting_under" if not has_job and days is not None and days <= 10 else (
                "awaiting_over" if not has_job else "has_job"
            )
            print(
                f"  quote={quote.quote_id} accepted={quote.quote_accepted_on.date() if quote.quote_accepted_on else None} "
                f"job_created={quote.job_created} job_id={quote.job_id} days={days} "
                f"in_Q2_cohort={in_cohort} eligible={eligible} expected={bucket}"
            )


if __name__ == "__main__":
    main()
