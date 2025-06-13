# app/scripts/update_jobs.py
import os
import sys
from flask import session
from app import create_app
from app.routes.performance_summary import (
    jobs_summary,
    update_deficiencies,
    update_locations,
    update_quotes
)

app = create_app()

if __name__ == "__main__":
    short_run = "--short-run" in sys.argv
    run_deficiencies = "--deficiencies" in sys.argv
    run_locations = "--locations" in sys.argv
    run_quotes = "--quotes" in sys.argv

    with app.app_context():
        with app.test_request_context():
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")

            if run_deficiencies:
                update_deficiencies()
                print("✅ Deficiencies updated.")
            elif run_locations:
                update_locations()
                print("✅ Locations updated.")
            elif run_quotes:
                update_quotes()
                print("✅ Quotes updated.")
            else:
                jobs_summary(short_run=short_run)
                print("✅ Jobs updated successfully.")
