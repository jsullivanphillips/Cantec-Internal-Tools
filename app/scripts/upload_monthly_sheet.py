from __future__ import annotations

import argparse
import csv
import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from app import create_app, db
from app.db_models import MonthlyLocation, MonthlyLocationMonth
from app.monthly.key_resolve import keycode_cf_to_key_id_map, resolve_key_id_for_monthly_fields
from app.monthly.location_identity import normalize_address, normalize_label, normalize_pmc
from app.monthly.route_inspection_csv_import import (
    load_locations_by_canonical_street,
    lookup_locations_for_sheet_street,
    parse_address_block,
    resolve_monthly_location_by_sheet_identity,
)
from app.monthly.route_sync import sync_monthly_route_fk_for_location

LOG = logging.getLogger("upload_monthly_sheet")

# Emit CLI progress every N locations so long runs do not look stalled.
PROGRESS_EVERY_N_LOCATIONS = 25


@dataclass
class RowConflict:
    address: str
    first_row_number: int
    replacement_row_number: int


@dataclass
class MissingReasonLog:
    address: str
    month_date: date
    row_number: int


@dataclass
class SkipReasonOverride:
    address: str
    property_management_company: str | None
    building: str | None  # legacy CSV column name; stored as location label
    month_date: date
    skip_reason: str
    source_row_number: int


def _configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


def _normalize_space(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def _normalize_building(value: str | None) -> str:
    """Legacy alias: sheet NOTES column maps to location label."""
    return normalize_label(value)


def _normalize_address(value: str | None) -> str:
    return normalize_address(value)


def _normalize_company(value: str | None) -> str:
    return normalize_pmc(value)


def _normalize_status(value: str | None) -> str:
    raw = _normalize_space(value).upper()
    if raw == "ACTIVE":
        return "active"
    if raw == "CANCELLED":
        return "cancelled"
    if raw == "ON HOLD":
        return "on_hold"
    return "unknown"


def _parse_price(value: str | None) -> Decimal | None:
    text = _normalize_space(value).replace("$", "").replace(",", "")
    if not text or text == "-":
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


# Month/year tokens from master sheet headers (``Jan-26``) or Excel exports (``26-Jan``).
_MONTH_YEAR_TOKEN_FORMATS = ("%b-%y", "%B-%y", "%y-%b", "%y-%B")


def _parse_month_year_token(text: str) -> date | None:
    """Parse ``Mon-YY`` or ``YY-Mon`` (abbreviated or full month name) to first-of-month."""
    for fmt in _MONTH_YEAR_TOKEN_FORMATS:
        try:
            parsed = datetime.strptime(text, fmt)
            return date(parsed.year, parsed.month, 1)
        except ValueError:
            continue
    return None


def _parse_start_up_date(value: str | None) -> date | None:
    text = _normalize_space(value)
    if not text or text == "-":
        return None
    return _parse_month_year_token(text)


def _parse_month_header(header: str) -> date | None:
    text = _normalize_space(header)
    if not text:
        return None
    return _parse_month_year_token(text)


def _clean_barcode(value: str | None) -> str | None:
    text = _normalize_space(value)
    if not text or text == "-":
        return None
    return text


def _clean_text(value: str | None) -> str | None:
    text = _normalize_space(value)
    return text or None


def _derive_month_result(cell_value: str | None) -> tuple[str | None, str | None]:
    """
    Returns (result_status, skip_reason).
    None result_status means do not create a history row.
    """
    value = _normalize_space(cell_value).upper()
    if not value or value == "-":
        return None, None
    if value == "Y":
        return "tested", None
    if value == "ANNUAL":
        return "skipped", "annual"
    if value == "X":
        return "skipped", None
    return None, None


def _load_skip_reason_overrides(skip_reasons_csv_path: Path | None) -> dict[tuple[str, str, str, date], SkipReasonOverride]:
    overrides: dict[tuple[str, str, str, date], SkipReasonOverride] = {}
    if not skip_reasons_csv_path:
        return overrides
    if not skip_reasons_csv_path.exists():
        raise SystemExit(f"Skip-reasons CSV file not found: {skip_reasons_csv_path}")

    with skip_reasons_csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"address", "month_date", "skip_reason"}
        columns = set(reader.fieldnames or [])
        missing = required - columns
        if missing:
            raise SystemExit(
                f"Skip-reasons CSV is missing required column(s): {', '.join(sorted(missing))}"
            )

        loaded = 0
        for row_number, row in enumerate(reader, start=2):
            address = _normalize_space(row.get("address"))
            company = _normalize_space(row.get("property_management_company"))
            building = _normalize_space(row.get("building"))
            reason = _normalize_space(row.get("skip_reason"))
            month_raw = _normalize_space(row.get("month_date"))
            if not address or not reason or not month_raw:
                continue
            try:
                month_date = date.fromisoformat(month_raw)
            except ValueError:
                LOG.warning(
                    "Skipping invalid skip-reason row %s (month_date must be YYYY-MM-DD): %s",
                    row_number,
                    month_raw,
                )
                continue

            key = (
                _normalize_address(address),
                _normalize_company(company),
                _normalize_building(building),
                month_date,
            )
            overrides[key] = SkipReasonOverride(
                address=address,
                property_management_company=company or None,
                building=building or None,
                month_date=month_date,
                skip_reason=reason,
                source_row_number=row_number,
            )
            loaded += 1

    print(
        f"[monthly-sheet] Loaded {loaded} skip-reason override row(s) from {skip_reasons_csv_path}.",
        flush=True,
    )
    return overrides


def _write_csv(path: Path, headers: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def _load_duplicate_row_numbers(duplicates_csv_path: Path | None) -> set[int]:
    if not duplicates_csv_path:
        return set()
    if not duplicates_csv_path.exists():
        raise SystemExit(f"Duplicate-conflicts CSV file not found: {duplicates_csv_path}")

    row_numbers: set[int] = set()
    with duplicates_csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if "replacement_row_number" not in (reader.fieldnames or []):
            raise SystemExit(
                "Duplicate-conflicts CSV is missing required column: replacement_row_number"
            )
        for row in reader:
            raw = _normalize_space(row.get("replacement_row_number"))
            if not raw:
                continue
            try:
                row_numbers.add(int(raw))
            except ValueError:
                continue
    print(
        f"[monthly-sheet] Loaded {len(row_numbers)} duplicate row number(s) from {duplicates_csv_path}.",
        flush=True,
    )
    return row_numbers


def _collect_rows(csv_path: Path) -> tuple[list[dict[str, str]], list[RowConflict], list[date]]:
    with csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        all_rows = list(reader)
        headers = reader.fieldnames or []

    month_columns: list[tuple[str, date]] = []
    for header in headers:
        parsed = _parse_month_header(header)
        if parsed:
            month_columns.append((header, parsed))

    if not month_columns:
        raise ValueError("No month columns were detected in CSV headers.")

    deduped: dict[str, dict[str, str]] = {}
    dedupe_row_numbers: dict[str, int] = {}
    conflicts: list[RowConflict] = []

    for idx, row in enumerate(all_rows, start=2):  # data starts on row 2 in CSV
        key = _normalize_address(row.get("ADDRESS"))
        if not key:
            continue
        if key in deduped:
            conflicts.append(
                RowConflict(
                    address=row.get("ADDRESS", "").strip(),
                    first_row_number=dedupe_row_numbers[key],
                    replacement_row_number=idx,
                )
            )
        deduped[key] = row
        dedupe_row_numbers[key] = idx

    return list(deduped.values()), conflicts, [m[1] for m in month_columns]


def _upsert_location(
    row: dict[str, str],
    *,
    keycode_cf_index: dict[str, int],
) -> int:
    now = datetime.now(timezone.utc)
    barcode = _clean_barcode(row.get("BARCODE #"))
    keys_text = _clean_text(row.get("KEYS"))
    key_id = resolve_key_id_for_monthly_fields(
        barcode,
        keys_text,
        keycode_cf_index=keycode_cf_index,
    )
    street, building_from_block, mgmt_in_block = parse_address_block(row.get("ADDRESS"))
    address_line = street or _normalize_space(row.get("ADDRESS"))
    building_name = _clean_text(building_from_block)
    pmc_raw = _clean_text(row.get("PROPERTY MANAGEMENT COMPANY")) or _clean_text(mgmt_in_block)
    label = _clean_text(row.get("NOTES")) or address_line
    payload = {
        "address": address_line,
        "address_normalized": _normalize_address(address_line),
        "label": label,
        "label_normalized": _normalize_building(row.get("NOTES")) or _normalize_address(address_line),
        "building_name": building_name,
        "property_management_company": pmc_raw,
        "property_management_company_normalized": _normalize_company(pmc_raw),
        "notes": _clean_text(row.get("NOTES")),
        "barcode": barcode,
        "price_per_month": _parse_price(row.get("Price/month")),
        "area": _clean_text(row.get("Area")),
        "start_up_date": _parse_start_up_date(row.get("start up date")),
        "status_normalized": _normalize_status(row.get("STATUS- (ACTIVE, CANCELLED, ON HOLD)")),
        "status_raw": _clean_text(row.get("STATUS- (ACTIVE, CANCELLED, ON HOLD)")),
        "keys": keys_text,
        "test_day": _clean_text(row.get("TEST DAY")),
        "annual_month": _clean_text(row.get("ANNUAL")),
        "key_id": key_id,
        "updated_at": now,
    }

    stmt = insert(MonthlyLocation).values(**payload)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_monthly_location_address_pmc_label_normalized",
        set_={
            "address": stmt.excluded.address,
            "label": stmt.excluded.label,
            "label_normalized": stmt.excluded.label_normalized,
            "building_name": stmt.excluded.building_name,
            "property_management_company": stmt.excluded.property_management_company,
            "property_management_company_normalized": stmt.excluded.property_management_company_normalized,
            "notes": stmt.excluded.notes,
            "barcode": stmt.excluded.barcode,
            "price_per_month": stmt.excluded.price_per_month,
            "area": stmt.excluded.area,
            "start_up_date": stmt.excluded.start_up_date,
            "status_normalized": stmt.excluded.status_normalized,
            "status_raw": stmt.excluded.status_raw,
            "keys": stmt.excluded["keys"],
            "test_day": stmt.excluded.test_day,
            "annual_month": stmt.excluded.annual_month,
            "key_id": stmt.excluded.key_id,
            "updated_at": stmt.excluded.updated_at,
        },
    ).returning(MonthlyLocation.id)
    return int(db.session.execute(stmt).scalar_one())


def _upsert_history(
    location_id: int,
    month_date: date,
    result_status: str,
    skip_reason: str | None,
    source_value_raw: str | None,
    *,
    test_monthly_route_id: int | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    stmt = insert(MonthlyLocationMonth).values(
        monthly_location_id=location_id,
        month_date=month_date,
        result_status=result_status,
        skip_reason=skip_reason,
        source_value_raw=source_value_raw,
        testing_procedures=None,
        inspection_tech_notes=None,
        test_monthly_route_id=test_monthly_route_id,
        updated_at=now,
    )
    set_: dict[str, object] = {
        "result_status": stmt.excluded.result_status,
        "skip_reason": stmt.excluded.skip_reason,
        "source_value_raw": stmt.excluded.source_value_raw,
        "updated_at": stmt.excluded.updated_at,
    }
    if test_monthly_route_id is not None:
        set_["test_monthly_route_id"] = stmt.excluded.test_monthly_route_id
    stmt = stmt.on_conflict_do_update(
        constraint="uq_mlm_location_month",
        set_=set_,
    )
    db.session.execute(stmt)


def _sheet_row_identity(row: dict[str, str]) -> tuple[str, str, str, str]:
    """Parsed master-sheet identity: address_norm, pmc_norm, label_norm, street_display."""
    street, _, mgmt_in_block = parse_address_block(row.get("ADDRESS"))
    address_line = street or _normalize_space(row.get("ADDRESS"))
    pmc_raw = _clean_text(row.get("PROPERTY MANAGEMENT COMPANY")) or mgmt_in_block
    notes_raw = _clean_text(row.get("NOTES"))
    aid = _normalize_address(address_line)
    cid = _normalize_company(pmc_raw)
    lid = _normalize_building(notes_raw) or _normalize_building(address_line) or aid
    return aid, cid, lid, address_line


def _resolve_location_id_for_history_row(row: dict[str, str]) -> tuple[int | None, str | None]:
    """
    Resolve ``MonthlyLocation.id`` using normalized address + PMC + label (NOTES column).

    Returns (location_id, None) on success, or (None, 'missing'/'ambiguous').
    """
    aid, cid, lid, _street_display = _sheet_row_identity(row)
    if not aid:
        return None, "missing"

    location_ids = db.session.execute(
        select(MonthlyLocation.id).where(
            MonthlyLocation.address_normalized == aid,
            MonthlyLocation.property_management_company_normalized == cid,
            MonthlyLocation.label_normalized == lid,
        )
    ).scalars().all()

    if len(location_ids) == 1:
        return int(location_ids[0]), None
    if not location_ids:
        return None, "missing"
    return None, "ambiguous"


def _resolve_location_id_for_status_routes_row(
    row: dict[str, str],
    *,
    canonical_index: dict[str, list[MonthlyLocation]] | None = None,
) -> tuple[int | None, str | None, str | None]:
    """
    Resolve an existing ``MonthlyLocation.id`` for status/route sync rows.

    Tries strict address + PMC + label, then street-label + PMC, address + PMC,
    and finally canonical street + PMC when technician-sheet addressing differs
    from the library navigation address.
    """
    aid, cid, lid, street_display = _sheet_row_identity(row)
    street_label = _normalize_building(street_display)

    strict_id, strict_err = _resolve_location_id_for_history_row(row)
    if strict_err is None:
        return strict_id, None, "address_pmc_label"
    if strict_err == "ambiguous":
        return None, strict_err, None

    if street_label and cid:
        location_ids = db.session.execute(
            select(MonthlyLocation.id).where(
                MonthlyLocation.label_normalized == street_label,
                MonthlyLocation.property_management_company_normalized == cid,
            )
        ).scalars().all()
        if len(location_ids) == 1:
            return int(location_ids[0]), None, "street_label_pmc"
        if len(location_ids) > 1:
            return None, "ambiguous", None

    if aid and cid:
        location_ids = db.session.execute(
            select(MonthlyLocation.id).where(
                MonthlyLocation.address_normalized == aid,
                MonthlyLocation.property_management_company_normalized == cid,
            )
        ).scalars().all()
        if len(location_ids) == 1:
            return int(location_ids[0]), None, "address_pmc"
        if len(location_ids) > 1:
            return None, "ambiguous", None

    if canonical_index is not None and street_display and cid:
        at_address = lookup_locations_for_sheet_street(canonical_index, street_display)
        if at_address:
            loc, match_err, _detail = resolve_monthly_location_by_sheet_identity(
                at_address=at_address,
                property_management_company_normalized=cid,
                label_normalized=street_label or lid,
                street_display=street_display,
                company_display=_clean_text(row.get("PROPERTY MANAGEMENT COMPANY")),
                label_display=street_display,
                match_basis="street",
                sheet_building_key="",
            )
            if loc is not None:
                return int(loc.id), None, "canonical_street_pmc"
            if match_err == "ambiguous":
                return None, "ambiguous", None

    return None, "missing", None


def _status_and_test_day_from_row(row: dict[str, str]) -> tuple[str, str | None, str | None]:
    status_raw = _clean_text(row.get("STATUS- (ACTIVE, CANCELLED, ON HOLD)"))
    return (
        _normalize_status(row.get("STATUS- (ACTIVE, CANCELLED, ON HOLD)")),
        status_raw,
        _clean_text(row.get("TEST DAY")),
    )


def _apply_status_and_routes_update(
    loc: MonthlyLocation,
    row: dict[str, str],
) -> tuple[bool, str | None]:
    """Update only status + TEST DAY, then sync ``monthly_route_id`` when TEST DAY changed."""
    new_status_normalized, new_status_raw, new_test_day = _status_and_test_day_from_row(row)
    changed = False
    if loc.status_normalized != new_status_normalized:
        loc.status_normalized = new_status_normalized
        changed = True
    if (loc.status_raw or None) != new_status_raw:
        loc.status_raw = new_status_raw
        changed = True

    test_day_changed = (loc.test_day or None) != new_test_day
    if test_day_changed:
        loc.test_day = new_test_day
        changed = True

    route_error: str | None = None
    if test_day_changed:
        try:
            sync_monthly_route_fk_for_location(loc)
        except ValueError as exc:
            route_error = str(exc)
    return changed, route_error


def _apply_overrides_only(
    skip_reason_overrides: dict[tuple[str, str, str, date], SkipReasonOverride],
    dry_run: bool,
) -> None:
    print("[monthly-sheet] Running in overrides-only mode.", flush=True)
    if not skip_reason_overrides:
        print("[monthly-sheet] No overrides loaded; nothing to do.", flush=True)
        return

    updated = 0
    missing_locations: list[dict[str, Any]] = []

    override_items = list(skip_reason_overrides.items())
    total = len(override_items)

    ambiguous_locations: list[dict[str, Any]] = []

    for idx, ((address_normalized, company_normalized, label_normalized, month_date), override) in enumerate(override_items, start=1):
        if label_normalized:
            location_ids = db.session.execute(
                select(MonthlyLocation.id).where(
                    MonthlyLocation.address_normalized == address_normalized,
                    MonthlyLocation.property_management_company_normalized == company_normalized,
                    MonthlyLocation.label_normalized == label_normalized,
                )
            ).scalars().all()
        elif company_normalized:
            location_ids = db.session.execute(
                select(MonthlyLocation.id).where(
                    MonthlyLocation.address_normalized == address_normalized,
                    MonthlyLocation.property_management_company_normalized == company_normalized,
                )
            ).scalars().all()
        else:
            location_ids = db.session.execute(
                select(MonthlyLocation.id).where(
                    MonthlyLocation.address_normalized == address_normalized
                )
            ).scalars().all()

        if not location_ids:
            missing_locations.append(
                {
                    "address": override.address,
                    "property_management_company": override.property_management_company or "",
                    "building": override.building or "",
                    "month_date": override.month_date.isoformat(),
                    "skip_reason": override.skip_reason,
                    "source_row_number": override.source_row_number,
                }
            )
            continue
        if len(location_ids) > 1:
            ambiguous_locations.append(
                {
                    "address": override.address,
                    "property_management_company": override.property_management_company or "",
                    "building": override.building or "",
                    "month_date": override.month_date.isoformat(),
                    "skip_reason": override.skip_reason,
                    "source_row_number": override.source_row_number,
                }
            )
            continue
        location_id = location_ids[0]

        _upsert_history(
            location_id=location_id,
            month_date=month_date,
            result_status="skipped",
            skip_reason=override.skip_reason,
            source_value_raw="OVERRIDE_ONLY",
        )
        updated += 1

        if idx == 1 or idx == total or idx % PROGRESS_EVERY_N_LOCATIONS == 0:
            pct = (100 * idx // total) if total else 100
            print(
                f"[monthly-sheet] Override progress: {idx}/{total} ({pct}%) — updated: {updated}",
                flush=True,
            )

    logs_dir = Path("logs")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if missing_locations:
        _write_csv(
            logs_dir / f"monthly_sheet_override_missing_locations_{timestamp}.csv",
            ["address", "property_management_company", "building", "month_date", "skip_reason", "source_row_number"],
            missing_locations,
        )
    if ambiguous_locations:
        _write_csv(
            logs_dir / f"monthly_sheet_override_ambiguous_locations_{timestamp}.csv",
            ["address", "property_management_company", "building", "month_date", "skip_reason", "source_row_number"],
            ambiguous_locations,
        )

    if dry_run:
        db.session.rollback()
        print("[monthly-sheet] Rolled back (dry-run); database unchanged.", flush=True)
    else:
        db.session.commit()
        print("[monthly-sheet] Changes committed.", flush=True)

    print(
        "[monthly-sheet] Overrides-only summary — "
        f"loaded: {len(skip_reason_overrides)}, "
        f"updated: {updated}, "
        f"missing_locations: {len(missing_locations)}, "
        f"ambiguous_locations: {len(ambiguous_locations)}",
        flush=True,
    )


def _remap_existing_skip_reasons() -> tuple[int, int]:
    """
    Re-applies preserved skip reasons from migration backup table to current rows.
    DB precedence is enforced: existing non-empty skip_reason is never overwritten.
    Returns (applied_count, unmatched_count).
    """
    rows = db.session.execute(
        text(
            """
            SELECT
                b.address_normalized,
                b.property_management_company_normalized,
                b.month_date,
                b.skip_reason
            FROM monthly_route_history_reason_backup b
            WHERE b.result_status = 'skipped'
              AND coalesce(trim(b.skip_reason), '') <> ''
            """
        )
    ).mappings().all()

    applied = 0
    unmatched = 0
    for row in rows:
        location_ids = db.session.execute(
            select(MonthlyLocation.id).where(
                MonthlyLocation.address_normalized == row["address_normalized"],
                MonthlyLocation.property_management_company_normalized == row["property_management_company_normalized"],
                MonthlyLocation.label_normalized == _normalize_building(row.get("building", "")),
            )
        ).scalars().all()

        if not location_ids:
            # Backward compatibility with backups that predate label_normalized.
            location_ids = db.session.execute(
                select(MonthlyLocation.id).where(
                    MonthlyLocation.address_normalized == row["address_normalized"],
                    MonthlyLocation.property_management_company_normalized == row["property_management_company_normalized"],
                )
            ).scalars().all()

        if len(location_ids) != 1:
            unmatched += 1
            continue
        location_id = location_ids[0]

        existing = db.session.execute(
            select(MonthlyLocationMonth).where(
                MonthlyLocationMonth.monthly_location_id == location_id,
                MonthlyLocationMonth.month_date == row["month_date"],
            )
        ).scalar_one_or_none()
        if existing is None:
            _upsert_history(
                location_id=location_id,
                month_date=row["month_date"],
                result_status="skipped",
                skip_reason=row["skip_reason"],
                source_value_raw="MIGRATED_BACKUP",
            )
            applied += 1
            continue
        if existing.skip_reason and existing.skip_reason.strip():
            continue
        _upsert_history(
            location_id=location_id,
            month_date=row["month_date"],
            result_status=existing.result_status or "skipped",
            skip_reason=row["skip_reason"],
            source_value_raw=existing.source_value_raw or "MIGRATED_BACKUP",
        )
        applied += 1
    return applied, unmatched


def run_upload(
    csv_path: Path,
    dry_run: bool = True,
    skip_reasons_csv_path: Path | None = None,
    overrides_only: bool = False,
    duplicates_only: bool = False,
    duplicates_csv_path: Path | None = None,
    history_only: bool = False,
    locations_only: bool = False,
    status_and_routes_only: bool = False,
    month_years: frozenset[int] | None = None,
) -> None:
    if history_only and locations_only:
        raise ValueError("Cannot use history_only and locations_only together.")
    if status_and_routes_only and (history_only or locations_only):
        raise ValueError("Cannot combine --status-and-routes-only with --history-only or --locations-only.")
    mode = "dry-run (no DB commit)" if dry_run else "commit"
    print(f"[monthly-sheet] Starting upload ({mode}) …", flush=True)
    print(f"[monthly-sheet] Reading CSV: {csv_path}", flush=True)
    if skip_reasons_csv_path:
        print(f"[monthly-sheet] Reading skip-reason overrides: {skip_reasons_csv_path}", flush=True)
    skip_reason_overrides = _load_skip_reason_overrides(skip_reasons_csv_path)
    duplicate_row_numbers = _load_duplicate_row_numbers(duplicates_csv_path)
    used_override_keys: set[tuple[str, str, str, date]] = set()
    if overrides_only:
        _apply_overrides_only(skip_reason_overrides=skip_reason_overrides, dry_run=dry_run)
        return

    with csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        rows = list(reader)

    print(f"[monthly-sheet] Parsed {len(rows)} data rows from file.", flush=True)

    month_columns: list[tuple[str, date]] = []
    if not locations_only and not status_and_routes_only:
        for header in headers:
            parsed = _parse_month_header(header)
            if parsed:
                month_columns.append((header, parsed))
        if not month_columns:
            raise ValueError("No month columns were detected in CSV headers.")

        print(
            f"[monthly-sheet] Found {len(month_columns)} month column(s): "
            f"{', '.join(h for h, _ in month_columns)}",
            flush=True,
        )

        if month_years:
            before_filter = len(month_columns)
            month_columns = [(h, d) for h, d in month_columns if d.year in month_years]
            if not month_columns:
                raise ValueError(
                    f"No month columns left after --months-year filter "
                    f"{sorted(month_years)!r} (CSV had {before_filter} month column(s))."
                )
            print(
                f"[monthly-sheet] After year filter {sorted(month_years)}: "
                f"{len(month_columns)} month column(s): "
                f"{', '.join(h for h, _ in month_columns)}",
                flush=True,
            )
    else:
        if status_and_routes_only:
            print(
                "[monthly-sheet] Status-and-routes-only mode: updating STATUS and TEST DAY only; "
                "skipping month columns and all other library fields.",
                flush=True,
            )
        else:
            print(
                "[monthly-sheet] Locations-only mode: skipping month columns and test history import.",
                flush=True,
            )

    deduped: dict[str, tuple[dict[str, str], int]] = {}
    conflicts: list[RowConflict] = []

    for row_number, row in enumerate(rows, start=2):
        if not _normalize_address(row.get("ADDRESS")):
            continue
        key = (
            _normalize_address(row.get("ADDRESS")),
            _normalize_company(row.get("PROPERTY MANAGEMENT COMPANY")),
            _normalize_building(row.get("NOTES")),
        )
        if key in deduped:
            conflicts.append(
                RowConflict(
                    address=f"{_normalize_space(row.get('ADDRESS'))} | {_normalize_space(row.get('PROPERTY MANAGEMENT COMPANY'))}",
                    first_row_number=deduped[key][1],
                    replacement_row_number=row_number,
                )
            )
        deduped[key] = (row, row_number)

    print(
        f"[monthly-sheet] After address dedupe: {len(deduped)} unique location(s); "
        f"{len(conflicts)} duplicate-address conflict(s) in file.",
        flush=True,
    )
    print(
        "[monthly-sheet] "
        + (
            "Resolving existing locations and upserting monthly history only (no location upserts) …"
            if history_only
            else "Updating STATUS and TEST DAY only (route FK sync when TEST DAY changes) …"
            if status_and_routes_only
            else "Upserting library locations only (no test history) …"
            if locations_only
            else "Upserting locations and monthly history (this may take a minute) …"
        ),
        flush=True,
    )

    missing_reason_logs: list[MissingReasonLog] = []
    invalid_rows: list[dict[str, Any]] = []
    history_missing_locations: list[dict[str, Any]] = []
    history_ambiguous_locations: list[dict[str, Any]] = []
    status_routes_rows: list[dict[str, Any]] = []
    location_upserts = 0
    history_upserts = 0
    status_routes_updated = 0
    status_routes_unchanged = 0
    status_routes_missing = 0
    status_routes_ambiguous = 0
    status_routes_route_errors = 0
    override_forced_history_rows = 0

    deduped_items = list(deduped.values())
    if duplicates_only:
        deduped_items = [item for item in deduped_items if item[1] in duplicate_row_numbers]
        print(
            f"[monthly-sheet] Duplicates-only mode: {len(deduped_items)} location row(s) selected for update.",
            flush=True,
        )
    total_locations = len(deduped_items)

    canonical_street_index: dict[str, list[MonthlyLocation]] | None = None
    if status_and_routes_only:
        canonical_street_index = load_locations_by_canonical_street()
        print(
            f"[monthly-sheet] Loaded canonical street index "
            f"({len(canonical_street_index)} key(s)) for fallback matching.",
            flush=True,
        )

    keycode_cf_index: dict[str, int] = {}
    if not history_only and not status_and_routes_only:
        keycode_cf_index = keycode_cf_to_key_id_map()
        print(
            f"[monthly-sheet] Loaded {len(keycode_cf_index)} keycode index entr(y/ies) for key_id resolution.",
            flush=True,
        )

    for idx, (row, row_number) in enumerate(deduped_items, start=1):
        address = _normalize_space(row.get("ADDRESS"))
        normalized_address = _normalize_address(row.get("ADDRESS"))
        normalized_company = _normalize_company(row.get("PROPERTY MANAGEMENT COMPANY"))
        normalized_building = _normalize_building(row.get("NOTES"))
        if not address or not normalized_address:
            invalid_rows.append(
                {
                    "row_number": row_number,
                    "reason": "missing_address",
                    "address": row.get("ADDRESS", ""),
                }
            )
            continue

        if status_and_routes_only:
            resolved_id, resolve_err, match_mode = _resolve_location_id_for_status_routes_row(
                row,
                canonical_index=canonical_street_index,
            )
            row_result: dict[str, Any] = {
                "row_number": row_number,
                "location_id": resolved_id,
                "address": address,
                "property_management_company": _normalize_space(row.get("PROPERTY MANAGEMENT COMPANY")),
                "label": _normalize_space(row.get("NOTES")),
                "match_mode": match_mode,
                "old_status_normalized": None,
                "new_status_normalized": None,
                "old_test_day": None,
                "new_test_day": _clean_text(row.get("TEST DAY")),
                "old_route_id": None,
                "new_route_id": None,
                "status": "",
                "detail": None,
            }
            if resolve_err == "missing":
                row_result["status"] = "missing"
                status_routes_missing += 1
                status_routes_rows.append(row_result)
                continue
            if resolve_err == "ambiguous":
                row_result["status"] = "ambiguous"
                status_routes_ambiguous += 1
                status_routes_rows.append(row_result)
                continue

            loc = db.session.get(MonthlyLocation, int(resolved_id))
            if loc is None:
                row_result["status"] = "missing"
                row_result["detail"] = "location_row_deleted"
                status_routes_missing += 1
                status_routes_rows.append(row_result)
                continue

            row_result["location_id"] = int(loc.id)
            row_result["old_status_normalized"] = loc.status_normalized
            row_result["old_test_day"] = loc.test_day
            row_result["old_route_id"] = loc.monthly_route_id
            new_status_normalized, _, new_test_day = _status_and_test_day_from_row(row)
            row_result["new_status_normalized"] = new_status_normalized

            changed, route_error = _apply_status_and_routes_update(loc, row)
            row_result["new_route_id"] = loc.monthly_route_id
            if route_error:
                row_result["status"] = "route_error"
                row_result["detail"] = route_error
                status_routes_route_errors += 1
            elif changed:
                row_result["status"] = "updated"
                status_routes_updated += 1
            else:
                row_result["status"] = "unchanged"
                status_routes_unchanged += 1
            status_routes_rows.append(row_result)
        elif history_only:
            resolved_id, resolve_err = _resolve_location_id_for_history_row(row)
            if resolve_err == "missing":
                history_missing_locations.append(
                    {
                        "row_number": row_number,
                        "address": address,
                        "property_management_company": _normalize_space(row.get("PROPERTY MANAGEMENT COMPANY")),
                        "building": _normalize_space(row.get("NOTES")),
                    }
                )
                continue
            if resolve_err == "ambiguous":
                history_ambiguous_locations.append(
                    {
                        "row_number": row_number,
                        "address": address,
                        "property_management_company": _normalize_space(row.get("PROPERTY MANAGEMENT COMPANY")),
                        "building": _normalize_space(row.get("NOTES")),
                    }
                )
                continue
            location_id = resolved_id
        else:
            location_id = _upsert_location(row, keycode_cf_index=keycode_cf_index)
            location_upserts += 1

        if status_and_routes_only:
            if idx == 1 or idx == total_locations or idx % PROGRESS_EVERY_N_LOCATIONS == 0:
                pct = (100 * idx // total_locations) if total_locations else 100
                print(
                    f"[monthly-sheet] Progress: {idx}/{total_locations} locations "
                    f"({pct}%) — status/route rows updated so far: {status_routes_updated}",
                    flush=True,
                )
            continue

        if not locations_only:
            for month_col, month_date in month_columns:
                raw_value = _normalize_space(row.get(month_col))
                result_status, skip_reason = _derive_month_result(raw_value)
                override_key = (normalized_address, normalized_company, normalized_building, month_date)
                override = skip_reason_overrides.get(override_key)

                # If no importable monthly value exists, allow explicit override rows
                # to force a skipped-history record for that address/month.
                if not result_status and override:
                    result_status = "skipped"
                    skip_reason = override.skip_reason
                    used_override_keys.add(override_key)
                    override_forced_history_rows += 1

                if not result_status:
                    continue

                if raw_value.upper() == "X":
                    if override:
                        skip_reason = override.skip_reason
                        used_override_keys.add(override_key)
                    else:
                        missing_reason_logs.append(
                            MissingReasonLog(address=address, month_date=month_date, row_number=row_number)
                        )
                _upsert_history(
                    location_id=location_id,
                    month_date=month_date,
                    result_status=result_status,
                    skip_reason=skip_reason,
                    source_value_raw=raw_value or None,
                )
                history_upserts += 1

        if idx == 1 or idx == total_locations or idx % PROGRESS_EVERY_N_LOCATIONS == 0:
            pct = (100 * idx // total_locations) if total_locations else 100
            print(
                f"[monthly-sheet] Progress: {idx}/{total_locations} locations "
                f"({pct}%) — history rows upserted so far: {history_upserts}",
                flush=True,
            )

    print("[monthly-sheet] Finished DB upserts; writing audit CSVs if needed …", flush=True)

    logs_dir = Path("logs")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    if conflicts:
        _write_csv(
            logs_dir / f"monthly_sheet_address_conflicts_{timestamp}.csv",
            ["address", "first_row_number", "replacement_row_number"],
            [
                {
                    "address": c.address,
                    "first_row_number": c.first_row_number,
                    "replacement_row_number": c.replacement_row_number,
                }
                for c in conflicts
            ],
        )

    if missing_reason_logs:
        _write_csv(
            logs_dir / f"monthly_sheet_missing_skip_reasons_{timestamp}.csv",
            ["address", "month_date", "row_number"],
            [
                {
                    "address": item.address,
                    "month_date": item.month_date.isoformat(),
                    "row_number": item.row_number,
                }
                for item in missing_reason_logs
            ],
        )

    unused_override_keys = set(skip_reason_overrides.keys()) - used_override_keys
    if unused_override_keys:
        _write_csv(
            logs_dir / f"monthly_sheet_unused_skip_reason_overrides_{timestamp}.csv",
            ["address", "property_management_company", "building", "month_date", "skip_reason", "source_row_number"],
            [
                {
                    "address": skip_reason_overrides[key].address,
                    "property_management_company": skip_reason_overrides[key].property_management_company or "",
                    "building": skip_reason_overrides[key].building or "",
                    "month_date": skip_reason_overrides[key].month_date.isoformat(),
                    "skip_reason": skip_reason_overrides[key].skip_reason,
                    "source_row_number": skip_reason_overrides[key].source_row_number,
                }
                for key in sorted(unused_override_keys, key=lambda item: (item[0], item[1], item[2], item[3]))
            ],
        )

    if invalid_rows:
        _write_csv(
            logs_dir / f"monthly_sheet_invalid_rows_{timestamp}.csv",
            ["row_number", "reason", "address"],
            invalid_rows,
        )

    if history_missing_locations:
        _write_csv(
            logs_dir / f"monthly_sheet_history_only_missing_location_{timestamp}.csv",
            ["row_number", "address", "property_management_company", "building"],
            history_missing_locations,
        )
    if history_ambiguous_locations:
        _write_csv(
            logs_dir / f"monthly_sheet_history_only_ambiguous_location_{timestamp}.csv",
            ["row_number", "address", "property_management_company", "building"],
            history_ambiguous_locations,
        )
    if status_routes_rows:
        _write_csv(
            logs_dir / f"monthly_sheet_status_routes_{timestamp}.csv",
            [
                "row_number",
                "location_id",
                "address",
                "property_management_company",
                "label",
                "match_mode",
                "status",
                "detail",
                "old_status_normalized",
                "new_status_normalized",
                "old_test_day",
                "new_test_day",
                "old_route_id",
                "new_route_id",
            ],
            status_routes_rows,
        )

    remap_applied = 0
    remap_unmatched = 0
    if duplicates_only:
        print("[monthly-sheet] Duplicates-only mode: skipping preserved-reason remap pass.", flush=True)
    elif history_only or locations_only or status_and_routes_only:
        print(
            "[monthly-sheet] "
            + (
                "History-only mode: skipping preserved-reason remap pass."
                if history_only
                else "Status-and-routes-only mode: skipping preserved-reason remap pass."
                if status_and_routes_only
                else "Locations-only mode: skipping preserved-reason remap pass."
            ),
            flush=True,
        )
    else:
        print("[monthly-sheet] Running preserved-reason remap pass …", flush=True)
        remap_applied, remap_unmatched = _remap_existing_skip_reasons()
        LOG.info("Preserved skip reasons remapped: %s", remap_applied)
        LOG.info("Preserved skip reasons unmatched: %s", remap_unmatched)

    if dry_run:
        db.session.rollback()
        LOG.info("Dry run complete. No database changes committed.")
        print("[monthly-sheet] Rolled back (dry-run); database unchanged.", flush=True)
    else:
        db.session.commit()
        LOG.info("Upload committed.")
        print("[monthly-sheet] Changes committed.", flush=True)

    LOG.info("Rows processed (deduped by address): %s", len(deduped))
    LOG.info("Location upserts: %s", location_upserts)
    LOG.info("Monthly history upserts: %s", history_upserts)
    LOG.info("Duplicate-address conflicts logged: %s", len(conflicts))
    LOG.info("X-values missing reason logged: %s", len(missing_reason_logs))
    LOG.info("Invalid rows logged: %s", len(invalid_rows))
    LOG.info("Skip-reason overrides loaded: %s", len(skip_reason_overrides))
    LOG.info("Skip-reason overrides used: %s", len(used_override_keys))
    LOG.info("Skip-reason overrides unused: %s", len(unused_override_keys))
    LOG.info("Skip-reason overrides forced rows: %s", override_forced_history_rows)
    LOG.info("History-only missing DB location rows: %s", len(history_missing_locations))
    LOG.info("History-only ambiguous DB location rows: %s", len(history_ambiguous_locations))
    if status_and_routes_only:
        LOG.info("Status/routes updated: %s", status_routes_updated)
        LOG.info("Status/routes unchanged: %s", status_routes_unchanged)
        LOG.info("Status/routes missing: %s", status_routes_missing)
        LOG.info("Status/routes ambiguous: %s", status_routes_ambiguous)
        LOG.info("Status/routes route errors: %s", status_routes_route_errors)

    print(
        "[monthly-sheet] Summary — "
        + (
            f"status/routes updated: {status_routes_updated}, "
            f"unchanged: {status_routes_unchanged}, "
            f"missing: {status_routes_missing}, "
            f"ambiguous: {status_routes_ambiguous}, "
            f"route errors: {status_routes_route_errors}, "
            f"conflicts: {len(conflicts)}, "
            f"invalid: {len(invalid_rows)}"
            if status_and_routes_only
            else f"locations: {location_upserts}, "
            f"history upserts: {history_upserts}, "
            f"conflicts: {len(conflicts)}, "
            f"X pending reasons: {len(missing_reason_logs)}, "
            f"invalid: {len(invalid_rows)}, "
            f"history-only unmatched location: {len(history_missing_locations)}, "
            f"history-only ambiguous location: {len(history_ambiguous_locations)}, "
            f"override used: {len(used_override_keys)}/{len(skip_reason_overrides)}, "
            f"override-forced rows: {override_forced_history_rows}, "
            f"remapped reasons: {remap_applied}, "
            f"unmatched remap: {remap_unmatched}"
        ),
        flush=True,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload MASTER MONTHLY SHEET CSV into monthly route tables.")
    parser.add_argument(
        "--csv-path",
        default="app/MASTER MONTHLY SHEET - Copy.csv",
        help="Path to the monthly sheet CSV file.",
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Persist changes. If omitted, script runs in dry-run mode.",
    )
    parser.add_argument(
        "--skip-reasons-csv",
        default=None,
        help=(
            "Optional CSV with columns: address,month_date,skip_reason "
            "(supports optional property_management_company and building; month_date as YYYY-MM-DD)."
        ),
    )
    parser.add_argument(
        "--overrides-only",
        action="store_true",
        help="Only apply skip-reason overrides; do not process full monthly sheet.",
    )
    parser.add_argument(
        "--duplicates-only",
        action="store_true",
        help="Only process rows listed in duplicate-conflicts CSV replacement_row_number column.",
    )
    parser.add_argument(
        "--duplicates-csv",
        default=None,
        help="Path to duplicate-conflicts CSV (e.g., logs/monthly_sheet_address_conflicts_*.csv).",
    )
    parser.add_argument(
        "--history-only",
        action="store_true",
        help=(
            "Only upsert MonthlyLocationMonth; do not upsert MonthlyLocation "
            "(each CSV row must match an existing location by address/company/building)."
        ),
    )
    parser.add_argument(
        "--locations-only",
        action="store_true",
        help=(
            "Only upsert MonthlyLocation (and v2 testing sites); do not import "
            "month columns or MonthlyLocationMonth from the master sheet."
        ),
    )
    parser.add_argument(
        "--status-and-routes-only",
        action="store_true",
        help=(
            "Only update existing MonthlyLocation STATUS and TEST DAY from the master sheet; "
            "sync monthly_route_id when TEST DAY changes. Does not touch prices, keys, notes, "
            "or month test-history cells."
        ),
    )
    parser.add_argument(
        "--months-year",
        action="append",
        type=int,
        dest="months_years",
        metavar="YEAR",
        help="Only process month columns in this calendar year (repeatable). Example: --months-year 2025",
    )
    return parser.parse_args()


def main() -> None:
    _configure_logging()
    args = parse_args()

    app = create_app()
    csv_path = Path(args.csv_path)
    if not csv_path.exists():
        raise SystemExit(f"CSV file not found: {csv_path}")

    with app.app_context():
        print("[monthly-sheet] App context ready.", flush=True)
        if args.history_only and args.locations_only:
            raise SystemExit("Cannot use --history-only and --locations-only together.")
        if args.status_and_routes_only and (args.history_only or args.locations_only):
            raise SystemExit(
                "Cannot combine --status-and-routes-only with --history-only or --locations-only."
            )
        if args.duplicates_only and not args.duplicates_csv:
            raise SystemExit("--duplicates-only requires --duplicates-csv")
        month_years_arg = frozenset(args.months_years) if args.months_years else None
        run_upload(
            csv_path=csv_path,
            dry_run=not args.commit,
            skip_reasons_csv_path=Path(args.skip_reasons_csv) if args.skip_reasons_csv else None,
            overrides_only=args.overrides_only,
            duplicates_only=args.duplicates_only,
            duplicates_csv_path=Path(args.duplicates_csv) if args.duplicates_csv else None,
            history_only=args.history_only,
            locations_only=args.locations_only,
            status_and_routes_only=args.status_and_routes_only,
            month_years=month_years_arg,
        )
        print("[monthly-sheet] Done.", flush=True)


if __name__ == "__main__":
    main()
