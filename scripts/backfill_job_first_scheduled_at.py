"""Backfill job.first_scheduled_at from ServiceTrade appointment created timestamps."""
from __future__ import annotations

from datetime import datetime, timezone

from dotenv import load_dotenv
from tqdm import tqdm

from app import create_app
from app.db_models import Job, Quote, db
from app.routes.performance_summary import authenticate, fetch_earliest_appointment_created_at

load_dotenv("app/.env")


def main() -> None:
    app = create_app()
    with app.app_context():
        authenticate()
        job_ids = {
            int(row[0])
            for row in db.session.query(Job.job_id)
            .filter(Job.first_scheduled_at.is_(None))
            .join(Quote, Quote.job_id == Job.job_id)
            .filter(Quote.status == "accepted")
            .all()
        }
        if not job_ids:
            print("No accepted-quote jobs missing first_scheduled_at")
            return

        updated = 0
        for job_id in tqdm(sorted(job_ids), desc="Backfilling first_scheduled_at"):
            action_at = fetch_earliest_appointment_created_at(job_id)
            if action_at is None:
                continue
            job = Job.query.filter_by(job_id=job_id).first()
            if job is None:
                continue
            job.first_scheduled_at = action_at
            updated += 1
            if updated % 50 == 0:
                db.session.commit()

        db.session.commit()
        print({"jobs_scanned": len(job_ids), "jobs_updated": updated})


if __name__ == "__main__":
    main()
