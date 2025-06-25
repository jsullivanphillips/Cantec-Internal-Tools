from datetime import datetime, timedelta
from app.routes.performance_summary import update_all_data  # adjust import as needed
from flask import session
import os
from app import create_app

app = create_app()

if __name__ == "__main__":
    with app.app_context():
        with app.test_request_context():
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")

            # Run for the last 7 days
            end = datetime.now()
            start = end - timedelta(days=160)

            update_all_data(start_date=start, end_date=end)
            print("all data updated successfully.")
