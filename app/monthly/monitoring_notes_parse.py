"""Parse legacy monitoring_notes blocks (acct / company prose)."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class MonitoringNotesParsed:
    company: str | None = None
    acct: str | None = None
    phone: str | None = None
    signals: str | None = None
    password: str | None = None
    remainder_notes: str | None = None


_PROSE_ACCOUNT_HASH_RE = re.compile(r"^\s*account\s*#\s*(.+?)\s*$", re.I)
_PROSE_PASSWORD_RE = re.compile(
    r"^\s*(?:password\s*:\s*|password\s+is\s+|(?:pwd|passwd|pass)\s+is\s+)(.+)$",
    re.I,
)
_HEADER_RE = re.compile(
    r"^(COMPANY|SIGNALS|ACCT|ACCOUNT|PHONE|PASSWORD|PASS|PW)\s*:\s*(.*)$",
    re.I,
)


def _merge(prev: str | None, incoming: str) -> str:
    incoming = incoming.strip()
    if not incoming:
        return (prev or "").strip()
    if prev and prev.strip():
        return f"{prev.strip()}\n{incoming}"
    return incoming


def parse_monitoring_notes(raw: str | None) -> MonitoringNotesParsed:
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n")
    if not text.strip():
        return MonitoringNotesParsed()

    paragraphs = re.split(r"\n\s*\n+", text)
    structured_idx = -1
    for idx, para in enumerate(paragraphs):
        if _paragraph_has_structure(para):
            structured_idx = idx
            break
    if structured_idx < 0:
        return MonitoringNotesParsed(remainder_notes=text.strip() or None)

    before = "\n\n".join(p.strip() for p in paragraphs[:structured_idx] if p.strip()).strip()
    structured = paragraphs[structured_idx]
    after = "\n\n".join(p.strip() for p in paragraphs[structured_idx + 1 :] if p.strip()).strip()

    values: dict[str, str] = {}
    company_lines: list[str] = []
    trailing: list[str] = []
    phase = "company"

    has_colon_header = any(
        _HEADER_RE.match(line.strip()) for line in structured.split("\n") if line.strip()
    )
    if has_colon_header:
        for line in structured.split("\n"):
            stripped = line.strip()
            if not stripped:
                continue
            m = _HEADER_RE.match(stripped)
            if m:
                tag = m.group(1).upper()
                rest = m.group(2)
                key = {
                    "COMPANY": "company",
                    "SIGNALS": "signals",
                    "ACCT": "acct",
                    "ACCOUNT": "acct",
                    "PHONE": "phone",
                    "PASSWORD": "password",
                    "PASS": "password",
                    "PW": "password",
                }.get(tag)
                if key:
                    values[key] = _merge(values.get(key), rest)
                continue
            trailing.append(stripped)
    else:
        for line in structured.split("\n"):
            stripped = line.strip()
            if not stripped:
                continue
            acct_m = _PROSE_ACCOUNT_HASH_RE.match(stripped)
            if acct_m:
                values["acct"] = _merge(values.get("acct"), acct_m.group(1))
                phase = "after"
                continue
            pwd_m = _PROSE_PASSWORD_RE.match(stripped)
            if pwd_m:
                values["password"] = _merge(values.get("password"), pwd_m.group(1))
                phase = "after"
                continue
            if phase == "company":
                company_lines.append(stripped)
            else:
                trailing.append(stripped)
        if company_lines:
            values["company"] = "\n".join(company_lines)

    remainder_parts = [p for p in [before, after, "\n".join(trailing)] if p]
    remainder = "\n\n".join(remainder_parts).strip() or None

    return MonitoringNotesParsed(
        company=(values.get("company") or "").strip() or None,
        acct=(values.get("acct") or "").strip() or None,
        phone=(values.get("phone") or "").strip() or None,
        signals=(values.get("signals") or "").strip() or None,
        password=(values.get("password") or "").strip() or None,
        remainder_notes=remainder,
    )


def _paragraph_has_structure(paragraph: str) -> bool:
    for line in paragraph.split("\n"):
        if _HEADER_RE.match(line.strip()):
            return True
        if _PROSE_ACCOUNT_HASH_RE.match(line.strip()):
            return True
        if _PROSE_PASSWORD_RE.match(line.strip()):
            return True
    return False


def rebuild_monitoring_notes(parsed: MonitoringNotesParsed) -> str | None:
    parts: list[str] = []
    if parsed.signals:
        parts.append(f"SIGNALS: {parsed.signals}")
    if parsed.phone:
        parts.append(f"PHONE: {parsed.phone}")
    if parsed.remainder_notes:
        parts.append(parsed.remainder_notes.strip())
    joined = "\n\n".join(p for p in parts if p).strip()
    return joined or None
