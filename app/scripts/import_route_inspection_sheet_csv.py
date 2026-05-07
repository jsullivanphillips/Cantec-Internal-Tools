"""
Import a technician route inspection CSV (preamble + ``#,Address,...`` data rows).

Updates matched ``MonthlyRouteLocation`` inspection columns and upserts
``MonthlyRouteTestHistory`` for the sheet month, stamping ``test_monthly_route_id`` with the sheet’s
route and ``session_route_stop_order`` from the ``#`` column (session ledger order after reassignment).
``Time In`` / ``Time Out`` classify tested vs skipped and populate ``source_value_raw`` for audit.
``Testing Procedures`` / ``Tech Comments & Notes`` are copied onto each history row for that month (preserved when newer imports refresh ``MonthlyRouteLocation``).

Matching resolves rows by **canonical street keys** (case/spacing; Ave/Avenue; optional trailing
type tokens like ``Street`` may be missing on the sheet vs the DB). Single DB hit wins even when sheet ``Name:`` / ``Management:``
differ from library fields. If several locations share that street, the importer narrows by
**property management** then **building name**; if more than one row remains, the CSV row is
reported as ``duplicate`` / ``ambiguous`` and is **not** written.

Run (from repo root, with app env configured)::

    python -m app.scripts.import_route_inspection_sheet_csv --csv path/to/sheet.csv --dry-run
    python -m app.scripts.import_route_inspection_sheet_csv --csv path/to/sheet.csv --commit
    python -m app.scripts.import_route_inspection_sheet_csv --csv path/to/sheet.csv --commit --sync-stop-order

``--sync-stop-order`` updates ``route_stop_order`` from the ``#`` column only for sites **already**
assigned to the sheet’s route (won’t move stops that switched routes).
"""

from __future__ import annotations

import argparse
import csv
import logging
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app import create_app, db
from app.db_models import MonthlyRoute, MonthlyRouteLocation, MonthlyRouteTestHistory
from app.monthly.sheet_visit_times import analyze_sheet_time_cells

LOG = logging.getLogger("import_route_inspection_sheet_csv")

_MONTH_NAMES = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "sept": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )


def _normalize_space(value: str | None) -> str:
    return " ".join((value or "").strip().split())


# Tokens anywhere in the street line → canonical lowercase form (Ave/Avenue → avenue).
# Do not map geographic words like "bay"; keep mapping conservative suffix/type abbreviations.
_STREET_TOKEN_CANON: dict[str, str] = {
    "avenue": "avenue",
    "ave": "avenue",
    "av": "avenue",
    "street": "street",
    "st": "street",
    "road": "road",
    "rd": "road",
    "boulevard": "boulevard",
    "blvd": "boulevard",
    "drive": "drive",
    "dr": "drive",
    "lane": "lane",
    "ln": "lane",
    "court": "court",
    "crt": "court",
    "ct": "court",
    "place": "place",
    "pl": "place",
    "crescent": "crescent",
    "cres": "crescent",
    "terrace": "terrace",
    "terr": "terrace",
    "highway": "highway",
    "hwy": "highway",
    "way": "way",
    "circle": "circle",
    "cir": "circle",
    "trail": "trail",
    "trl": "trail",
    "parkway": "parkway",
    "pkwy": "parkway",
    "square": "square",
    "sq": "square",
    "close": "close",
    "gate": "gate",
    "green": "green",
    "grove": "grove",
    "heights": "heights",
    "hts": "heights",
    "hill": "hill",
    "island": "island",
    "landing": "landing",
    "manor": "manor",
    "meadow": "meadow",
    "meadows": "meadows",
    "mews": "mews",
    "mount": "mount",
    "mt": "mount",
    "mountain": "mountain",
    "mtn": "mountain",
    "pasaje": "pasaje",
    "path": "path",
    "pines": "pines",
    "point": "point",
    "pt": "point",
    "ridge": "ridge",
    "rise": "rise",
    "row": "row",
    "run": "run",
    "woods": "woods",
}

# If this token is the *last* word after canonicalization, it may be missing on route sheets
# ("1505 Morrison" vs "1505 Morrison Street"). Strip repeatedly for alternate lookup keys.
# Kept conservative — omit "place", "way", "point", "gate", … where names often end the same way.
_OMITTABLE_STREET_SUFFIXES = frozenset({
    "avenue",
    "street",
    "road",
    "boulevard",
    "drive",
    "lane",
    "court",
    "crescent",
    "terrace",
    "circle",
    "trail",
    "parkway",
    "highway",
    "square",
    "close",
})


def canonical_street_address_key(raw: str | None) -> str:
    """
    Normalize free-form street lines so trivial abbreviation variants match each other.

    Examples: ``1653 Oak Bay Ave`` and ``1653 Oak Bay Avenue`` → same key.
    Uses ``MonthlyRouteLocation.address`` (display street); commas truncate suite/city tails often pasted after street.
    """
    if not raw:
        return ""
    segment = _normalize_space(raw.split(",")[0])
    if not segment:
        return ""
    segment = segment.casefold()
    segment = segment.replace(".", " ")
    segment = re.sub(r"[-#/]", " ", segment)
    segment = _normalize_space(segment)
    parts = segment.split()
    out: list[str] = []
    for p in parts:
        p = p.strip(".")
        out.append(_STREET_TOKEN_CANON.get(p, p))
    return " ".join(out)


def iter_street_lookup_keys(raw: str | None) -> list[str]:
    """
    Longest-first keys for indexing / lookup.

    Includes the full canonical line plus successive stems with trailing type tokens removed,
    so ``1505 morrison`` matches DB ``1505 morrison street``.
    """
    base = canonical_street_address_key(raw)
    if not base:
        return []
    keys: list[str] = []
    parts = base.split()
    while parts:
        stem = " ".join(parts)
        keys.append(stem)
        if len(parts) >= 2 and parts[-1] in _OMITTABLE_STREET_SUFFIXES:
            parts = parts[:-1]
            continue
        break
    return keys


def load_locations_by_canonical_street() -> dict[str, list[MonthlyRouteLocation]]:
    """Library rows indexed under every :func:`iter_street_lookup_keys` variant of ``location.address``."""
    idx: dict[str, list[MonthlyRouteLocation]] = defaultdict(list)
    for loc in db.session.execute(select(MonthlyRouteLocation)).scalars().all():
        for key in iter_street_lookup_keys(loc.address):
            idx[key].append(loc)
    return idx


def lookup_locations_for_sheet_street(
    canonical_index: dict[str, list[MonthlyRouteLocation]],
    street_line: str,
) -> list[MonthlyRouteLocation]:
    """Prefer the longest CSV-side key that has DB hits (full ``… Street`` before abbreviated stem)."""
    for key in iter_street_lookup_keys(street_line):
        bucket = canonical_index.get(key)
        if bucket:
            return bucket
    return []


def _normalize_company(value: str | None) -> str:
    return _normalize_space(value).casefold()


def _normalize_building(value: str | None) -> str:
    return _normalize_space(value).casefold()


def _clean_text(value: str | None) -> str | None:
    text = _normalize_space(value)
    return text or None


def _clean_multiline(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    return text or None


_ROUTE_NUMBER_RE = re.compile(r"route\s+(\d+)", re.IGNORECASE)


def _parse_route_number(cell: str | None) -> int | None:
    text = _normalize_space(cell)
    if not text:
        return None
    m = _ROUTE_NUMBER_RE.search(text)
    if not m:
        return None
    return int(m.group(1))


def _parse_month_year(month_cell: str | None, year_cell: str | None) -> date | None:
    mn = _normalize_space(month_cell).lower().strip(".")
    ys = _normalize_space(year_cell)
    if not mn or not ys:
        return None
    try:
        year = int(ys)
    except ValueError:
        return None
    month_num = _MONTH_NAMES.get(mn)
    if month_num is None:
        return None
    return date(year, month_num, 1)


def parse_address_block(text: str | None) -> tuple[str, str | None, str | None]:
    """Street line + optional ``Name:`` building + optional ``Management:`` company."""
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.strip() for ln in raw.split("\n") if ln.strip()]
    if not lines:
        return "", None, None
    street = lines[0]
    building: str | None = None
    company: str | None = None
    for ln in lines[1:]:
        low = ln.lower()
        if low.startswith("name:"):
            building = ln.split(":", 1)[1].strip() or None
        elif low.startswith("management:"):
            company = ln.split(":", 1)[1].strip() or None
    return street, building, company


def _is_monitoring_none(cell: str | None) -> bool:
    t = _normalize_space(cell).upper().strip(".")
    return not t or t == "NONE"


def _read_sheet_rows(path: Path) -> list[list[str]]:
    """
    Excel exports on Windows are often ``cp1252`` (byte ``0x96`` is an en dash in that encoding).
    Try UTF-8 first, then common Windows encodings; ``latin-1`` never fails.
    """
    raw = path.read_bytes()
    text: str | None = None
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = raw.decode(encoding)
            if encoding == "cp1252":
                LOG.info(
                    "Decoded inspection CSV as Windows-1252 (UTF-8 failed — typical Excel-on-Windows export)."
                )
            elif encoding == "latin-1":
                LOG.warning(
                    "Decoded inspection CSV as Latin-1 fallback; verify special characters in the sheet."
                )
            break
        except UnicodeDecodeError:
            continue
    assert text is not None
    return list(csv.reader(StringIO(text)))


def _find_data_header_row_index(rows: list[list[str]]) -> int:
    for idx, row in enumerate(rows):
        if not row:
            continue
        first = _normalize_space(row[0])
        second = _normalize_space(row[1]) if len(row) > 1 else ""
        if first == "#" and second.lower().startswith("address"):
            return idx
    raise ValueError("Could not find data header row (expected first column '#' and second 'Address').")


def parse_sheet_meta(rows: list[list[str]], header_idx: int) -> tuple[int | None, date | None, str | None]:
    """Route number, first-of-month date, optional route label from preamble."""
    route_num: int | None = None
    sheet_month: date | None = None
    route_label: str | None = None
    preamble = rows[:header_idx]
    for row in preamble:
        if len(row) < 2:
            continue
        label_cell = _normalize_space(row[1]).upper().strip(":")
        if label_cell == "ROUTE":
            rn = _parse_route_number(row[4] if len(row) > 4 else None)
            if rn is not None:
                route_num = rn
            if len(row) > 5:
                lab = _clean_text(row[5])
                route_label = lab
        elif label_cell == "DATE":
            sheet_month = _parse_month_year(row[2] if len(row) > 2 else None, row[4] if len(row) > 4 else None)
    return route_num, sheet_month, route_label


def _dict_reader_from_slice(rows: list[list[str]], start: int) -> csv.DictReader:
    buf = StringIO()
    w = csv.writer(buf)
    for r in rows[start:]:
        w.writerow(r)
    buf.seek(0)
    return csv.DictReader(buf)


def _strip_keys(row: dict[str, Any]) -> dict[str, str]:
    return {(_normalize_space(k) or k): (v if isinstance(v, str) else (v or "") or "") for k, v in row.items() if k}


@dataclass
class ImportIssue:
    kind: str
    csv_row: int
    detail: str


def resolve_monthly_location_by_sheet_identity(
    *,
    at_address: list[MonthlyRouteLocation],
    property_management_company_normalized: str,
    building_normalized: str,
    street_display: str,
    company_display: str | None,
    building_display: str | None,
) -> tuple[MonthlyRouteLocation | None, str | None, str]:
    """
    Match a CSV row to ``MonthlyRouteLocation`` without requiring building/PMC to match first.

    1. ``at_address`` is every library row whose canonical street key equals the sheet street
       (see :func:`canonical_street_address_key`). Single hit wins.

    2. If multiple rows share that street, keep those whose PMC normalized equals the sheet
       ``Management:`` line.

    3. If still multiple, keep those whose building normalized equals the sheet ``Name:`` line.

    If more than one row remains after step 3 (or step 2 leaves multiple and building cannot
    narrow), return ``duplicate`` and do not upsert. If step 2 matches zero but step 1 had
    multiple, try step 3 on the full address set; if still not exactly one, ``ambiguous`` /
    ``duplicate`` with detail.
    """
    n_addr = len(at_address)
    if n_addr == 0:
        return None, "unmatched", "0 rows with this canonical street line"
    if n_addr == 1:
        return at_address[0], None, ""

    by_pmc = [loc for loc in at_address if loc.property_management_company_normalized == property_management_company_normalized]
    if len(by_pmc) == 1:
        return by_pmc[0], None, ""

    if len(by_pmc) > 1:
        by_b = [loc for loc in by_pmc if loc.building_normalized == building_normalized]
        if len(by_b) == 1:
            return by_b[0], None, ""
        detail = (
            f"{n_addr} DB rows at {street_display!r}; {len(by_pmc)} share sheet PMC {company_display!r}; "
            f"{len(by_b)} also match sheet Name {building_display!r}"
        )
        return None, "duplicate", detail

    # PMC matched none of the address duplicates — try building on full address pool.
    by_b = [loc for loc in at_address if loc.building_normalized == building_normalized]
    if len(by_b) == 1:
        return by_b[0], None, ""
    detail = (
        f"{n_addr} DB rows at {street_display!r}; sheet PMC {company_display!r} matched 0 of them; "
        f"building {building_display!r} matched {len(by_b)}"
    )
    if len(by_b) == 0:
        return None, "ambiguous", detail
    return None, "duplicate", detail


def run_import(
    csv_path: Path,
    *,
    dry_run: bool,
    route_number_override: int | None,
    month_date_override: date | None,
    sync_route_meta: bool,
    sync_stop_order: bool,
    update_route_display_name: bool,
    restrict_to_route_id: int | None,
    verbose_locations: bool,
) -> int:
    rows = _read_sheet_rows(csv_path)
    hdr_idx = _find_data_header_row_index(rows)
    parsed_rn, sheet_month, sheet_label = parse_sheet_meta(rows, hdr_idx)
    route_number = route_number_override if route_number_override is not None else parsed_rn
    month_date = month_date_override or sheet_month

    if route_number is None:
        raise SystemExit("Could not determine route number (add ROUTE row or pass --route-number).")
    if month_date is None:
        raise SystemExit("Could not determine month (add DATE row or pass --month-date YYYY-MM-DD).")

    route = MonthlyRoute.query.filter_by(route_number=route_number).one_or_none()
    if route is None:
        raise SystemExit(f"No MonthlyRoute with route_number={route_number}.")

    if restrict_to_route_id is not None and int(restrict_to_route_id) != int(route.id):
        raise SystemExit("--restrict-route-id does not match resolved route from route_number.")

    canonical_index = load_locations_by_canonical_street()
    LOG.info("Built canonical street index (%s distinct street keys).", f"{len(canonical_index):,}")

    reader = _dict_reader_from_slice(rows, hdr_idx)
    issues: list[ImportIssue] = []
    updated_locations = 0
    history_writes = 0
    skipped_no_history = 0
    stop_order_applied = 0
    stop_order_skipped_not_on_sheet_route = 0
    now = datetime.now(timezone.utc)

    for logical_row, raw in enumerate(reader, start=hdr_idx + 2):
        row = _strip_keys(raw)
        num_raw = _normalize_space(row.get("#"))
        if not num_raw or not num_raw.isdigit():
            continue

        addr_block = row.get("Address") or ""
        street, building, company = parse_address_block(addr_block)
        if not street:
            issues.append(ImportIssue("missing_address", logical_row, "empty Address"))
            continue

        cid = _normalize_company(company)
        bid = _normalize_building(building)

        at_address = lookup_locations_for_sheet_street(canonical_index, street)

        loc, match_err, match_detail = resolve_monthly_location_by_sheet_identity(
            at_address=at_address,
            property_management_company_normalized=cid,
            building_normalized=bid,
            street_display=street,
            company_display=company,
            building_display=building,
        )
        if loc is None:
            issues.append(
                ImportIssue(
                    match_err,
                    logical_row,
                    f"{street!r} | mgmt {company!r} | name {building!r} — {match_detail}",
                )
            )
            continue
        if loc.monthly_route_id is not None and int(loc.monthly_route_id) != int(route.id):
            assigned_rn: int | None = None
            mr_assigned = loc.monthly_route
            if mr_assigned is not None:
                assigned_rn = int(mr_assigned.route_number)
            detail_parts = [
                f"location id={loc.id}",
                f"DB address={loc.address!r}",
            ]
            if loc.display_address:
                detail_parts.append(f"DB display_address={loc.display_address!r}")
            if loc.building:
                detail_parts.append(f"DB building={loc.building!r}")
            if loc.property_management_company:
                detail_parts.append(f"DB mgmt={loc.property_management_company!r}")
            detail_parts.append(f"assigned monthly_route_id={loc.monthly_route_id}")
            if assigned_rn is not None:
                detail_parts.append(f"(DB route_number={assigned_rn})")
            detail_parts.append(f"sheet expects route_number={route_number} (route entity id={route.id})")
            detail_parts.append(
                "data still applied; --sync-stop-order updates order only for sites already on this route; "
                "--sync-route-meta assigns every matched row to this route + order"
            )
            issues.append(
                ImportIssue(
                    "route_mismatch",
                    logical_row,
                    "; ".join(detail_parts),
                )
            )

        stop_order = int(num_raw) - 1
        annual = _clean_text(row.get("Annual"))
        ring_detail = _clean_multiline(row.get("Ring"))
        keys_text = _clean_multiline(row.get("Key #"))
        facp_detail = _clean_multiline(row.get("FACP"))
        monitoring_cell = row.get("Monitoring")
        testing_procedures = _clean_multiline(row.get("Testing Procedures"))
        tech_notes = _clean_multiline(row.get("Tech Comments & Notes"))
        time_in = row.get("Time In:") or row.get("Time In")
        time_out = row.get("Time Out:") or row.get("Time Out")

        loc.annual_month = annual
        loc.ring_detail = ring_detail
        loc.keys = keys_text
        loc.facp_detail = facp_detail
        loc.testing_procedures = testing_procedures
        loc.inspection_tech_notes = tech_notes
        loc.updated_at = now

        if _is_monitoring_none(monitoring_cell):
            loc.monitoring_company_id = None
            loc.pending_monitoring_company_proposal_id = None

        if sync_route_meta:
            loc.monthly_route_id = route.id
            loc.route_stop_order = stop_order
            stop_order_applied += 1
        elif sync_stop_order:
            if loc.monthly_route_id is not None and int(loc.monthly_route_id) == int(route.id):
                loc.route_stop_order = stop_order
                stop_order_applied += 1
            else:
                stop_order_skipped_not_on_sheet_route += 1

        sheet_times = analyze_sheet_time_cells(time_in, time_out)
        rs = sheet_times.result_status
        if rs:
            stmt = insert(MonthlyRouteTestHistory).values(
                location_id=loc.id,
                month_date=month_date,
                result_status=rs,
                skip_reason=sheet_times.skip_reason,
                source_value_raw=sheet_times.source_value_raw,
                testing_procedures=testing_procedures,
                inspection_tech_notes=tech_notes,
                sheet_time_in_raw=_clean_text(time_in),
                sheet_time_out_raw=_clean_text(time_out),
                test_monthly_route_id=route.id,
                session_route_stop_order=stop_order,
                updated_at=now,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_monthly_route_test_history_location_month",
                set_={
                    "result_status": stmt.excluded.result_status,
                    "skip_reason": stmt.excluded.skip_reason,
                    "source_value_raw": stmt.excluded.source_value_raw,
                    "testing_procedures": stmt.excluded.testing_procedures,
                    "inspection_tech_notes": stmt.excluded.inspection_tech_notes,
                    "sheet_time_in_raw": stmt.excluded.sheet_time_in_raw,
                    "sheet_time_out_raw": stmt.excluded.sheet_time_out_raw,
                    "test_monthly_route_id": stmt.excluded.test_monthly_route_id,
                    "session_route_stop_order": stmt.excluded.session_route_stop_order,
                    "updated_at": stmt.excluded.updated_at,
                },
            )
            db.session.execute(stmt)
            history_writes += 1
        else:
            skipped_no_history += 1

        updated_locations += 1
        if verbose_locations:
            LOG.info("OK row %s -> location_id=%s", logical_row, loc.id)

    if update_route_display_name and sheet_label:
        route.display_name = sheet_label[:255]
        route.updated_at = now

    print(
        f"[inspection-csv] route_number={route_number} route_id={route.id} month_date={month_date.isoformat()} "
        f"locations_updated={updated_locations} history_upserts={history_writes} "
        f"rows_without_history_signal={skipped_no_history} issues={len(issues)}",
        flush=True,
    )
    if sync_route_meta or sync_stop_order:
        print(
            f"[inspection-csv] stop_order: applied_to_rows={stop_order_applied} "
            f"skipped_not_on_sheet_route_or_unassigned={stop_order_skipped_not_on_sheet_route}",
            flush=True,
        )
    for issue in issues[:50]:
        print(f"  [{issue.kind}] csv_row≈{issue.csv_row}: {issue.detail}", flush=True)
    if len(issues) > 50:
        print(f"  ... and {len(issues) - 50} more issues", flush=True)

    if dry_run:
        db.session.rollback()
        print("[inspection-csv] Rolled back (dry-run).", flush=True)
    else:
        db.session.commit()
        print("[inspection-csv] Committed.", flush=True)

    fatal_kinds = frozenset({"missing_address", "unmatched", "ambiguous", "duplicate"})
    fatal = [i for i in issues if i.kind in fatal_kinds]
    if fatal:
        print(f"[inspection-csv] Non-zero exit: {len(fatal)} fatal row issue(s).", flush=True)
        return 1
    if issues:
        print(f"[inspection-csv] Completed with {len(issues)} warning(s) (route_mismatch / ...).", flush=True)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="Path to inspection CSV")
    parser.add_argument("--dry-run", action="store_true", help="Parse and validate; roll back DB changes")
    parser.add_argument("--commit", action="store_true", help="Commit changes (omit for dry-run unless --dry-run set)")
    parser.add_argument("--route-number", type=int, default=None, help="Override route number from preamble")
    parser.add_argument(
        "--month-date",
        type=str,
        default=None,
        help="Override sheet month as YYYY-MM-DD (first of month)",
    )
    parser.add_argument(
        "--sync-route-meta",
        action="store_true",
        help="Assign monthly_route_id to this sheet route for every matched row and set route_stop_order from #",
    )
    parser.add_argument(
        "--sync-stop-order",
        action="store_true",
        help=(
            "Set route_stop_order from # only when the location is already on this sheet route "
            "(does not change monthly_route_id — use when some sheet rows moved to other routes)"
        ),
    )
    parser.add_argument(
        "--update-route-display-name",
        action="store_true",
        help="Set MonthlyRoute.display_name from the sheet label column (e.g. Pac Pro 1)",
    )
    parser.add_argument(
        "--restrict-route-id",
        type=int,
        default=None,
        help="Safety check: abort unless resolved route matches this id",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    md_override = None
    if args.month_date:
        md_override = date.fromisoformat(args.month_date)

    dry_run = args.dry_run or not args.commit

    _configure_logging(args.verbose)
    app = create_app()
    with app.app_context():
        code = run_import(
            args.csv,
            dry_run=dry_run,
            route_number_override=args.route_number,
            month_date_override=md_override,
            sync_route_meta=args.sync_route_meta,
            sync_stop_order=args.sync_stop_order,
            update_route_display_name=args.update_route_display_name,
            restrict_to_route_id=args.restrict_route_id,
            verbose_locations=args.verbose,
        )
    raise SystemExit(code)


if __name__ == "__main__":
    main()
