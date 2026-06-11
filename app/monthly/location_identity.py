"""Normalize monthly location identity fields (address + PMC + label)."""

from __future__ import annotations


def normalize_identity_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip().casefold()


def normalize_address(value: object) -> str:
    return normalize_identity_text(value)


def normalize_pmc(value: object) -> str:
    return normalize_identity_text(value)


def normalize_label(value: object) -> str:
    return normalize_identity_text(value)


def identity_key(address: object, pmc: object, label: object) -> tuple[str, str, str]:
    return (
        normalize_address(address),
        normalize_pmc(pmc),
        normalize_label(label),
    )
