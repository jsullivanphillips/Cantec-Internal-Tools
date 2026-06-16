"""
Move known access-instruction text from Key # to ``access_instructions``.

Targets the curated list from unlinked-key triage (excludes ambiguous numeric rows).

Dry-run:

    python -m app.scripts.migrate_access_keys_known_batch

Apply:

    python -m app.scripts.migrate_access_keys_known_batch --execute
"""

from __future__ import annotations

import argparse
import sys

from app import create_app, db
from app.db_models import MonthlyLocation
from app.monthly.key_resolve import sync_key_fk_for_location

# Curated from categorized unlinked-key report (access-instruction rows only).
_ACCESS_INSTRUCTION_LOCATION_IDS: tuple[int, ...] = (
    149,
    187,
    190,
    198,
    243,
    285,
    347,
    350,
    435,
    441,
    477,
    520,
    555,
    573,
    667,
)


def _keys_one_line(raw: str | None) -> str:
    return " ".join((raw or "").strip().split())


def _merge_access_instructions(existing: str | None, keys_raw: str | None) -> str | None:
    keys_text = _keys_one_line(keys_raw)
    existing_text = (existing or "").strip()
    if not keys_text:
        return existing_text or None
    if not existing_text:
        return keys_text
    if keys_text.casefold() in existing_text.casefold():
        return existing_text
    if existing_text.casefold() in keys_text.casefold():
        return keys_text
    return f"{existing_text} — {keys_text}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Migrate known access Key # rows.")
    parser.add_argument("--execute", action="store_true", help="Persist changes.")
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        locs = (
            MonthlyLocation.query.filter(MonthlyLocation.id.in_(_ACCESS_INSTRUCTION_LOCATION_IDS))
            .order_by(MonthlyLocation.id.asc())
            .all()
        )
        found_ids = {int(loc.id) for loc in locs}
        missing = [i for i in _ACCESS_INSTRUCTION_LOCATION_IDS if i not in found_ids]

        print("=== Migrate known access Key # -> access_instructions ===\n")
        print(f"Target ids: {len(_ACCESS_INSTRUCTION_LOCATION_IDS)}")
        if missing:
            print(f"Missing from DB: {missing}")

        actions: list[tuple[int, str, str | None, str | None]] = []
        for loc in locs:
            lid = int(loc.id)
            keys_before = (loc.keys or "").strip()
            access_before = (loc.access_instructions or "").strip() or None
            if not keys_before:
                actions.append((lid, "skip_no_keys", access_before, None))
                continue
            access_after = _merge_access_instructions(loc.access_instructions, loc.keys)
            actions.append((lid, "update", access_before, access_after))

        for lid, kind, before, after in actions:
            if kind == "skip_no_keys":
                print(f"  {lid}: skip (Key # already empty)")
            else:
                print(f"  {lid}: access {before!r} -> {after!r}")

        updatable = [a for a in actions if a[1] == "update"]
        print(f"\nWould update: {len(updatable)}  |  Skip: {len(actions) - len(updatable)}")

        if not args.execute:
            print("\nDry run — re-run with --execute to apply.")
            return 0

        updated = 0
        for loc in locs:
            if not (loc.keys or "").strip():
                continue
            loc.access_instructions = _merge_access_instructions(loc.access_instructions, loc.keys)
            loc.keys = None
            sync_key_fk_for_location(loc)
            updated += 1

        db.session.commit()
        print(f"\nDone. Updated {updated} locations.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
