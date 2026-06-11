"""
In-process importer for technician route inspection CSVs.

Parses the per-route, per-month "MONTHLY BELL TESTING" sheet (preamble with
``ROUTE:`` / ``DATE:`` rows, then a ``#, Address|Location Details, …`` data
header). Auto-detects route number and month from the preamble, matches each
row to a ``MonthlyLocation`` via library ``label`` on the importing route (sheet
street line), then canonical street address as backup. CSV ``Name:`` is
building name — used to disambiguate, not as the primary match key.
upserts a per-stop ``MonthlyLocationMonth`` row scoped to the resolved
``MonthlyRouteRun``. Snapshot fields (``facp`` panel type, ``ring``, ``key_number``,
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

from app.db_models import (
    MonthlyLocation,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteRun,
    db,
)
from app.monthly.monitoring_companies import find_active_monitoring_company_by_name
from app.monthly.monitoring_notes_parse import parse_monitoring_notes, rebuild_monitoring_notes
from app.monthly.sheet_visit_times import SheetTimeImportRow, analyze_sheet_time_cells
from app.monthly.worksheet_locations import upsert_location_month_from_csv_import
from app.monthly.location_building import monthly_location_sheet_name_normalized
from app.monthly.location_identity import normalize_label

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
    "close": "close",
    "cl": "close",
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
        "way",
        "cross",
    }
)

# Single trailing token after a street-type suffix (``Mills Rd W`` → West).
_TRAILING_STREET_DIR_SUFFIXES = frozenset({"n", "s", "e", "w", "ne", "nw", "se", "sw"})

_STREET_DIR_WORD_TO_SUFFIX: dict[str, str] = {
    "north": "n",
    "south": "s",
    "east": "e",
    "west": "w",
    "northeast": "ne",
    "northwest": "nw",
    "southeast": "se",
    "southwest": "sw",
}

# ``9911a`` civic unit letter on the house number (sheet) vs bare digits in DB.
_CIVIC_LETTER_SUFFIX_RE = re.compile(r"^(\d{1,7})([a-z])$")

# ``2676-C Wilfert Road`` — hyphen civic unit vs one DB address + ``… - Building C`` label.
_HYPHEN_CIVIC_UNIT_RE = re.compile(r"^(\d{1,7})-([A-Za-z])\b\s*(.*)$", re.IGNORECASE)
# ``1275-1277 Oscar Street`` civic ranges (digits on both sides of ``-``).
_CIVIC_HYPHEN_RANGE_RE = re.compile(r"^(\d{1,7})-(\d{1,7})\b\s*(.*)$", re.IGNORECASE)
_BUILDING_DESIGNATOR_IN_NAME_RE = re.compile(
    r"\(?\s*building\s+\"?([A-Za-z0-9]+)\"?\s*\)?",
    re.IGNORECASE,
)
_LIBRARY_LABEL_BUILDING_SUFFIX_RE = re.compile(
    r"\s*-\s*building\s+([A-Za-z0-9]+)\s*$",
    re.IGNORECASE,
)

# Rare known misspellings in library addresses (token-level, casefolded).
_STREET_NAME_TYPO_CORRECTIONS: dict[str, str] = {
    "mcdonlad": "mcdonald",
    "cresecent": "crescent",
}

# Consecutive data rows with ``#`` but empty site column → treat as end of sheet (Excel padding).
_TRAILING_EMPTY_ADDRESS_ROWS = 10

# ``1125 Douglas / (702 Fort)`` → primary ``1125 Douglas``; ``709 (-715) Yates`` → ``709-715 Yates``.
_PAREN_UNIT_RANGE_RE = re.compile(r"\(\s*-?(\d+)\s*\)")

# Trailing tenant/anchor labels on sheet lines, e.g. ``990 View & 911 Yates (London Drugs)``.
_TRAILING_PAREN_ANNOTATION_RE = re.compile(r"\s*\([^)]*\)\s*$")

# ``120 Gorge Road East (Building "A")`` — building letter on the civic line (not a tenant tag).
_STREET_TRAILING_BUILDING_PAREN_RE = re.compile(
    r"\s*\(\s*building\s+\"?([A-Za-z0-9]+)\"?\s*\)\s*$",
    re.IGNORECASE,
)

# ``1209+1229 Clarke Road`` (technician sheet) ↔ ``1209 & 1229 Clarke Road`` (library label).
_DUAL_CIVIC_PLUS_RE = re.compile(r"(\d)\+(\d)")

_AMPERSAND_STREET_SPLIT_RE = re.compile(r"\s*&\s*", re.IGNORECASE)

# Second line of site block: ``Building B`` (no ``Name:`` prefix) — common on multi-building sites.
_STANDALONE_BUILDING_LINE_RE = re.compile(r"^building\s+.+$", re.IGNORECASE)

_INLINE_NAME_RE = re.compile(r"\bname:\s*", re.IGNORECASE)
_INLINE_MANAGEMENT_RE = re.compile(r"\bmanagement:\s*", re.IGNORECASE)

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


def _strip_trailing_paren_annotation(line: str) -> str:
    """Drop a trailing ``(London Drugs)``-style label; not unit-range parens mid-line."""
    return _TRAILING_PAREN_ANNOTATION_RE.sub("", line).strip()


def _split_trailing_building_parens(line: str) -> tuple[str, str | None]:
    """``120 Gorge Road East (Building \"A\")`` → ``(120 Gorge Road East, a)``."""
    m = _STREET_TRAILING_BUILDING_PAREN_RE.search(line.strip())
    if not m:
        return line.strip(), None
    base = line[: m.start()].strip()
    if not base:
        return line.strip(), None
    return base, m.group(1).casefold()


def _street_line_has_ampersand_segments(line: str) -> bool:
    return "&" in line.casefold()


def _split_ampersand_street_segments(line: str) -> list[str]:
    return [seg.strip() for seg in _AMPERSAND_STREET_SPLIT_RE.split(line) if seg.strip()]


def _preprocess_sheet_street_for_match(line: str) -> str:
    """Normalize export quirks before ``canonical_street_address_key``.

    - Use the segment before ``/`` when the sheet lists two civic addresses (match the library's
      primary façade).
    - Turn ``709 (-715)``-style parenthetical unit ranges into hyphen form so they align with
      ``709-715`` in the database.
    - Strip trailing ``(tenant)`` annotations common on technician sheets.
    """
    s = _normalize_space(line)
    if not s:
        return ""
    if "/" in s:
        s = _normalize_space(s.split("/")[0])
    if not s:
        return ""
    s = _PAREN_UNIT_RANGE_RE.sub(r"-\1", s)
    s = _normalize_space(s)
    s, _ = _split_trailing_building_parens(s)
    s = _strip_trailing_paren_annotation(s)
    s = _DUAL_CIVIC_PLUS_RE.sub(r"\1 & \2", s)
    s = _apply_street_phrase_aliases(s)
    return _normalize_space(s)


def _apply_street_phrase_aliases(line: str) -> str:
    """Expand civic phrases so sheet vs library spellings share one canonical key.

    - ``Pat Bay`` ↔ ``Patricia Bay`` (local usage).
    - ``Keating X Road`` / ``Mt Newton X Rd`` ↔ ``… Cross Road`` (``X`` = cross).
    """
    t = line
    t = re.sub(r"(?i)\bpat\s+bay\b", "Patricia Bay", t)

    def _x_road_to_cross(m: re.Match[str]) -> str:
        name = m.group(1)
        return f"{name} Cross Road"

    t = re.sub(r"(?i)\b(\w+)\s+x\s+(?:road|rd)\b", _x_road_to_cross, t)
    return t


def _canonical_street_direction_token(token: str) -> str:
    """``East``/``E`` after a street type → ``e`` before optional suffix stripping."""
    return _STREET_DIR_WORD_TO_SUFFIX.get(token, token)


def _strip_trailing_cardinal_after_street_type(parts: list[str]) -> list[str]:
    """Drop a trailing ``N``/``S``/``E``/``W`` (or intercardinal) after a known street-type token."""
    if len(parts) < 3:
        return parts
    if parts[-1] not in _TRAILING_STREET_DIR_SUFFIXES:
        return parts
    if parts[-2] not in _OMITTABLE_STREET_SUFFIXES:
        return parts
    return parts[:-1]


def _normalize_civic_number_token(parts: list[str]) -> list[str]:
    """``9911a`` → ``9911`` so sheet civic suffixes align with bare DB numbers."""
    if not parts:
        return parts
    m = _CIVIC_LETTER_SUFFIX_RE.match(parts[0])
    if not m:
        return parts
    out = list(parts)
    out[0] = m.group(1)
    return out


def _canonical_single_street_segment(preprocessed: str, *, strip_civic_letter: bool = False) -> str:
    """Canonical key for one civic line (no ``&``-joined corners)."""
    segment = preprocessed
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
        p = _STREET_NAME_TYPO_CORRECTIONS.get(p, p)
        p = _STREET_TOKEN_CANON.get(p, p)
        p = _canonical_street_direction_token(p)
        out.append(p)
    if strip_civic_letter:
        out = _normalize_civic_number_token(out)
    out = _strip_trailing_cardinal_after_street_type(out)
    return " ".join(out)


def _preprocessed_street_segment(raw: str | None) -> str:
    if not raw:
        return ""
    segment = _normalize_space(raw.split(",")[0])
    if not segment:
        return ""
    return _preprocess_sheet_street_for_match(segment)


def _street_segment_has_civic_letter_suffix(preprocessed: str) -> bool:
    first = (preprocessed or "").split(maxsplit=1)[0] if preprocessed else ""
    if not first:
        return False
    first = first.casefold().replace(".", "")
    return bool(_CIVIC_LETTER_SUFFIX_RE.match(first))


def _split_hyphen_civic_unit(line: str) -> tuple[str, str | None]:
    """``2676-C Wilfert Road`` → ``(2676 Wilfert Road, c)`` when the suffix is a unit letter."""
    m = _HYPHEN_CIVIC_UNIT_RE.match(line.strip())
    if not m or not m.group(3).strip():
        return line.strip(), None
    return f"{m.group(1)} {m.group(3).strip()}".strip(), m.group(2).casefold()


def _leading_civic_from_hyphen_range(line: str) -> str | None:
    """``1275-1277 Oscar St`` → ``1275 Oscar St`` for library rows keyed on the first civic only."""
    m = _CIVIC_HYPHEN_RANGE_RE.match(line.strip())
    if not m or not m.group(3).strip():
        return None
    return f"{m.group(1)} {m.group(3).strip()}".strip()


def _iter_civic_range_leading_lookup_keys(raw: str | None) -> list[str]:
    """Fallback keys when a sheet range must match a single-civic library address."""
    leading = _leading_civic_from_hyphen_range(_normalize_space((raw or "").split(",")[0]))
    if not leading:
        return []
    segment = _preprocessed_street_segment(leading)
    if not segment:
        return []
    return _iter_single_street_key_variants(segment, allow_civic_strip_fallback=True)


def _library_label_keys_from_sheet_street(street: str) -> list[str]:
    """Library labels like ``2676 Wilfert Road - Building C`` from sheet civic lines."""
    keys: list[str] = []
    base_line, letter = _split_hyphen_civic_unit(street)
    if letter:
        base_canon = canonical_street_address_key(base_line)
        if base_canon:
            keys.append(f"{base_canon} - building {letter}")
    street_base, building_letter = _split_trailing_building_parens(street)
    if building_letter:
        base_canon = canonical_street_address_key(street_base)
        if base_canon:
            key = f"{base_canon} - building {building_letter}"
            if key not in keys:
                keys.append(key)
    return keys


def _sheet_building_designators(street: str, building: str | None) -> frozenset[str]:
    """Building letter/number tokens from hyphen civic or ``(Building \"C\")`` name lines."""
    out: set[str] = set()
    _, letter = _split_hyphen_civic_unit(street)
    if letter:
        out.add(letter)
    _, paren_letter = _split_trailing_building_parens(street)
    if paren_letter:
        out.add(paren_letter)
    if building:
        for m in _BUILDING_DESIGNATOR_IN_NAME_RE.finditer(building):
            out.add(m.group(1).casefold())
        standalone = re.match(r"^building\s+([A-Za-z0-9]+)$", building.strip(), re.IGNORECASE)
        if standalone:
            out.add(standalone.group(1).casefold())
    return frozenset(out)


def _location_label_building_suffix(loc: MonthlyLocation) -> str | None:
    label = loc.label_normalized or ""
    m = _LIBRARY_LABEL_BUILDING_SUFFIX_RE.search(label)
    if m:
        return m.group(1).casefold()
    return None


def _keys_from_canonical_base(base: str) -> list[str]:
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


def _iter_single_street_key_variants(
    preprocessed: str,
    *,
    allow_civic_strip_fallback: bool,
) -> list[str]:
    """Longest-first keys for one civic line."""
    keys: list[str] = []
    for base in (
        _canonical_single_street_segment(preprocessed, strip_civic_letter=False),
        (
            _canonical_single_street_segment(preprocessed, strip_civic_letter=True)
            if allow_civic_strip_fallback and _street_segment_has_civic_letter_suffix(preprocessed)
            else ""
        ),
    ):
        for key in _keys_from_canonical_base(base):
            if key not in keys:
                keys.append(key)
    return keys


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
    if _street_line_has_ampersand_segments(segment):
        parts = sorted(
            _canonical_single_street_segment(seg)
            for seg in _split_ampersand_street_segments(segment)
        )
        return " ".join(p for p in parts if p)
    return _canonical_single_street_segment(segment)


def _iter_single_street_lookup_keys(preprocessed: str) -> list[str]:
    """Longest-first keys for one civic line (progressive trailing type-token drop)."""
    return _iter_single_street_key_variants(preprocessed, allow_civic_strip_fallback=True)


def iter_street_index_keys(raw: str | None) -> list[str]:
    """Longest-first keys for indexing library addresses (keeps ``3319a`` / ``3319b`` distinct)."""
    segment = _preprocessed_street_segment(raw)
    if not segment:
        return []
    if _street_line_has_ampersand_segments(segment):
        return _iter_compound_street_lookup_keys(segment, allow_civic_strip_fallback=False)
    return _iter_single_street_key_variants(segment, allow_civic_strip_fallback=False)


def _iter_compound_street_lookup_keys(
    preprocessed: str,
    *,
    allow_civic_strip_fallback: bool = True,
) -> list[str]:
    """Longest-first keys for ``&`` corners (order-insensitive; per-corner suffix stripping)."""
    segments = _split_ampersand_street_segments(preprocessed)
    if len(segments) < 2:
        return _iter_single_street_key_variants(
            preprocessed,
            allow_civic_strip_fallback=allow_civic_strip_fallback,
        )
    per_seg = [
        _iter_single_street_key_variants(seg, allow_civic_strip_fallback=allow_civic_strip_fallback)
        for seg in segments
    ]
    if not all(per_seg):
        return []
    keys: list[str] = []
    longest = " ".join(sorted(keys[0] for keys in per_seg))
    if longest:
        keys.append(longest)
    stripped = " ".join(sorted(keys[-1] for keys in per_seg))
    if stripped and stripped not in keys:
        keys.append(stripped)
    return keys


def iter_street_lookup_keys(raw: str | None) -> list[str]:
    """Longest-first canonical street keys (full line, then progressively without trailing type tokens)."""
    segment = _preprocessed_street_segment(raw)
    if not segment:
        return []
    if _street_line_has_ampersand_segments(segment):
        keys = _iter_compound_street_lookup_keys(segment, allow_civic_strip_fallback=True)
    else:
        keys = _iter_single_street_key_variants(segment, allow_civic_strip_fallback=True)
    base_line, _ = _split_hyphen_civic_unit(raw or "")
    raw_street = _normalize_space((raw or "").split(",")[0])
    if base_line and raw_street and base_line != raw_street:
        base_segment = _preprocessed_street_segment(base_line)
        if base_segment:
            for key in _iter_single_street_key_variants(
                base_segment,
                allow_civic_strip_fallback=True,
            ):
                if key not in keys:
                    keys.append(key)
    for key in _iter_civic_range_leading_lookup_keys(raw):
        if key not in keys:
            keys.append(key)
    return keys


def _iter_label_lookup_keys(label_style: str) -> list[str]:
    """Longest-first normalized label keys with optional street-type suffixes dropped per ``&`` corner."""
    label_style = _normalize_space(label_style)
    if not label_style:
        return []
    if "&" not in label_style:
        keys: list[str] = []
        for key in _keys_from_canonical_base(label_style):
            if key not in keys:
                keys.append(key)
        return keys
    segments = [seg.strip() for seg in _AMPERSAND_STREET_SPLIT_RE.split(label_style) if seg.strip()]
    if len(segments) < 2:
        return _iter_label_lookup_keys(label_style.replace("&", ""))
    per_seg: list[list[str]] = []
    for seg in segments:
        variant_keys: list[str] = []
        for key in _keys_from_canonical_base(seg):
            if key not in variant_keys:
                variant_keys.append(key)
        if not variant_keys:
            return []
        per_seg.append(variant_keys)
    keys: list[str] = []
    longest = " & ".join(parts[0] for parts in per_seg)
    if longest:
        keys.append(longest)
    shortest = " & ".join(parts[-1] for parts in per_seg)
    if shortest and shortest not in keys:
        keys.append(shortest)
    return keys


def load_locations_by_canonical_street() -> dict[str, list[MonthlyLocation]]:
    """Library rows indexed by canonical street keys from ``address`` and ``label``."""
    idx: dict[str, list[MonthlyLocation]] = defaultdict(list)
    for loc in db.session.execute(select(MonthlyLocation)).scalars().all():
        keys_added: set[str] = set()
        for source in (loc.address, loc.label):
            if not (source or "").strip():
                continue
            for key in iter_street_index_keys(source):
                if key in keys_added:
                    continue
                keys_added.add(key)
                idx[key].append(loc)
    return idx


def lookup_locations_for_sheet_street(
    canonical_index: dict[str, list[MonthlyLocation]],
    street_line: str,
) -> list[MonthlyLocation]:
    """Prefer the longest CSV-side key that has DB hits."""
    for key in iter_street_lookup_keys(street_line):
        bucket = canonical_index.get(key)
        if bucket:
            return bucket
    return []


def load_locations_by_label() -> dict[str, list[MonthlyLocation]]:
    """Library rows indexed by normalized ``MonthlyLocation.label`` and suffix variants."""
    idx: dict[str, list[MonthlyLocation]] = defaultdict(list)
    seen: dict[str, set[int]] = defaultdict(set)
    for loc in db.session.execute(select(MonthlyLocation)).scalars().all():
        label_keys = _iter_label_lookup_keys(loc.label_normalized or "")
        if not label_keys and loc.label_normalized:
            label_keys = [loc.label_normalized]
        for key in label_keys:
            if not key or int(loc.id) in seen[key]:
                continue
            seen[key].add(int(loc.id))
            idx[key].append(loc)
    return idx


def _sheet_label_style_key(street: str) -> str:
    """Casefold label-style key: expand ``St``/``Rd``/… without splitting civic ranges."""
    line = _normalize_space(street.split(",")[0])
    if not line:
        return ""
    parts = line.casefold().split()
    out = [_canonical_street_direction_token(_STREET_TOKEN_CANON.get(p, p)) for p in parts]
    return " ".join(out)


def _sheet_label_candidates(_building: str | None, street: str) -> list[str]:
    """Normalized library-label keys from the CSV street line (first address line).

    Technician sheets put the location **label** on this line (e.g.
    ``9824-9830 Fourth Street`` or ``3319B Painter Rd``). The ``Name:`` line
    is building name and is not a label lookup key.
    """
    keys: list[str] = []
    for key in _library_label_keys_from_sheet_street(street):
        keys.append(key)
    label_style = _sheet_label_style_key(street)
    for key in _iter_label_lookup_keys(label_style):
        if key and key not in keys:
            keys.append(key)
    street_line = _normalize_space(street.split(",")[0])
    street_key = _normalize_building(_preprocess_sheet_street_for_match(street_line))
    if street_key and street_key not in keys:
        keys.append(street_key)
    canon = canonical_street_address_key(street)
    if canon and canon not in keys:
        keys.append(canon)
    for key in iter_street_lookup_keys(street):
        if key not in keys:
            keys.append(key)
    return keys


def _sheet_narrowing_matches_loc(
    loc: MonthlyLocation,
    *,
    sheet_label_key: str,
    sheet_building_key: str,
    match_basis: str,
    sheet_building_designators: frozenset[str] = frozenset(),
) -> bool:
    """Disambiguate among several library rows (PMC tie-breaker follow-up)."""
    if sheet_building_designators:
        suffix = _location_label_building_suffix(loc)
        if suffix and suffix in sheet_building_designators:
            return True
    if match_basis == "label":
        if sheet_label_key and (loc.label_normalized or "") == sheet_label_key:
            return True
        if sheet_building_key:
            if (loc.label_normalized or "") == sheet_building_key:
                return True
            if normalize_label(loc.building_name) == sheet_building_key:
                return True
        return False
    narrow_key = sheet_building_key or sheet_label_key
    if not narrow_key:
        return False
    return monthly_location_sheet_name_normalized(loc) == narrow_key


def lookup_locations_for_sheet_labels(
    label_index: dict[str, list[MonthlyLocation]],
    candidates: list[str],
    *,
    monthly_route_id: int | None = None,
) -> list[MonthlyLocation]:
    """First candidate key with DB hits, optionally limited to one route."""
    for key in candidates:
        if not key:
            continue
        bucket = label_index.get(key)
        if not bucket:
            continue
        if monthly_route_id is not None:
            on_route = [
                loc
                for loc in bucket
                if loc.monthly_route_id is not None
                and int(loc.monthly_route_id) == int(monthly_route_id)
            ]
            if on_route:
                return on_route
            continue
        return bucket
    return []


def _normalize_company(value: str | None) -> str:
    s = _normalize_space(value).casefold()
    s = re.sub(r"\s*/\s*", "/", s)
    return s.replace(".", "")


def _pmc_token_abbrev_match(sheet_cf: str, db_cf: str) -> bool:
    """Same token count with abbreviated sheet tokens (e.g. ``firm manag`` vs ``firm management``)."""
    sheet_tokens = (sheet_cf or "").split()
    db_tokens = (db_cf or "").split()
    if not sheet_tokens or len(sheet_tokens) != len(db_tokens):
        return False
    for s_tok, d_tok in zip(sheet_tokens, db_tokens):
        if s_tok == d_tok:
            continue
        if len(s_tok) < 5 or len(d_tok) < 5:
            return False
        if len(s_tok) >= len(d_tok) or not d_tok.startswith(s_tok):
            return False
    return True


def _pmc_extension_prefix_match(shorter: str, longer: str) -> bool:
    """True when ``longer`` is ``shorter`` plus a delimiter suffix (e.g. colliers vs colliers - mall)."""
    if not shorter:
        return not longer
    if not longer.startswith(shorter):
        return False
    if len(longer) == len(shorter):
        return True
    rest = longer[len(shorter) :]
    return bool(rest) and rest[0] in " \t-–—:|"


def _pmc_shared_lead_token_match(sheet_cf: str, db_cf: str) -> bool:
    """Same lead token when suffix differs (e.g. ``sherringham group`` vs ``sherringham holdings``)."""
    sheet_tokens = (sheet_cf or "").split()
    db_tokens = (db_cf or "").split()
    if len(sheet_tokens) < 2 or len(db_tokens) < 2:
        return False
    lead = sheet_tokens[0]
    if len(lead) < 4 or lead != db_tokens[0]:
        return False
    return True


def _pmc_sheet_matches_db(sheet_cf: str, db_cf: str) -> bool:
    """Loose PMC match when exact equality failed: DB name extends the sheet (e.g. ``colliers`` → ``colliers - mall``).

    Only the sheet-as-prefix-of-DB direction is allowed so a short library label is
    never widened to unrelated longer sheet names.
    """
    if sheet_cf == db_cf:
        return True
    if not sheet_cf or not db_cf:
        return False
    if _pmc_extension_prefix_match(sheet_cf, db_cf):
        return True
    if _pmc_token_abbrev_match(sheet_cf, db_cf):
        return True
    return _pmc_shared_lead_token_match(sheet_cf, db_cf)


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


_PANEL_LINE_RE = re.compile(r"^PANEL:\s*", re.IGNORECASE)
_LOCATION_LINE_RE = re.compile(r"^LOCATION:\s*", re.IGNORECASE)
_PANEL_LOCATION_MAX_LEN = 255


def parse_facp_panel_fields(raw: str | None) -> tuple[str | None, str | None]:
    """Split sheet ``FACP`` cell into panel type (``PANEL:``) and ``LOCATION:`` lines.

    Technician route CSVs (e.g. ``R1 - 1st Monday - Pac Pro 1.csv``) use::

        PANEL: PACPRO P24A
        LOCATION: Basement North East Electrical Room in laundry room.

    When neither prefix is present, the whole cell is treated as panel text (legacy sheets).
    """
    text = _clean_multiline(raw)
    if not text:
        return None, None

    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    if not lines:
        return None, None

    has_panel = any(_PANEL_LINE_RE.match(ln) for ln in lines)
    has_location = any(_LOCATION_LINE_RE.match(ln) for ln in lines)
    if not has_panel and not has_location:
        return text, None

    panel_parts: list[str] = []
    location_parts: list[str] = []
    section: str | None = None

    for line in lines:
        if _PANEL_LINE_RE.match(line):
            section = "panel"
            rest = _PANEL_LINE_RE.sub("", line, count=1).strip()
            if rest:
                panel_parts.append(rest)
            continue
        if _LOCATION_LINE_RE.match(line):
            section = "location"
            rest = _LOCATION_LINE_RE.sub("", line, count=1).strip()
            if rest:
                location_parts.append(rest)
            continue
        if section == "panel":
            panel_parts.append(line)
        elif section == "location":
            location_parts.append(line)
        else:
            panel_parts.append(line)

    panel = _clean_multiline("\n".join(panel_parts)) if panel_parts else None
    location = _clean_multiline("\n".join(location_parts)) if location_parts else None
    if location and len(location) > _PANEL_LOCATION_MAX_LEN:
        location = location[:_PANEL_LOCATION_MAX_LEN].rstrip()
    return panel, location


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


def _strip_inline_name_and_management(line: str) -> tuple[str, str | None, str | None]:
    """Extract inline ``Name:`` / ``Management:`` suffixes from one civic line."""
    if not line:
        return "", None, None
    name_m = _INLINE_NAME_RE.search(line)
    mgmt_m = _INLINE_MANAGEMENT_RE.search(line)
    if not name_m and not mgmt_m:
        return line.strip(), None, None

    building: str | None = None
    company: str | None = None
    if name_m and mgmt_m:
        if name_m.start() < mgmt_m.start():
            street = line[: name_m.start()].strip()
            building = line[name_m.end() : mgmt_m.start()].strip() or None
            company = line[mgmt_m.end() :].strip() or None
        else:
            street = line[: mgmt_m.start()].strip()
            company = line[mgmt_m.end() : name_m.start()].strip() or None
            building = line[name_m.end() :].strip() or None
    elif mgmt_m:
        street = line[: mgmt_m.start()].strip()
        company = line[mgmt_m.end() :].strip() or None
    else:
        assert name_m is not None
        street = line[: name_m.start()].strip()
        building = line[name_m.end() :].strip() or None
    return street, building, company


def parse_address_block(text: str | None) -> tuple[str, str | None, str | None]:
    """Street line + optional ``Name:`` building + optional ``Management:`` company.

    Also treats a standalone second line like ``Building B`` (no ``Name:`` prefix)
    as the building name when ``Name:`` did not set one — matches paperwork that
    puts the civic address on the first line and ``Building …`` on the next.
    """
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
    street, inline_building, inline_company = _strip_inline_name_and_management(street)
    street, paren_building = _split_trailing_building_parens(street)
    standalone_building: str | None = inline_building
    if paren_building:
        standalone_building = f"Building {paren_building.upper()}"
    name_building: str | None = None
    company: str | None = inline_company
    for ln in lines[1:]:
        low = ln.lower()
        if low.startswith("name:"):
            name_building = ln.split(":", 1)[1].strip() or None
        elif low.startswith("management:"):
            company = ln.split(":", 1)[1].strip() or company
        elif _STANDALONE_BUILDING_LINE_RE.match(ln):
            standalone_building = _normalize_space(ln) or standalone_building
    # ``Building B`` disambiguates multi-site addresses; ``Name:`` is often the shared complex.
    building = standalone_building or name_building
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
    #: Row count where an existing ``MonthlyLocationMonth.result_status`` was
    #: kept (technician-portal entry) and only the CSV snapshot fields were
    #: overwritten. ``result_status`` / ``skip_reason`` / ``time_in`` /
    #: ``time_out`` / ``source_value_raw`` are preserved in this case.
    existing_status_preserved: int = 0
    stop_order_applied: int = 0
    stop_order_skipped_not_on_sheet_route: int = 0
    #: Legacy API counters; flat locations no longer use testing-site fallback.
    testing_site_matches: int = 0
    stop_month_upserts: int = 0
    issues: list[ImportIssue] = field(default_factory=list)


@dataclass
class ParsedCsvRowFields:
    stop_order: int
    annual: str | None
    ring_detail: str | None
    keys_text: str | None
    panel_text: str | None
    panel_location_text: str | None
    monitoring_company_id: int | None
    monitoring_account_number: str | None
    monitoring_password: str | None
    cleaned_monitoring_notes: str | None
    testing_procedures: str | None
    tech_notes: str | None
    time_in: str | None
    time_out: str | None
    sheet_times: SheetTimeImportRow
    monitoring_cell: str | None


def _parse_csv_row_fields(row: dict[str, str], *, stop_order: int) -> ParsedCsvRowFields:
    annual = _clean_text(_row_get_alias(row, _ANNUAL_OR_MONTH_ALIASES))
    ring_detail = _clean_multiline(_row_get_alias(row, _RING_OR_ACCESS_ALIASES))
    keys_text = _clean_multiline(_row_get_alias(row, _KEY_ALIASES))
    facp_cell = _row_get_alias(row, _FACP_ALIASES)
    panel_text, panel_location_text = parse_facp_panel_fields(facp_cell)
    monitoring_cell = _row_get_alias(row, _MONITORING_ALIASES)
    monitoring_notes = _clean_multiline(monitoring_cell)
    parsed_monitoring = parse_monitoring_notes(monitoring_notes)
    monitoring_account_number = (parsed_monitoring.acct or "").strip() or None
    monitoring_password = (parsed_monitoring.password or "").strip() or None
    monitoring_company_id: int | None = None
    if parsed_monitoring.company:
        matched = find_active_monitoring_company_by_name(parsed_monitoring.company)
        if matched is not None:
            monitoring_company_id = int(matched.id)
    cleaned_monitoring_notes = rebuild_monitoring_notes(parsed_monitoring) or monitoring_notes
    if _is_monitoring_none(monitoring_cell):
        monitoring_company_id = None
        monitoring_account_number = None
        monitoring_password = None
        cleaned_monitoring_notes = None
    testing_procedures = _clean_multiline(_row_get_alias(row, _TESTING_PROCEDURES_ALIASES))
    tech_notes = _clean_multiline(_row_get_alias(row, _TECH_NOTES_HEADER_ALIASES))
    time_in = _row_get_alias(row, _TIME_IN_ALIASES)
    time_out = _row_get_alias(row, _TIME_OUT_ALIASES)
    return ParsedCsvRowFields(
        stop_order=stop_order,
        annual=annual,
        ring_detail=ring_detail,
        keys_text=keys_text,
        panel_text=panel_text,
        panel_location_text=panel_location_text,
        monitoring_company_id=monitoring_company_id,
        monitoring_account_number=monitoring_account_number,
        monitoring_password=monitoring_password,
        cleaned_monitoring_notes=cleaned_monitoring_notes,
        testing_procedures=testing_procedures,
        tech_notes=tech_notes,
        time_in=time_in,
        time_out=time_out,
        sheet_times=analyze_sheet_time_cells(time_in, time_out),
        monitoring_cell=monitoring_cell,
    )


def _append_route_mismatch_issue(
    result: ImportResult,
    *,
    logical_row: int,
    loc: MonthlyLocation,
    route: MonthlyRoute,
) -> None:
    if loc.monthly_route_id is None or int(loc.monthly_route_id) == int(route.id):
        return
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
    if loc.label:
        detail_parts.append(f"DB label={loc.label!r}")
    if loc.property_management_company:
        detail_parts.append(f"DB mgmt={loc.property_management_company!r}")
    detail_parts.append(f"assigned monthly_route_id={loc.monthly_route_id}")
    if assigned_rn is not None:
        detail_parts.append(f"(DB route_number={assigned_rn})")
    detail_parts.append(
        f"sheet expects route_number={route.route_number} (route entity id={route.id})"
    )
    result.issues.append(ImportIssue("route_mismatch", logical_row, "; ".join(detail_parts)))


def _apply_csv_row_to_location(
    *,
    loc: MonthlyLocation,
    parsed: ParsedCsvRowFields,
    building_name: str | None,
    route: MonthlyRoute,
    month_date: date,
    run: MonthlyRouteRun,
    result: ImportResult,
    logical_row: int,
    now: datetime,
    sync_route_meta: bool,
    sync_stop_order: bool,
) -> None:
    from app.monthly.history_sheet_notes import is_latest_history_month_for_location

    _append_route_mismatch_issue(result, logical_row=logical_row, loc=loc, route=route)

    loc.annual_month = parsed.annual
    if building_name:
        loc.building_name = building_name
    loc.ring_detail = parsed.ring_detail
    loc.keys = parsed.keys_text
    loc.panel = parsed.panel_text
    loc.panel_location = parsed.panel_location_text
    loc.facp_detail = parsed.panel_text
    loc.monitoring_company_id = parsed.monitoring_company_id
    loc.monitoring_account_number = parsed.monitoring_account_number
    loc.monitoring_password = parsed.monitoring_password
    loc.monitoring_notes = parsed.cleaned_monitoring_notes
    if is_latest_history_month_for_location(int(loc.id), month_date):
        loc.testing_procedures = parsed.testing_procedures
        loc.inspection_tech_notes = parsed.tech_notes
    if _is_monitoring_none(parsed.monitoring_cell):
        loc.monitoring_company_id = None
        loc.pending_monitoring_company_proposal_id = None

    loc.updated_at = now

    if sync_route_meta:
        loc.monthly_route_id = route.id
        loc.route_stop_order = parsed.stop_order
        result.stop_order_applied += 1
    elif sync_stop_order:
        if loc.monthly_route_id is not None and int(loc.monthly_route_id) == int(route.id):
            loc.route_stop_order = parsed.stop_order
            result.stop_order_applied += 1
        else:
            result.stop_order_skipped_not_on_sheet_route += 1

    if parsed.sheet_times.result_status is None:
        result.skipped_no_history += 1

    run_id = int(run.id) if run is not None else 0
    existing_mlm = MonthlyLocationMonth.query.filter_by(
        monthly_location_id=int(loc.id),
        month_date=month_date,
    ).one_or_none()
    if existing_mlm is not None and existing_mlm.result_status is not None:
        result.existing_status_preserved += 1

    upsert_location_month_from_csv_import(
        loc=loc,
        route_id=int(route.id),
        run_id=run_id,
        month_first=month_date,
        session_route_stop_order=parsed.stop_order,
        sheet_times=parsed.sheet_times,
        panel=parsed.panel_text,
        panel_location=parsed.panel_location_text,
        ring_detail=parsed.ring_detail,
        keys_text=parsed.keys_text,
        annual_month=parsed.annual,
        testing_procedures=parsed.testing_procedures,
        inspection_tech_notes=parsed.tech_notes,
        monitoring_notes=parsed.cleaned_monitoring_notes,
        monitoring_account_number=parsed.monitoring_account_number,
        monitoring_password=parsed.monitoring_password,
        monitoring_company_id=parsed.monitoring_company_id,
        sheet_time_in_raw=_clean_text(parsed.time_in),
        sheet_time_out_raw=_clean_text(parsed.time_out),
    )
    result.history_upserts += 1
    result.locations_updated += 1


def _narrow_candidates_by_street(
    candidates: list[MonthlyLocation],
    *,
    canonical_index: dict[str, list[MonthlyLocation]],
    street_line: str,
) -> list[MonthlyLocation]:
    """When label matching yields multiple rows, prefer those that also share the sheet street."""
    if len(candidates) <= 1:
        return candidates
    at_street = lookup_locations_for_sheet_street(canonical_index, street_line)
    if not at_street:
        return candidates
    street_ids = {int(loc.id) for loc in at_street}
    intersect = [loc for loc in candidates if int(loc.id) in street_ids]
    return intersect if intersect else candidates


def resolve_monthly_location_by_sheet_identity(
    *,
    at_address: list[MonthlyLocation],
    property_management_company_normalized: str,
    label_normalized: str,
    street_display: str,
    company_display: str | None,
    label_display: str | None,
    match_basis: str = "street",
    sheet_building_key: str = "",
    sheet_building_designators: frozenset[str] = frozenset(),
) -> tuple[MonthlyLocation | None, str | None, str]:
    """Match a CSV row to ``MonthlyLocation`` (PMC → label narrowing within ``at_address``)."""
    n_addr = len(at_address)
    if n_addr == 0:
        if match_basis == "label":
            return None, "unmatched", "0 rows on this route with this label"
        return None, "unmatched", "0 rows with this canonical street line"
    if n_addr == 1:
        return at_address[0], None, ""

    by_pmc = [
        loc
        for loc in at_address
        if loc.property_management_company_normalized
        == property_management_company_normalized
    ]
    if len(by_pmc) == 0 and property_management_company_normalized:
        by_pmc = [
            loc
            for loc in at_address
            if _pmc_sheet_matches_db(
                property_management_company_normalized,
                loc.property_management_company_normalized or "",
            )
        ]
    if len(by_pmc) == 1:
        return by_pmc[0], None, ""

    if len(by_pmc) > 1 and sheet_building_designators:
        by_designator = [
            loc
            for loc in by_pmc
            if _location_label_building_suffix(loc) in sheet_building_designators
        ]
        if len(by_designator) == 1:
            return by_designator[0], None, ""

    if len(by_pmc) > 1:
        by_label = [
            loc
            for loc in by_pmc
            if _sheet_narrowing_matches_loc(
                loc,
                sheet_label_key=label_normalized,
                sheet_building_key=sheet_building_key,
                match_basis=match_basis,
                sheet_building_designators=sheet_building_designators,
            )
        ]
        if len(by_label) == 1:
            return by_label[0], None, ""
        basis = "route label" if match_basis == "label" else f"street {street_display!r}"
        detail = (
            f"{n_addr} DB rows for {basis}; {len(by_pmc)} share sheet PMC {company_display!r}; "
            f"{len(by_label)} also match sheet Name {label_display!r}"
        )
        return None, "duplicate", detail

    by_label = [
        loc
        for loc in at_address
        if _sheet_narrowing_matches_loc(
            loc,
            sheet_label_key=label_normalized,
            sheet_building_key=sheet_building_key,
            match_basis=match_basis,
            sheet_building_designators=sheet_building_designators,
        )
    ]
    if len(by_label) == 1:
        return by_label[0], None, ""
    basis = "route label" if match_basis == "label" else f"street {street_display!r}"
    detail = (
        f"{n_addr} DB rows for {basis}; sheet PMC {company_display!r} matched 0 of them; "
        f"label {label_display!r} matched {len(by_label)}"
    )
    if len(by_label) == 0:
        return None, "ambiguous", detail
    return None, "duplicate", detail


def resolve_monthly_location_for_csv_row(
    *,
    canonical_index: dict[str, list[MonthlyLocation]],
    label_index: dict[str, list[MonthlyLocation]],
    monthly_route_id: int,
    street: str,
    building: str | None,
    company: str | None,
) -> tuple[MonthlyLocation | None, str | None, str]:
    """Label-first on the importing route, then canonical street as backup."""
    cid = _normalize_company(company)
    label_candidates = _sheet_label_candidates(building, street)
    sheet_label_key = label_candidates[0] if label_candidates else ""
    sheet_building_key = _normalize_building(building) if building else ""
    sheet_building_designators = _sheet_building_designators(street, building)
    label_display = building or street or None

    on_route = lookup_locations_for_sheet_labels(
        label_index,
        label_candidates,
        monthly_route_id=monthly_route_id,
    )
    if on_route:
        narrowed = _narrow_candidates_by_street(
            on_route,
            canonical_index=canonical_index,
            street_line=street,
        )
        loc, match_err, match_detail = resolve_monthly_location_by_sheet_identity(
            at_address=narrowed,
            property_management_company_normalized=cid,
            label_normalized=sheet_label_key,
            street_display=street,
            company_display=company,
            label_display=label_display,
            match_basis="label",
            sheet_building_key=sheet_building_key,
            sheet_building_designators=sheet_building_designators,
        )
        if loc is not None or match_err in ("ambiguous", "duplicate"):
            return loc, match_err, match_detail

    at_address = lookup_locations_for_sheet_street(canonical_index, street)
    return resolve_monthly_location_by_sheet_identity(
        at_address=at_address,
        property_management_company_normalized=cid,
        label_normalized=sheet_building_key or sheet_label_key,
        street_display=street,
        company_display=company,
        label_display=building or street,
        match_basis="street",
        sheet_building_key=sheet_building_key,
        sheet_building_designators=sheet_building_designators,
    )


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
    label_index = load_locations_by_label()
    LOG.info(
        "Built canonical street index (%s distinct street keys) and label index (%s keys).",
        f"{len(canonical_index):,}",
        f"{len(label_index):,}",
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

        loc, match_err, match_detail = resolve_monthly_location_for_csv_row(
            canonical_index=canonical_index,
            label_index=label_index,
            monthly_route_id=int(route.id),
            street=street,
            building=building,
            company=company,
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

        stop_order = int(num_raw) - 1
        parsed = _parse_csv_row_fields(row, stop_order=stop_order)
        _apply_csv_row_to_location(
            loc=loc,
            parsed=parsed,
            building_name=building,
            route=route,
            month_date=month_date,
            run=run,
            result=result,
            logical_row=logical_row,
            now=now,
            sync_route_meta=sync_route_meta,
            sync_stop_order=sync_stop_order,
        )

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
