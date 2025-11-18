from datetime import datetime, timedelta
from app.routes.performance_summary import update_all_data, query_quote_by_id, update_quotes  # adjust import as needed
from flask import session
import os
import argparse
from app import create_app

app = create_app()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill ServiceRecurrence for all or one location")
    parser.add_argument("--quote-id", type=int, help="Single ServiceTrade quoteId to query")
    parser.add_argument("--temp-backfill-quotes", action="store_true", help="Temporary flag to backfill all data regardless of day")
    args = parser.parse_args()
    with app.app_context():
        with app.test_request_context():
            # Set up ServiceTrade credentials from environment
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")
            # TESTING QUOTES
            if args.quote_id:
                quote_id = args.quote_id
                query_quote_by_id(quote_id)
                exit()
            
            if args.temp_backfill_quotes:
                end = datetime.now()
                start = end - timedelta(days=180)

                update_quotes(start_date=start, end_date=end)
                print("✅ All data updated successfully.")
                exit()

            # Only run on Saturday (weekday() == 5)
            if datetime.now().weekday() == 5:
                # Run for the last 7 days
                end = datetime.now()
                start = end - timedelta(days=8)

                update_all_data(start_date=start, end_date=end)
                print("✅ All data updated successfully.")
            else:
                print("ℹ️ Not Saturday — skipping update.")
