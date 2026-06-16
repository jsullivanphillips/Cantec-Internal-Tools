"""Diagnose Monday Meeting SLA metric data gaps."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, distinct
from zoneinfo import ZoneInfo

from app import create_app
from app.db_models import Deficiency, Job, Quote, QuoteDeficiencyLink, db
from app.routes.monday_meeting import get_scheduled_within_sla_metrics

PACIFIC = ZoneInfo("America/Vancouver")


def main() -> None:
    app = create_app()
    with app.app_context():
        end = datetime.now(PACIFIC)
        start = end - timedelta(days=180)
        ws = start.astimezone(timezone.utc)
        we = end.astimezone(timezone.utc)

        qf = and_(Quote.quote_created_on >= ws, Quote.quote_created_on <= we)
        total_q = Quote.query.filter(qf).count()
        accepted = Quote.query.filter(qf, Quote.status == "accepted").count()
        with_job = Quote.query.filter(
            qf, Quote.status == "accepted", Quote.job_created.is_(True)
        ).count()
        with_accepted_on = Quote.query.filter(
            qf, Quote.status == "accepted", Quote.quote_accepted_on.isnot(None)
        ).count()

        joined = (
            db.session.query(Quote, Job)
            .join(Job, Quote.job_id == Job.job_id)
            .filter(qf, Quote.status == "accepted", Quote.job_created.is_(True))
            .count()
        )
        joined_sched = (
            db.session.query(Quote, Job)
            .join(Job, Quote.job_id == Job.job_id)
            .filter(
                qf,
                Quote.status == "accepted",
                Quote.job_created.is_(True),
                Job.scheduled_date.isnot(None),
            )
            .count()
        )
        joined_full = (
            db.session.query(Quote, Job)
            .join(Job, Quote.job_id == Job.job_id)
            .filter(
                qf,
                Quote.status == "accepted",
                Quote.job_created.is_(True),
                Quote.quote_accepted_on.isnot(None),
                Job.scheduled_date.isnot(None),
            )
            .count()
        )

        missing_job = (
            db.session.query(Quote)
            .filter(qf, Quote.status == "accepted", Quote.job_id.isnot(None))
            .outerjoin(Job, Quote.job_id == Job.job_id)
            .filter(Job.job_id.is_(None))
            .count()
        )

        defs = Deficiency.query.filter(
            Deficiency.deficiency_created_on >= ws,
            Deficiency.deficiency_created_on <= we,
        ).count()

        sla = get_scheduled_within_sla_metrics(ws, we, business_day_limit=300)

        cohort = (
            db.session.query(Quote.quote_id)
            .join(QuoteDeficiencyLink, Quote.quote_id == QuoteDeficiencyLink.quote_id)
            .join(Deficiency, QuoteDeficiencyLink.deficiency_id == Deficiency.deficiency_id)
            .filter(
                Deficiency.deficiency_created_on >= ws,
                Deficiency.deficiency_created_on <= we,
            )
            .distinct()
            .count()
        )

        print("=== 6 month window ===")
        print(f"deficiencies created: {defs}")
        print(f"quotes in deficiency cohort: {cohort}")
        print(f"quotes created: {total_q}")
        print(f"accepted quotes: {accepted}")
        print(f"accepted + job_created: {with_job}")
        print(f"accepted + quote_accepted_on: {with_accepted_on}")
        print(f"accepted joined to Job row: {joined}")
        print(f"... with scheduled_date: {joined_sched}")
        print(f"... with accepted_on + scheduled: {joined_full}")
        print(f"accepted job_id but NO Job row: {missing_job}")
        print(f"SLA eligible_count (300d): {sla['eligible_count']}")
        print(f"SLA within_sla_count (300d): {sla['within_sla_count']}")
        print(f"SLA pct (300d): {sla['actual_pct']}")
        print(f"missing approval: {sla['missing_approval_date']}")
        print(f"missing schedule: {sla['missing_schedule_date']}")

        statuses = db.session.query(distinct(Quote.status)).filter(qf).all()
        print("quote statuses in window:", [s[0] for s in statuses])


if __name__ == "__main__":
    main()
