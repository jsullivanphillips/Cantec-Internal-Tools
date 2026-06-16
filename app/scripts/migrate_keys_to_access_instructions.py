"""
Move access-style KEYS text into ``access_instructions`` and clear ``keys``.

Targets locations matched by ``list_access_instruction_key_migrations``:
- Meaningful access notes (Call…, Contact…, On Site, etc.) → copy to ``access_instructions``
- Pure sentinels (-, N/A, No keys, …) → clear ``keys`` only

Dry-run (default):

    python -m app.scripts.migrate_keys_to_access_instructions

Apply:

    python -m app.scripts.migrate_keys_to_access_instructions --execute
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy.orm import joinedload

from app import create_app, db
from app.db_models import MonthlyLocation
from app.monthly.key_resolve import sync_key_fk_for_location
from app.monthly.monthly_keys_keycode import monthly_keys_field_indicates_no_key

# Clear ``keys`` only — do not copy into access_instructions.
_SENTINELS_CLEAR_ONLY_CF = frozenset(
    {
        "n/a",
        "na",
        "none",
        "no keys",
        "no key",
    }
)


def _keys_one_line(raw: str | None) -> str:
    return " ".join((raw or "").strip().split())


def _should_copy_to_access_instructions(keys: str) -> bool:
    text = _keys_one_line(keys)
    if not text:
        return False
    if text in ("-", "–", "—"):
        return False
    cf = text.casefold()
    if cf in _SENTINELS_CLEAR_ONLY_CF:
        return False
    return monthly_keys_field_indicates_no_key(keys)


def _targets() -> list[MonthlyLocation]:
    locs = (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.monthly_route))
        .order_by(MonthlyLocation.id.asc())
        .all()
    )
    out: list[MonthlyLocation] = []
    for loc in locs:
        keys_raw = (loc.keys or "").strip()
        if not keys_raw:
            continue
        if not monthly_keys_field_indicates_no_key(loc.keys):
            continue
        if (loc.access_instructions or "").strip():
            continue
        out.append(loc)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Migrate KEYS access text to access_instructions.")
    parser.add_argument("--execute", action="store_true", help="Persist changes.")
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        targets = _targets()
        copy_rows: list[tuple[int, str]] = []
        clear_only: list[int] = []

        for loc in targets:
            keys_text = _keys_one_line(loc.keys)
            if _should_copy_to_access_instructions(loc.keys or ""):
                copy_rows.append((int(loc.id), keys_text))
            else:
                clear_only.append(int(loc.id))

        print("=== Migrate KEYS -> access_instructions ===\n")
        print(f"Total locations: {len(targets)}")
        print(f"  Copy to access_instructions + clear keys: {len(copy_rows)}")
        print(f"  Clear keys only (sentinels): {len(clear_only)}")

        if copy_rows:
            print("\n[COPY + CLEAR]")
            for lid, text in copy_rows:
                print(f"  {lid}: {text}")

        if clear_only:
            print("\n[CLEAR KEYS ONLY]")
            print(f"  ids: {', '.join(str(i) for i in clear_only)}")

        if not args.execute:
            print("\nDry run — re-run with --execute to apply.")
            return 0

        updated = 0
        for loc in targets:
            keys_text = _keys_one_line(loc.keys)
            if _should_copy_to_access_instructions(loc.keys or ""):
                loc.access_instructions = keys_text
            loc.keys = None
            sync_key_fk_for_location(loc)
            updated += 1

        db.session.commit()
        print(f"\nDone. Updated {updated} locations.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
