"""
Shared classification + validation for ``MonthlyRoute`` backfill from ``TEST DAY``.

Does not touch ``keys`` / ``key_status``. Safe to import from CLI scripts only.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from app.monthly.test_day import (
    monthly_test_day_is_cancelled,
    parse_test_day,
    pattern_key,
)


@dataclass
class RouteBucket:
    weekday_iso: int
    week_occurrence: int
    location_ids: list[int] = field(default_factory=list)
    sample_raw: list[str] = field(default_factory=list)


@dataclass
class ClassificationResult:
    buckets: dict[int, RouteBucket]
    parse_errors: list[tuple[int, str, str]]
    blank_test_day_ids: list[int]
    cancelled_test_day_ids: list[int]
    pattern_conflict_msgs: list[str]


def classify_monthly_locations(locations: list) -> ClassificationResult:
    """Parse TEST DAY per row; group by route_number; detect pattern conflicts."""
    parsed_entries: list[tuple[int, object]] = []
    parse_errors: list[tuple[int, str, str]] = []
    blank_ids: list[int] = []
    cancelled_ids: list[int] = []

    for loc in locations:
        td = loc.test_day
        if not (td or "").strip():
            blank_ids.append(loc.id)
            continue
        if monthly_test_day_is_cancelled(td):
            cancelled_ids.append(loc.id)
            continue
        try:
            parsed = parse_test_day(td)
        except ValueError as ex:
            parse_errors.append((loc.id, td or "", str(ex)))
            continue
        if parsed is None:
            blank_ids.append(loc.id)
            continue
        parsed_entries.append((loc.id, parsed))

    patterns_by_rn: dict[int, set[tuple[int, int]]] = defaultdict(set)
    for lid, p in parsed_entries:
        patterns_by_rn[p.route_number].add(pattern_key(p))

    rn_conflicts = sorted(rn for rn, pats in patterns_by_rn.items() if len(pats) > 1)
    conflict_msgs = [
        f"route_number=R{rn}: multiple (weekday_iso, week_occurrence) in TEST DAY: "
        f"{sorted(patterns_by_rn[rn])}"
        for rn in rn_conflicts
    ]

    buckets: dict[int, RouteBucket] = {}
    for lid, p in parsed_entries:
        rn = p.route_number
        if rn in rn_conflicts:
            continue
        if rn not in buckets:
            buckets[rn] = RouteBucket(weekday_iso=p.weekday_iso, week_occurrence=p.week_occurrence)
        b = buckets[rn]
        b.location_ids.append(lid)
        if len(b.sample_raw) < 3:
            b.sample_raw.append(p.raw)

    return ClassificationResult(
        buckets=buckets,
        parse_errors=parse_errors,
        blank_test_day_ids=blank_ids,
        cancelled_test_day_ids=cancelled_ids,
        pattern_conflict_msgs=conflict_msgs,
    )


def validate_existing_monthly_route_rows(
    existing: list,
    buckets: dict[int, RouteBucket],
) -> tuple[list[str], list[str]]:
    """Return (blocking_errors, warnings)."""
    blocking: list[str] = []
    warnings: list[str] = []
    by_rn = {r.route_number: r for r in existing}

    for rn, row in by_rn.items():
        if rn not in buckets:
            warnings.append(
                f"monthly_route id={row.id} R{rn} has no library TEST DAY rows "
                "(orphan DB route — remove manually or ignore if intentional)."
            )
            continue
        b = buckets[rn]
        if row.weekday_iso != b.weekday_iso or row.week_occurrence != b.week_occurrence:
            blocking.append(
                f"monthly_route id={row.id} R{rn} has weekday/occurrence "
                f"({row.weekday_iso},{row.week_occurrence}) but library implies "
                f"({b.weekday_iso},{b.week_occurrence})"
            )
    return blocking, warnings


def validate_existing_location_fks(
    locations: list,
    buckets: dict[int, RouteBucket],
    route_by_id: dict,
) -> tuple[list[str], list[str]]:
    """Blocking FK mismatches vs parsed TEST DAY; warnings for odd states."""
    blocking: list[str] = []
    warns: list[str] = []

    for loc in locations:
        if loc.monthly_route_id is None:
            continue
        mr = route_by_id.get(loc.monthly_route_id)
        if mr is None:
            blocking.append(
                f"location_id={loc.id} monthly_route_id={loc.monthly_route_id} -> no MonthlyRoute row"
            )
            continue

        td = loc.test_day
        if not (td or "").strip():
            warns.append(f"location_id={loc.id} has monthly_route_id but TEST DAY is blank")
            continue
        if monthly_test_day_is_cancelled(td):
            warns.append(f"location_id={loc.id} has monthly_route_id but TEST DAY is cancelled (-)")
            continue

        try:
            p = parse_test_day(td)
        except ValueError as ex:
            blocking.append(f"location_id={loc.id} has monthly_route_id but TEST DAY invalid: {ex}")
            continue
        if p is None:
            continue

        if mr.route_number != p.route_number:
            blocking.append(
                f"location_id={loc.id} FK -> R{mr.route_number} but TEST DAY is R{p.route_number}"
            )
        if mr.weekday_iso != p.weekday_iso or mr.week_occurrence != p.week_occurrence:
            blocking.append(
                f"location_id={loc.id} FK MonthlyRoute R{mr.route_number} "
                f"weekday/occ ({mr.weekday_iso},{mr.week_occurrence}) != TEST DAY "
                f"({p.weekday_iso},{p.week_occurrence})"
            )

    return blocking, warns


def assigned_location_ids(buckets: dict[int, RouteBucket]) -> set[int]:
    out: set[int] = set()
    for b in buckets.values():
        out.update(b.location_ids)
    return out
