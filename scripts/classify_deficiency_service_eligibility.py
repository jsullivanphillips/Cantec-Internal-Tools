"""Backfill or refresh deficiency service eligibility classifications."""
from __future__ import annotations

from app import create_app
from app.deficiency.service_eligibility import classify_all_deficiencies


def main() -> None:
    app = create_app()
    with app.app_context():
        result = classify_all_deficiencies()
        print(
            f"Classified {result['total']} deficiencies: "
            f"{result['eligible']} eligible, "
            f"{result['excluded_keyword']} keyword excluded"
        )


if __name__ == "__main__":
    main()
