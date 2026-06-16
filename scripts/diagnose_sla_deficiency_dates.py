"""Diagnose missing deficiency reported dates on SLA timeline rows."""
from datetime import datetime, timezone

from zoneinfo import ZoneInfo

from app import create_app
from app.db_models import Deficiency, Job, Quote, QuoteDeficiencyLink, db
from app.routes.monday_meeting import _quote_window_filter, get_scheduled_within_sla_metrics

PACIFIC = ZoneInfo("America/Vancouver")


def main() -> None:
    app = create_app()
    with app.app_context():
        start = datetime(2026, 5, 1, tzinfo=PACIFIC)
        end = datetime.now(PACIFIC)
        ws = start.astimezone(timezone.utc)
        we = end.astimezone(timezone.utc)

        qf = _quote_window_filter(ws, we)
        rows = (
            db.session.query(Quote, Job)
            .outerjoin(Job, Quote.job_id == Job.job_id)
            .filter(
                qf,
                Quote.status == "accepted",
                Quote.job_created.is_(True),
                Quote.job_id.isnot(None),
            )
            .all()
        )

        no_link = 0
        link_no_date = 0
        with_def_date = 0

        for quote, job in rows:
            if quote.quote_accepted_on is None or job is None or job.scheduled_date is None:
                continue
            links = QuoteDeficiencyLink.query.filter_by(quote_id=quote.quote_id).all()
            if not links:
                no_link += 1
                continue
            defs = Deficiency.query.filter(
                Deficiency.deficiency_id.in_([link.deficiency_id for link in links])
            ).all()
            dates = [d.deficiency_created_on for d in defs if d.deficiency_created_on]
            if dates:
                with_def_date += 1
            else:
                link_no_date += 1

        sla = get_scheduled_within_sla_metrics(ws, we)
        missing = [j for j in sla["eligible_jobs"] if not j.get("deficiency_reported_on")]
        total = len(sla["eligible_jobs"])

        print("=== May 1 – today measurable SLA jobs ===")
        print(f"with deficiency link + created date: {with_def_date}")
        print(f"no quote_deficiency_link row: {no_link}")
        print(f"link exists but deficiency_created_on is null: {link_no_date}")
        print(f"timeline missing reported date: {len(missing)} / {total}")
        if missing:
            print("sample quote_ids without date:", [m["quote_id"] for m in missing[:5]])


if __name__ == "__main__":
    main()
