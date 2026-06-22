"""Classify deficiencies as service-eligible or non-quoteable for Monday Meeting KPIs."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import and_

from app.db_models import (
    Deficiency,
    DeficiencyNonQuoteablePhrase,
    DeficiencyServiceEligibility,
    db,
)


WORD_BOUNDARY_PHRASE_MAX_LEN = 4


@dataclass(frozen=True)
class DeficiencyInput:
    deficiency_id: int
    description: str | None
    deficiency_created_on: datetime | None


def normalize_description(text: str | None) -> str:
    if not text:
        return ""
    collapsed = re.sub(r"\s+", " ", text.strip().lower())
    return collapsed


def description_hash(text: str | None) -> str:
    normalized = normalize_description(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def normalize_phrase(phrase: str) -> str:
    return normalize_description(phrase)


def phrase_matches(description: str | None, phrase: str) -> bool:
    normalized_desc = normalize_description(description)
    normalized_phrase = normalize_phrase(phrase)
    if not normalized_desc or not normalized_phrase:
        return False
    if len(normalized_phrase) <= WORD_BOUNDARY_PHRASE_MAX_LEN and normalized_phrase.isalnum():
        pattern = rf"\b{re.escape(normalized_phrase)}\b"
        return re.search(pattern, normalized_desc) is not None
    return normalized_phrase in normalized_desc


def tally_phrase_matches(
    descriptions: Iterable[str | None],
    phrases: Iterable[str],
) -> dict[str, int]:
    """Count how many descriptions match each phrase (same rules as classification)."""
    phrase_list = list(phrases)
    counts = {phrase: 0 for phrase in phrase_list}
    for description in descriptions:
        for phrase in phrase_list:
            if phrase_matches(description, phrase):
                counts[phrase] += 1
    return counts


def count_phrase_matches_in_window(window_start: datetime, window_end: datetime) -> dict[str, int]:
    """Count phrase matches among deficiencies reported in the date window."""
    phrase_rows = DeficiencyNonQuoteablePhrase.query.order_by(
        DeficiencyNonQuoteablePhrase.phrase.asc()
    ).all()
    phrases = [row.phrase for row in phrase_rows]
    if not phrases:
        return {}

    descriptions = (
        db.session.query(Deficiency.description)
        .filter(
            and_(
                Deficiency.deficiency_created_on >= window_start,
                Deficiency.deficiency_created_on <= window_end,
            )
        )
        .all()
    )
    return tally_phrase_matches((row[0] for row in descriptions), phrases)


def _load_active_phrases() -> list[tuple[str, str]]:
    rows = (
        DeficiencyNonQuoteablePhrase.query.filter(DeficiencyNonQuoteablePhrase.active.is_(True))
        .order_by(DeficiencyNonQuoteablePhrase.phrase)
        .all()
    )
    return [(row.phrase, row.label or row.phrase) for row in rows]


def _match_keyword(
    description: str | None, phrases: list[tuple[str, str]]
) -> tuple[str, str] | None:
    for phrase, label in phrases:
        if phrase_matches(description, phrase):
            return phrase, label
    return None


def compute_eligibility_records(
    deficiencies: list[DeficiencyInput],
    phrases: list[tuple[str, str]],
    *,
    classified_at: datetime,
) -> list[dict]:
    """Pure classification pass used by classify_all_deficiencies and unit tests."""
    keyword_excluded: set[int] = set()
    records: list[dict] = []

    for deficiency in deficiencies:
        def_id = int(deficiency.deficiency_id)
        desc_hash = description_hash(deficiency.description)

        match = _match_keyword(deficiency.description, phrases)
        if match is not None:
            keyword_excluded.add(def_id)
            records.append(
                {
                    "deficiency_id": def_id,
                    "eligible": False,
                    "reason": "keyword",
                    "detail": match[0],
                    "description_hash": desc_hash,
                    "classified_at": classified_at,
                }
            )

    for deficiency in deficiencies:
        def_id = int(deficiency.deficiency_id)
        if def_id in keyword_excluded:
            continue
        records.append(
            {
                "deficiency_id": def_id,
                "eligible": True,
                "reason": "eligible",
                "detail": None,
                "description_hash": description_hash(deficiency.description),
                "classified_at": classified_at,
            }
        )

    return records


def summarize_eligibility_records(
    records: list[dict], total: int, classified_at: datetime
) -> dict:
    excluded_keyword = sum(1 for row in records if row["reason"] == "keyword")
    excluded_stale_cluster = sum(1 for row in records if row["reason"] == "stale_cluster")
    eligible = sum(1 for row in records if row["reason"] == "eligible")
    return {
        "total": total,
        "eligible": eligible,
        "excluded_keyword": excluded_keyword,
        "excluded_stale_cluster": excluded_stale_cluster,
        "excluded_non_quoteable": excluded_keyword + excluded_stale_cluster,
        "classified_at": classified_at.isoformat(),
    }


def classify_all_deficiencies(*, commit: bool = True) -> dict:
    """
    Full reclassification pass using the keyword denylist only.
    Returns summary counts for logging and admin UI.
    """
    classified_at = datetime.now(timezone.utc)

    deficiencies = Deficiency.query.all()
    phrases = _load_active_phrases()

    inputs = [
        DeficiencyInput(
            deficiency_id=int(row.deficiency_id),
            description=row.description,
            deficiency_created_on=row.deficiency_created_on,
        )
        for row in deficiencies
    ]
    records = compute_eligibility_records(
        inputs,
        phrases,
        classified_at=classified_at,
    )
    def_ids = [int(record["deficiency_id"]) for record in records]
    existing_by_id: dict[int, DeficiencyServiceEligibility] = {}
    if def_ids:
        existing_by_id = {
            row.deficiency_id: row
            for row in DeficiencyServiceEligibility.query.filter(
                DeficiencyServiceEligibility.deficiency_id.in_(def_ids)
            ).all()
        }
    for record in records:
        def_id = int(record["deficiency_id"])
        row = existing_by_id.get(def_id)
        if row is not None and row.included_override:
            continue
        if row is None:
            row = DeficiencyServiceEligibility(deficiency_id=def_id)
            db.session.add(row)
            existing_by_id[def_id] = row
        row.eligible = record["eligible"]
        row.reason = record["reason"]
        row.detail = record["detail"]
        row.description_hash = record["description_hash"]
        row.classified_at = record["classified_at"]
        row.included_override = False

    if commit:
        db.session.commit()

    return summarize_eligibility_records(records, len(deficiencies), classified_at)


def classify_single_deficiency(
    deficiency_id: int, *, commit: bool = True
) -> DeficiencyServiceEligibility | None:
    """Reclassify one deficiency and clear any manual include override."""
    deficiency = Deficiency.query.filter_by(deficiency_id=deficiency_id).first()
    if deficiency is None:
        return None

    classified_at = datetime.now(timezone.utc)
    phrases = _load_active_phrases()
    inputs = [
        DeficiencyInput(
            deficiency_id=int(deficiency.deficiency_id),
            description=deficiency.description,
            deficiency_created_on=deficiency.deficiency_created_on,
        )
    ]
    records = compute_eligibility_records(
        inputs,
        phrases,
        classified_at=classified_at,
    )
    record = records[0]
    row = DeficiencyServiceEligibility.query.get(deficiency_id)
    if row is None:
        row = DeficiencyServiceEligibility(deficiency_id=deficiency_id)
        db.session.add(row)
    row.eligible = record["eligible"]
    row.reason = record["reason"]
    row.detail = record["detail"]
    row.description_hash = record["description_hash"]
    row.classified_at = record["classified_at"]
    row.included_override = False
    if commit:
        db.session.commit()
    return row


def include_deficiency_override(
    deficiency_id: int, *, commit: bool = True
) -> DeficiencyServiceEligibility | None:
    """Persistently include an excluded deficiency in service KPIs."""
    row = DeficiencyServiceEligibility.query.get(deficiency_id)
    if row is None or row.eligible:
        return row
    row.eligible = True
    row.included_override = True
    row.classified_at = datetime.now(timezone.utc)
    if commit:
        db.session.commit()
    return row


def clear_deficiency_include_override(
    deficiency_id: int, *, commit: bool = True
) -> DeficiencyServiceEligibility | None:
    """Remove a manual include override and reclassify the deficiency."""
    row = DeficiencyServiceEligibility.query.get(deficiency_id)
    if row is None or not row.included_override:
        return classify_single_deficiency(deficiency_id, commit=commit)
    return classify_single_deficiency(deficiency_id, commit=commit)
