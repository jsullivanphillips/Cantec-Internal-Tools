import argparse
from app import create_app
from app.routes.scheduling_attack import update_service_recurrence_time

def main():
    p = argparse.ArgumentParser(description="Update ServiceRecurrence tech hours from clock events")
    p.add_argument("--location-id", type=int, help="Only update this ServiceTrade location_id")
    p.add_argument("--force", action="store_true", help="Overwrite existing hours/provenance")
    p.add_argument("--commit-every", type=int, default=200, help="Batch commit size")
    args = p.parse_args()

    app = create_app()
    with app.app_context():
        out = update_service_recurrence_time(
            force=args.force,
            commit_every=args.commit_every,
            location_id=args.location_id,
        )
        print(out)

if __name__ == "__main__":
    main()
