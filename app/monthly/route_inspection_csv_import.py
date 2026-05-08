"""
In-process importer for technician route inspection CSVs.

Parses the per-route, per-month "MONTHLY BELL TESTING" sheet (preamble with
``ROUTE:`` / ``DATE:`` rows, then a ``#, Address|Location Details, …`` data
header). Auto-detects route number and month from the preamble, matches each
row to a ``MonthlyRouteLocation`` via canonical street + PMC + building, and
upserts a per-stop ``MonthlyRouteTestHistory`` row scoped to the resolved
``MonthlyRouteRun``. Snapshot fields (``facp``, ``ring``, ``key_number``,
``annual_month``, ``testing_procedures``, ``inspection_tech_notes``) are
written onto the history row so the run keeps a faithful copy of what was
true at the time, even when the library "current" later changes. Sheet tails
with many blank site rows are trimmed; slash-dual-address and parenthetical
unit-range lines are normalized before street matching.

The CLI in ``app/scripts/import_route_inspection_sheet_csv.py`` is a thin
wrapper over :func:`run_route_inspection_csv_import`. New surfaces (e.g. the
"Upload run from CSV" route detail button) call the same entry point with a
caller-supplied ``MonthlyRouteRun``.
"""

from __future__ import annotations

import csv
import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from io import StringIO
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db_models import (
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteRun,
    MonthlyRouteTestHistory,
    db,
)
from app.monthly.sheet_visit_times import analyze_sheet_time_cells

LOG = logging.getLogger("route_inspection_csv_import")

_MONTH_NAMES: dict[str, int] = {
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


def _normalize_space(value: str | None) -> str:
    return " ".join((value or "").strip().split())


# Tokens anywhere in the street line → canonical lowercase form (Ave/Avenue → avenue).
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

_OMITTABLE_STREET_SUFFIXES = frozenset(
    {
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
    }
)

# Consecutive data rows with ``#`` but empty site column → treat as end of sheet (Excel padding).
_TRAILING_EMPTY_ADDRESS_ROWS = 10

# ``1125 Douglas / (702 Fort)`` → primary ``1125 Douglas``; ``709 (-715) Yates`` → ``709-715 Yates``.
_PAREN_UNIT_RANGE_RE = re.compile(r"\(\s*-?(\d+)\s*\)")

# Spelled-out street ordinals (``Third``) ↔ abbreviated civic forms (``3rd``) after casefold + punctuation split.
_NUMERIC_ORDINAL_TOKEN_RE = re.compile(r"^(\d+)(st|nd|rd|th)$")


def _ordinal_suffix(n: int) -> str:
    if 10 <= (n % 100) <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def _n_to_ordinal_token(n: int) -> str:
    return f"{n}{_ordinal_suffix(n)}"


def _build_compound_street_ordinal_map() -> dict[tuple[str, str], str]:
    tens = (
        ("twenty", 20),
        ("thirty", 30),
        ("forty", 40),
        ("fifty", 50),
        ("sixty", 60),
        ("seventy", 70),
        ("eighty", 80),
        ("ninety", 90),
    )
    ones = (
        ("first", 1),
        ("second", 2),
        ("third", 3),
        ("fourth", 4),
        ("fifth", 5),
        ("sixth", 6),
        ("seventh", 7),
        ("eighth", 8),
        ("ninth", 9),
    )
    out: dict[tuple[str, str], str] = {}
    for tw, base in tens:
        for ow, off in ones:
            out[(tw, ow)] = _n_to_ordinal_token(base + off)
    return out


_COMPOUND_STREET_ORDINAL: dict[tuple[str, str], str] = _build_compound_street_ordinal_map()

_SINGLE_STREET_ORDINAL_WORDS: tuple[tuple[str, int], ...] = (
    ("first", 1),
    ("second", 2),
    ("third", 3),
    ("fourth", 4),
    ("fifth", 5),
    ("sixth", 6),
    ("seventh", 7),
    ("eighth", 8),
    ("ninth", 9),
    ("tenth", 10),
    ("eleventh", 11),
    ("twelfth", 12),
    ("thirteenth", 13),
    ("fourteenth", 14),
    ("fifteenth", 15),
    ("sixteenth", 16),
    ("seventeenth", 17),
    ("eighteenth", 18),
    ("nineteenth", 19),
    ("twentieth", 20),
    ("thirtieth", 30),
    ("fortieth", 40),
    ("fiftieth", 50),
    ("sixtieth", 60),
    ("seventieth", 70),
    ("eightieth", 80),
    ("ninetieth", 90),
)

_STREET_ORDINAL_WORD_TO_TOKEN: dict[str, str] = {
    w: _n_to_ordinal_token(n) for w, n in _SINGLE_STREET_ORDINAL_WORDS
}


def _merge_compound_street_ordinals(parts: list[str]) -> list[str]:
    """Join ``twenty`` + ``first`` style pairs (from ``Twenty-First``) into ``21st``."""
    if len(parts) < 2:
        return parts
    out: list[str] = []
    i = 0
    while i < len(parts):
        if i + 1 < len(parts):
            pair = (parts[i], parts[i + 1])
            merged = _COMPOUND_STREET_ORDINAL.get(pair)
            if merged is not None:
                out.append(merged)
                i += 2
                continue
        out.append(parts[i])
        i += 1
    return out


def _canonical_street_ordinal_token(token: str) -> str:
    """Map ``third``/``3rd``/``03rd`` to one canonical ``3rd``-style token."""
    m = _NUMERIC_ORDINAL_TOKEN_RE.match(token)
    if m:
        return _n_to_ordinal_token(int(m.group(1), 10))
    return _STREET_ORDINAL_WORD_TO_TOKEN.get(token, token)


def _preprocess_sheet_street_for_match(line: str) -> str:
    """Normalize export quirks before ``canonical_street_address_key``.

    - Use the segment before ``/`` when the sheet lists two civic addresses (match the library's
      primary façade).
    - Turn ``709 (-715)``-style parenthetical unit ranges into hyphen form so they align with
      ``709-715`` in the database.
    """
    s = _normalize_space(line)
    if not s:
        return ""
    if "/" in s:
        s = _normalize_space(s.split("/")[0])
    if not s:
        return ""
    s = _PAREN_UNIT_RANGE_RE.sub(r"-\1", s)
    return _normalize_space(s)


def canonical_street_address_key(raw: str | None) -> str:
    """Normalize a street line so trivial abbreviation variants match each other."""
    if not raw:
        return ""
    segment = _normalize_space(raw.split(",")[0])
    if not segment:
        return ""
    segment = _preprocess_sheet_street_for_match(segment)
    if not segment:
        return ""
    segment = segment.casefold()
    segment = segment.replace(".", " ")
    segment = re.sub(r"[-#/]", " ", segment)
    segment = _normalize_space(segment)
    parts = _merge_compound_street_ordinals(segment.split())
    out: list[str] = []
    for p in parts:
        p = p.strip(".")
        p = _canonical_street_ordinal_token(p)
        out.append(_STREET_TOKEN_CANON.get(p, p))
    return " ".join(out)


def iter_street_lookup_keys(raw: str | None) -> list[str]:
    """Longest-first canonical street keys (full line, then progressively without trailing type tokens)."""
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
    """Library rows indexed by every canonical street key derived from ``location.address``."""
    idx: dict[str, list[MonthlyRouteLocation]] = defaultdict(list)
    for loc in db.session.execute(select(MonthlyRouteLocation)).scalars().all():
        for key in iter_street_lookup_keys(loc.address):
            idx[key].append(loc)
    return idx


def lookup_locations_for_sheet_street(
    canonical_index: dict[str, list[MonthlyRouteLocation]],
    street_line: str,
) -> list[MonthlyRouteLocation]:
    """Prefer the longest CSV-side key that has DB hits."""
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
    s0 = street.strip()
    if s0.casefold().startswith("address:"):
        street = s0.split(":", 1)[1].strip()
    else:
        street = s0
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


def decode_csv_bytes(data: bytes) -> str:
    """Best-effort decode of an Excel-on-Windows CSV; ``latin-1`` is the final fallback."""
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="replace")


def read_sheet_rows(data: bytes) -> list[list[str]]:
    text = decode_csv_bytes(data)
    return list(csv.reader(StringIO(text)))


# Second-column header prefixes (normalized lowercase) for the multi-line site block.
_ADDRESS_HEADER_PREFIXES = ("address", "location details", "site details")
# Tech notes column: various export spellings.
_TECH_NOTES_HEADER_ALIASES = (
    "tech comments & notes",
    "technician notes & comments",
    "technicians notes and comments",
    "technician notes and comments",
)
_ANNUAL_OR_MONTH_ALIASES = ("annual", "month")
_RING_OR_ACCESS_ALIASES = ("ring", "access", "access information")
_FACP_ALIASES = ("facp",)
_KEY_ALIASES = ("key #", "key #:")
_MONITORING_ALIASES = ("monitoring",)
_TESTING_PROCEDURES_ALIASES = ("testing procedures",)
_TIME_IN_ALIASES = ("time in", "time in:")
_TIME_OUT_ALIASES = ("time out", "time out:")


def _find_data_header_row_index(rows: list[list[str]]) -> int:
    for idx, row in enumerate(rows):
        if not row:
            continue
        first = _normalize_space(row[0])
        second = _normalize_space(row[1]).lower() if len(row) > 1 else ""
        if first == "#" and any(second.startswith(prefix) for prefix in _ADDRESS_HEADER_PREFIXES):
            return idx
    raise ValueError(
        "Could not find data header row (expected first column '#' and second column "
        "beginning with Address, Location Details, or Site Details)."
    )


def parse_sheet_meta(
    rows: list[list[str]], header_idx: int
) -> tuple[int | None, date | None, str | None]:
    """Route number, first-of-month date, optional route label from the preamble."""
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
            sheet_month = _parse_month_year(
                row[2] if len(row) > 2 else None, row[4] if len(row) > 4 else None
            )
    return route_num, sheet_month, route_label


@dataclass(frozen=True)
class PreambleParseResult:
    """Lightweight preamble-only inspection (no DB access)."""

    route_number: int | None
    month_date: date | None
    route_label: str | None


def parse_preamble_only(csv_bytes: bytes) -> PreambleParseResult:
    """Detect route + month from the CSV preamble without doing the full import.

    Used by the upload endpoint to validate the URL's route_id matches the CSV
    *before* calling the full importer (which mutates the DB).
    """
    rows = read_sheet_rows(csv_bytes)
    hdr_idx = _find_data_header_row_index(rows)
    rn, md, lab = parse_sheet_meta(rows, hdr_idx)
    return PreambleParseResult(route_number=rn, month_date=md, route_label=lab)


def _dict_reader_from_slice(rows: list[list[str]], start: int) -> csv.DictReader:
    buf = StringIO()
    w = csv.writer(buf)
    for r in rows[start:]:
        w.writerow(r)
    buf.seek(0)
    return csv.DictReader(buf)


def _strip_keys(row: dict[str, Any]) -> dict[str, str]:
    return {
        (_normalize_space(k) or k): (v if isinstance(v, str) else (v or "") or "")
        for k, v in row.items()
        if k
    }


def _row_get_alias(row: dict[str, str], aliases: tuple[str, ...]) -> str | None:
    """Case-insensitive header lookup across a tuple of acceptable header names."""
    if not row:
        return None
    lower_map: dict[str, str] = {}
    for k, v in row.items():
        key_norm = _normalize_space(k).lower()
        if key_norm and key_norm not in lower_map:
            lower_map[key_norm] = v
    for alias in aliases:
        v = lower_map.get(alias)
        if v is not None and v != "":
            return v
    return None


@dataclass
class ImportIssue:
    kind: str
    csv_row: int
    detail: str


@dataclass
class ImportResult:
    """Outcome summary for one CSV import."""

    route_number: int | None
    route_id: int | None
    month_date: date | None
    run_id: int | None
    sheet_label: str | None
    locations_updated: int = 0
    history_upserts: int = 0
    #: Row count where ``Time In``/``Time Out`` did not classify as tested/skipped
    #: (history rows and snapshots are still written).
    skipped_no_history: int = 0
    #: Row count where an existing ``MonthlyRouteTestHistory.result_status`` was
    #: kept (technician-portal entry) and only the CSV snapshot fields were
    #: overwritten. ``result_status`` / ``skip_reason`` / ``time_in`` /
    #: ``time_out`` / ``source_value_raw`` are preserved in this case.
    existing_status_preserved: int = 0
    stop_order_applied: int = 0
    stop_order_skipped_not_on_sheet_route: int = 0
    issues: list[ImportIssue] = field(default_factory=list)


def resolve_monthly_location_by_sheet_identity(
    *,
    at_address: list[MonthlyRouteLocation],
    property_management_company_normalized: str,
    building_normalized: str,
    street_display: str,
    company_display: str | None,
    building_display: str | None,
) -> tuple[MonthlyRouteLocation | None, str | None, str]:
    """Match a CSV row to ``MonthlyRouteLocation`` (canonical street → PMC → building narrowing)."""
    n_addr = len(at_address)
    if n_addr == 0:
        return None, "unmatched", "0 rows with this canonical street line"
    if n_addr == 1:
        return at_address[0], None, ""

    by_pmc = [
        loc
        for loc in at_address
        if loc.property_management_company_normalized
        == property_management_company_normalized
    ]
    if len(by_pmc) == 1:
        return by_pmc[0], None, ""

    if len(by_pmc) > 1:
        by_b = [
            loc for loc in by_pmc if loc.building_normalized == building_normalized
        ]
        if len(by_b) == 1:
            return by_b[0], None, ""
        detail = (
            f"{n_addr} DB rows at {street_display!r}; {len(by_pmc)} share sheet PMC {company_display!r}; "
            f"{len(by_b)} also match sheet Name {building_display!r}"
        )
        return None, "duplicate", detail

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


def _upsert_history_row(
    *,
    location_id: int,
    month_date: date,
    result_status: str | None,
    skip_reason: str | None,
    source_value_raw: str | None,
    testing_procedures: str | None,
    inspection_tech_notes: str | None,
    sheet_time_in_raw: str | None,
    sheet_time_out_raw: str | None,
    test_monthly_route_id: int,
    session_route_stop_order: int,
    facp: str | None,
    ring: str | None,
    key_number: str | None,
    annual_month: str | None,
    monitoring_notes: str | None,
    run_id: int | None,
    now: datetime,
) -> None:
    """ON CONFLICT UPDATE on ``uq_monthly_route_test_history_location_month`` for both PG and SQLite tests."""
    bind = db.session.get_bind()
    dialect_name = getattr(getattr(bind, "dialect", None), "name", "") or ""
    table = MonthlyRouteTestHistory.__table__
    values = {
        "location_id": location_id,
        "month_date": month_date,
        "result_status": result_status,
        "skip_reason": skip_reason,
        "source_value_raw": source_value_raw,
        "testing_procedures": testing_procedures,
        "inspection_tech_notes": inspection_tech_notes,
        "sheet_time_in_raw": sheet_time_in_raw,
        "sheet_time_out_raw": sheet_time_out_raw,
        "test_monthly_route_id": test_monthly_route_id,
        "session_route_stop_order": session_route_stop_order,
        "facp": facp,
        "ring": ring,
        "key_number": key_number,
        "annual_month": annual_month,
        "monitoring_notes": monitoring_notes,
        "run_id": run_id,
        "updated_at": now,
    }
    update_set_keys = (
        "result_status",
        "skip_reason",
        "source_value_raw",
        "testing_procedures",
        "inspection_tech_notes",
        "sheet_time_in_raw",
        "sheet_time_out_raw",
        "test_monthly_route_id",
        "session_route_stop_order",
        "facp",
        "ring",
        "key_number",
        "annual_month",
        "monitoring_notes",
        "run_id",
        "updated_at",
    )
    if dialect_name == "postgresql":
        stmt = pg_insert(table).values(**values)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_monthly_route_test_history_location_month",
            set_={k: getattr(stmt.excluded, k) for k in update_set_keys},
        )
        db.session.execute(stmt)
        return
    if dialect_name == "sqlite":
        # SQLite doesn't auto-generate BIGINT PK; pre-assign an id for the
        # INSERT branch (the ON CONFLICT branch uses ``excluded.*`` and
        # excluded.id isn't in our update set, so the existing id is preserved).
        next_id = (
            int(
                db.session.query(
                    db.func.coalesce(db.func.max(MonthlyRouteTestHistory.id), 0)
                ).scalar()
                or 0
            )
            + 1
        )
        stmt = sqlite_insert(table).values(id=next_id, **values)
        stmt = stmt.on_conflict_do_update(
            index_elements=[table.c.location_id, table.c.month_date],
            set_={k: getattr(stmt.excluded, k) for k in update_set_keys},
        )
        db.session.execute(stmt)
        return
    # Fallback: SELECT then INSERT/UPDATE (rare in this app).
    existing = (
        db.session.query(MonthlyRouteTestHistory)
        .filter(
            MonthlyRouteTestHistory.location_id == location_id,
            MonthlyRouteTestHistory.month_date == month_date,
        )
        .one_or_none()
    )
    if existing is None:
        next_id = int(
            db.session.query(
                db.func.coalesce(db.func.max(MonthlyRouteTestHistory.id), 0)
            ).scalar()
            or 0
        ) + 1
        db.session.execute(table.insert().values(id=next_id, **values))
    else:
        for key in update_set_keys:
            setattr(existing, key, values[key])


def run_route_inspection_csv_import(
    *,
    csv_bytes: bytes,
    run: MonthlyRouteRun,
    route: MonthlyRoute,
    month_date: date,
    dry_run: bool = False,
    sync_route_meta: bool = False,
    sync_stop_order: bool = False,
    update_route_display_name: bool = False,
) -> ImportResult:
    """Apply a parsed inspection CSV to ``run``.

    Caller is responsible for: validating that ``route.route_number`` matches
    the CSV's preamble (use :func:`parse_preamble_only` first), creating the
    ``MonthlyRouteRun`` (see ``app.monthly.runs.get_or_create_monthly_route_run``),
    and running this within a Flask app context. ``dry_run=True`` rolls back
    every mutation including the run row created above (caller's commit).
    """
    rows = read_sheet_rows(csv_bytes)
    hdr_idx = _find_data_header_row_index(rows)
    _parsed_rn, _sheet_month, sheet_label = parse_sheet_meta(rows, hdr_idx)

    canonical_index = load_locations_by_canonical_street()
    LOG.info(
        "Built canonical street index (%s distinct street keys).",
        f"{len(canonical_index):,}",
    )

    reader = _dict_reader_from_slice(rows, hdr_idx)
    result = ImportResult(
        route_number=int(route.route_number),
        route_id=int(route.id),
        month_date=month_date,
        run_id=int(run.id) if run is not None else None,
        sheet_label=sheet_label,
    )
    now = datetime.now(timezone.utc)

    pending_blank_rows: list[ImportIssue] = []

    for logical_row, raw in enumerate(reader, start=hdr_idx + 2):
        row = _strip_keys(raw)
        num_raw = _normalize_space(row.get("#"))
        if not num_raw or not num_raw.isdigit():
            if pending_blank_rows:
                result.issues.extend(pending_blank_rows)
                pending_blank_rows.clear()
            continue

        addr_block = _row_get_alias(row, tuple(_ADDRESS_HEADER_PREFIXES)) or ""
        street, building, company = parse_address_block(addr_block)
        if not street:
            pending_blank_rows.append(
                ImportIssue("missing_address", logical_row, "empty Address / Location Details")
            )
            if len(pending_blank_rows) >= _TRAILING_EMPTY_ADDRESS_ROWS:
                pending_blank_rows.clear()
                break
            continue

        if pending_blank_rows:
            result.issues.extend(pending_blank_rows)
            pending_blank_rows.clear()

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
            result.issues.append(
                ImportIssue(
                    match_err or "unmatched",
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
            detail_parts.append(
                f"sheet expects route_number={route.route_number} (route entity id={route.id})"
            )
            result.issues.append(
                ImportIssue("route_mismatch", logical_row, "; ".join(detail_parts))
            )

        stop_order = int(num_raw) - 1
        annual = _clean_text(_row_get_alias(row, _ANNUAL_OR_MONTH_ALIASES))
        ring_detail = _clean_multiline(_row_get_alias(row, _RING_OR_ACCESS_ALIASES))
        keys_text = _clean_multiline(_row_get_alias(row, _KEY_ALIASES))
        facp_detail = _clean_multiline(_row_get_alias(row, _FACP_ALIASES))
        monitoring_cell = _row_get_alias(row, _MONITORING_ALIASES)
        monitoring_notes = _clean_multiline(monitoring_cell)
        testing_procedures = _clean_multiline(
            _row_get_alias(row, _TESTING_PROCEDURES_ALIASES)
        )
        tech_notes = _clean_multiline(_row_get_alias(row, _TECH_NOTES_HEADER_ALIASES))
        time_in = _row_get_alias(row, _TIME_IN_ALIASES)
        time_out = _row_get_alias(row, _TIME_OUT_ALIASES)

        # Library "current" mirror — CSV is the source of truth for the latest run.
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
            result.stop_order_applied += 1
        elif sync_stop_order:
            if (
                loc.monthly_route_id is not None
                and int(loc.monthly_route_id) == int(route.id)
            ):
                loc.route_stop_order = stop_order
                result.stop_order_applied += 1
            else:
                result.stop_order_skipped_not_on_sheet_route += 1

        sheet_times = analyze_sheet_time_cells(time_in, time_out)
        rs = sheet_times.result_status
        if rs is None:
            result.skipped_no_history += 1

        # Merge with the technician portal: when an existing row already carries
        # a ``result_status`` (set in the worksheet), CSV upload must not clobber
        # it. We still overwrite the CSV-only snapshot fields below.
        existing_hist = (
            db.session.query(MonthlyRouteTestHistory)
            .filter(
                MonthlyRouteTestHistory.location_id == int(loc.id),
                MonthlyRouteTestHistory.month_date == month_date,
            )
            .one_or_none()
        )
        upsert_result_status = rs
        upsert_skip_reason = sheet_times.skip_reason
        upsert_source_value_raw = sheet_times.source_value_raw
        upsert_time_in = _clean_text(time_in)
        upsert_time_out = _clean_text(time_out)
        if existing_hist is not None and existing_hist.result_status is not None:
            upsert_result_status = existing_hist.result_status
            upsert_skip_reason = existing_hist.skip_reason
            upsert_source_value_raw = existing_hist.source_value_raw
            upsert_time_in = existing_hist.sheet_time_in_raw
            upsert_time_out = existing_hist.sheet_time_out_raw
            result.existing_status_preserved += 1

        _upsert_history_row(
            location_id=int(loc.id),
            month_date=month_date,
            result_status=upsert_result_status,
            skip_reason=upsert_skip_reason,
            source_value_raw=upsert_source_value_raw,
            testing_procedures=testing_procedures,
            inspection_tech_notes=tech_notes,
            sheet_time_in_raw=upsert_time_in,
            sheet_time_out_raw=upsert_time_out,
            test_monthly_route_id=int(route.id),
            session_route_stop_order=stop_order,
            facp=facp_detail,
            ring=ring_detail,
            key_number=keys_text,
            annual_month=annual,
            monitoring_notes=monitoring_notes,
            run_id=int(run.id) if run is not None else None,
            now=now,
        )
        result.history_upserts += 1

        result.locations_updated += 1

    if pending_blank_rows:
        result.issues.extend(pending_blank_rows)

    if update_route_display_name and sheet_label:
        route.display_name = sheet_label[:255]
        route.updated_at = now

    if dry_run:
        db.session.rollback()
    else:
        db.session.commit()

    return result
