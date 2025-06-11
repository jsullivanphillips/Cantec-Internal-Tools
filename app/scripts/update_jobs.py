# app/scripts/update_jobs.py
import os
import sys
from flask import session
from app.routes.performance_summary import jobs_summary
from app import create_app

app = create_app()  # your Flask app factory

if __name__ == "__main__":
    short_run = "--short-run" in sys.argv
    with app.app_context():
        with app.test_request_context():
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")
            jobs_summary(short_run=short_run)
            print("✅ Jobs updated successfully.")
