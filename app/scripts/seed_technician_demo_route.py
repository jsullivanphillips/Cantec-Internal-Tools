"""Seed or reset the live technician training route (default R99).

    python -m app.scripts.seed_technician_demo_route
    python -m app.scripts.seed_technician_demo_route --reset
"""

from __future__ import annotations

import argparse

from app import create_app, db
from app.monthly.technician_demo_route import (
    ensure_technician_demo_route,
    get_technician_demo_route,
    reset_technician_demo_route_month,
    technician_demo_route_number,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the technician portal training route.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Reset the current Pacific month to the baseline training scenario.",
    )
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        if args.reset:
            run = reset_technician_demo_route_month()
            if run is None:
                print(
                    f"No training route R{technician_demo_route_number()} found. "
                    "Run without --reset to seed first."
                )
                return
            db.session.refresh(run)
            print(
                f"Reset training route R{technician_demo_route_number()} "
                f"for month {run.month_date.isoformat()} (run id={run.id})."
            )
            return

        route = ensure_technician_demo_route()
        db.session.refresh(route)
        stop_count = len(route.locations) if route.locations else 0
        print(
            f"Ensured training route R{route.route_number} (id={route.id}, "
            f"{stop_count} stops)."
        )


if __name__ == "__main__":
    main()
