"""
Sync ServiceTrade contacts for monthly library locations with a site link.

Requires PROCESSING_USERNAME / PROCESSING_PASSWORD.

Heroku Scheduler (daily):
  python -m app.scripts.sync_monthly_service_trade_contacts

CLI:
  python -m app.scripts.sync_monthly_service_trade_contacts --limit 10
  python -m app.scripts.sync_monthly_service_trade_contacts --st-location-id 6470762
"""
from __future__ import annotations

import argparse
import sys

from dotenv import load_dotenv

from app import create_app, db
from app.monthly.service_trade_location_contacts import (
    authenticated_service_trade_session,
    count_linked_monthly_locations_missing_email_contact,
    linked_service_trade_site_location_ids,
    service_trade_credentials,
    sync_all_linked_service_trade_site_contacts,
)

load_dotenv()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Sync ServiceTrade site contacts for linked monthly library locations.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Process at most N distinct ServiceTrade site location ids (debug).",
    )
    parser.add_argument(
        "--st-location-id",
        type=int,
        default=None,
        metavar="ID",
        help="Sync only this ServiceTrade building location id.",
    )
    args = parser.parse_args(argv)

    try:
        service_trade_credentials()
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        return 1

    app = create_app()
    with app.app_context():
        if args.st_location_id is not None:
            site_ids = [int(args.st_location_id)]
        else:
            site_ids = linked_service_trade_site_location_ids()

        print(f"Distinct linked ServiceTrade site locations: {len(site_ids)}")
        if not site_ids:
            print("No linked site locations to sync.")
            return 0

        http = authenticated_service_trade_session()
        summary = sync_all_linked_service_trade_site_contacts(
            http,
            site_location_ids=site_ids,
            limit=args.limit,
        )

        print(f"Site locations processed: {summary.site_locations_processed}")
        print(f"Contacts upserted: {summary.contacts_upserted}")
        print(f"Contacts deleted (stale/removed): {summary.contacts_deleted}")
        print(f"Sites with email contact: {summary.sites_with_email}")
        print(f"Sites with phone contact: {summary.sites_with_phone}")
        print(f"Sites missing email contact: {summary.sites_missing_email}")
        print(f"Unlinked monthly rows flags cleared: {summary.unlinked_flags_cleared}")
        print(f"Orphaned contact rows pruned: {summary.orphaned_contacts_pruned}")
        print(
            "Linked monthly locations missing email contact: "
            f"{count_linked_monthly_locations_missing_email_contact()}"
        )

        if summary.errors:
            print(f"Errors ({len(summary.errors)}):", file=sys.stderr)
            for line in summary.errors[:20]:
                print(f"  {line}", file=sys.stderr)
            if len(summary.errors) > 20:
                print(f"  ... and {len(summary.errors) - 20} more", file=sys.stderr)
            db.session.remove()
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
