# app/scripts/check_month_conflicts.py
import argparse
from app import create_app
from app.routes.scheduling_attack import (
    authenticate,
    check_month_conflicts,
    check_month_conflict_for_location,
)

def main():
    parser = argparse.ArgumentParser(description="Check recurrence month conflicts")
    parser.add_argument("--location-id", type=int, help="Debug a single location id")
    parser.add_argument("--csv", default="recurrence_month_conflicts.csv", help="Output CSV for bulk run")
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        authenticate()
        if args.location_id:
            check_month_conflict_for_location(args.location_id)
        else:
            check_month_conflicts(output_csv=args.csv)

if __name__ == "__main__":
    main()
