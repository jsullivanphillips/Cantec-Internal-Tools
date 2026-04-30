"""
Read-only: show which ``MonthlyRoute`` rows have ``service_trade_route_location_id`` set.

That column is the ServiceTrade *route* pseudo-location (clock-in route), not a street site.

Usage (repo root, ``DATABASE_URL`` set):

    python -m app.scripts.check_monthly_route_service_trade_ids
    python -m app.scripts.check_monthly_route_service_trade_ids --missing-only
    python -m app.scripts.check_monthly_route_service_trade_ids --route-number 7

Environment (optional):

    SERVICE_TRADE_APP_LOCATIONS_BASE — default ``https://app.servicetrade.com/locations``
"""

from __future__ import annotations

import argparse
import os
import sys

from app import create_app
from app.db_models import MonthlyRoute

WD_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _english_ordinal(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _route_summary(r: MonthlyRoute) -> str:
    wd = WD_NAMES[r.weekday_iso] if 0 <= int(r.weekday_iso) <= 6 else "?"
    nth = _english_ordinal(int(r.week_occurrence))
    return f"id={r.id} R{r.route_number} {nth} {wd}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="List MonthlyRoute rows and ServiceTrade route location id linkage.",
    )
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="Print only routes with NULL service_trade_route_location_id.",
    )
    parser.add_argument(
        "--linked-only",
        action="store_true",
        help="Print only routes with a non-null service_trade_route_location_id.",
    )
    parser.add_argument(
        "--route-number",
        type=int,
        default=None,
        help="Filter to a single Excel route number (e.g. 7 for R7).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Max rows to print per section (default 100).",
    )
    args = parser.parse_args(argv)

    st_base = os.getenv(
        "SERVICE_TRADE_APP_LOCATIONS_BASE",
        "https://app.servicetrade.com/locations",
    ).rstrip("/")

    app = create_app()
    with app.app_context():
        q = MonthlyRoute.query.order_by(MonthlyRoute.route_number.asc())
        if args.route_number is not None:
            q = q.filter(MonthlyRoute.route_number == args.route_number)

        rows = q.all()
        linked = [r for r in rows if r.service_trade_route_location_id is not None]
        missing = [r for r in rows if r.service_trade_route_location_id is None]

        print("=== MonthlyRoute ↔ ServiceTrade route location id ===\n")
        print(f"Routes matching filter: {len(rows)}")
        print(f"  With service_trade_route_location_id: {len(linked)}")
        print(f"  Missing (NULL): {len(missing)}")
        print(f"Web URL base: {st_base}/<id>\n")

        def print_section(title: str, items: list[MonthlyRoute], lim: int) -> None:
            print(f"--- {title} ({len(items)} row(s)) ---")
            for r in items[:lim]:
                st_id = r.service_trade_route_location_id
                extra = ""
                if st_id is not None:
                    extra = f"  ST location id={int(st_id)}  →  {st_base}/{int(st_id)}"
                print(f"  {_route_summary(r)}{extra}")
            if len(items) > lim:
                print(f"  ... ({len(items) - lim} more not shown; raise --limit)")
            print()

        if args.missing_only:
            print_section("Missing ST route location id", missing, args.limit)
        elif args.linked_only:
            print_section("Linked ST route location id", linked, args.limit)
        else:
            print_section("Linked ST route location id", linked, args.limit)
            print_section("Missing ST route location id", missing, args.limit)

    return 0


if __name__ == "__main__":
    sys.exit(main())
