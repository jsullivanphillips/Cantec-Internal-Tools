"""
Normalize monthly spreadsheet KEYS text toward ``keys.keycode``.

Legacy suffixes (cabinet/rack/F-floor notation, etc.) are stripped so monthly
cells align with ``keys.keycode`` as the source of truth.
"""

from __future__ import annotations

import re

# Trailing bracket note e.g. ``[K2]``, ``[K2,F1]``.
_LEGACY_BRACKET_TAIL = re.compile(r"\s*\[[^\]]+\]\s*$")

# Trailing parenthetical e.g. ``(K2)``.
_LEGACY_PAREN_TAIL = re.compile(r"\s*\([^)]*\)\s*$")

# ``433 F-1`` style floor marker after the keycode.
_LEGACY_FLOOR_F = re.compile(r"\s+F-\d+\s*$", re.IGNORECASE)

# ``K7``, ``K1-F1``, ``K6-G1``, ``K2w``, ``K5lrg+7sm`` — legacy tail after base keycode.
_LEGACY_K_TAIL = re.compile(
    r"\s+K\d+(?:-[FG]\d+)?(?:[a-zA-Z0-9+.-]+)?\s*$",
    re.IGNORECASE,
)

_STRIP_PASS = (
    _LEGACY_BRACKET_TAIL,
    _LEGACY_PAREN_TAIL,
    _LEGACY_FLOOR_F,
    _LEGACY_K_TAIL,
)

# Spreadsheet sentinels meaning “no physical key” — not a real keycode (do not join to ``keys``).
_NO_KEY_PHRASES_CF = frozenset(
    {
        "no keys",
        "no key",
        "none",
        "n/a",
        "na",
        "on site",
        "key at front desk",
        "no keys - contact on site",
    }
)

# Access-instruction prefixes (call/contact site — not a physical keycode).
_NO_KEY_PREFIXES_CF = (
    "call ",
    "contact ",
)


def monthly_keys_field_indicates_no_key(raw: str | None) -> bool:
    """
    True when the monthly KEYS column is empty or uses a dash / phrase meaning
    there is no key for this site.

    Prevents accidental joins to placeholder ``keys`` rows whose ``keycode`` is
    literally ``\"-\"`` or ``\"No keys\"``.
    """
    text = " ".join((raw or "").strip().split())
    if not text:
        return True
    if text in ("-", "–", "—"):
        return True
    cf = text.casefold()
    if cf in _NO_KEY_PHRASES_CF:
        return True
    return any(cf.startswith(prefix) for prefix in _NO_KEY_PREFIXES_CF)


def canonical_keycode_from_monthly_keys_field(raw: str | None) -> str:
    """
    Return trimmed text with trailing legacy segments removed.

    Result should be compared to ``keys.keycode`` using the same case/spacing
    normalization you use elsewhere (e.g. casefold + collapse spaces).
    """
    text = " ".join((raw or "").strip().split())
    if not text:
        return ""
    if monthly_keys_field_indicates_no_key(raw):
        return ""
    prev = None
    while prev != text:
        prev = text
        for pat in _STRIP_PASS:
            text = pat.sub("", text).strip()
    return text
