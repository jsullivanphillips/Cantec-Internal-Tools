"""Classify deficiencies as service-eligible or non-quoteable for Monday Meeting KPIs."""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.db_models import (
    Deficiency,
    DeficiencyNonQuoteablePhrase,
    DeficiencyServiceEligibility,
    QuoteDeficiencyLink,
    db,
)
from app.utils.business_days import business_days_between

PACIFIC_TZ = ZoneInfo("America/Vancouver")

STALE_CLUSTER_MIN_BUSINESS_DAYS = 90
STALE_CLUSTER_MIN_SIZE = 2
STALE_CLUSTER_JACCARD_THRESHOLD = 0.35
STALE_CLUSTER_MIN_SHARED_TOKENS = 2

STOPWORDS = frozenset(
    """
    a an and are as at be by for from has have he her hers him his i in is it its
    of on or she that the their them they this to was we were will with you your
    """.split()
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


def tokenize(text: str | None) -> set[str]:
    normalized = normalize_description(text)
    if not normalized:
        return set()
    tokens = re.findall(r"[a-z0-9]+", normalized)
    return {t for t in tokens if len(t) >= 3 and t not in STOPWORDS}


def phrase_matches(description: str | None, phrase: str) -> bool:
    normalized_desc = normalize_description(description)
    normalized_phrase = normalize_phrase(phrase)
    if not normalized_desc or not normalized_phrase:
        return False
    if len(normalized_phrase) <= WORD_BOUNDARY_PHRASE_MAX_LEN and normalized_phrase.isalnum():
        pattern = rf"\b{re.escape(normalized_phrase)}\b"
        return re.search(pattern, normalized_desc) is not None
    return normalized_phrase in normalized_desc


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union else 0.0


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[int, int] = {}

    def find(self, node: int) -> int:
        if node not in self.parent:
            self.parent[node] = node
        while self.parent[node] != node:
            self.parent[node] = self.parent[self.parent[node]]
            node = self.parent[node]
        return node

    def union(self, a: int, b: int) -> None:
        root_a = self.find(a)
        root_b = self.find(b)
        if root_a != root_b:
            self.parent[root_b] = root_a


def _to_pacific_date(dt: datetime | None) -> date | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(PACIFIC_TZ).date()


def _is_stale_unquoted(created_on: datetime | None, today: date) -> bool:
    created_date = _to_pacific_date(created_on)
    if created_date is None:
        return False
    return business_days_between(created_date, today) >= STALE_CLUSTER_MIN_BUSINESS_DAYS


def _load_active_phrases() -> list[tuple[str, str]]:
    rows = (
        DeficiencyNonQuoteablePhrase.query.filter(DeficiencyNonQuoteablePhrase.active.is_(True))
        .order_by(DeficiencyNonQuoteablePhrase.phrase)
        .all()
    )
    return [(row.phrase, row.label or row.phrase) for row in rows]


def _load_quoted_deficiency_ids() -> set[int]:
    rows = db.session.query(QuoteDeficiencyLink.deficiency_id).distinct().all()
    return {int(r[0]) for r in rows}


def _match_keyword(
    description: str | None, phrases: list[tuple[str, str]]
) -> tuple[str, str] | None:
    for phrase, label in phrases:
        if phrase_matches(description, phrase):
            return phrase, label
    return None


def build_similarity_clusters(
    deficiency_ids: list[int], tokens_by_id: dict[int, set[str]]
) -> dict[int, list[int]]:
    inverted: dict[str, list[int]] = defaultdict(list)
    for def_id, tokens in tokens_by_id.items():
        for token in tokens:
            inverted[token].append(def_id)

    uf = UnionFind()
    for def_id in deficiency_ids:
        uf.find(def_id)

    pair_counts: dict[tuple[int, int], int] = defaultdict(int)
    for members in inverted.values():
        if len(members) < 2:
            continue
        unique_members = sorted(set(members))
        for i, left in enumerate(unique_members):
            for right in unique_members[i + 1 :]:
                pair_counts[(left, right)] += 1

    for (left, right), shared in pair_counts.items():
        if shared < STALE_CLUSTER_MIN_SHARED_TOKENS:
            continue
        left_tokens = tokens_by_id.get(left, set())
        right_tokens = tokens_by_id.get(right, set())
        if jaccard(left_tokens, right_tokens) >= STALE_CLUSTER_JACCARD_THRESHOLD:
            uf.union(left, right)

    clusters: dict[int, list[int]] = defaultdict(list)
    for def_id in deficiency_ids:
        clusters[uf.find(def_id)].append(def_id)
    return dict(clusters)


def compute_eligibility_records(
    deficiencies: list[DeficiencyInput],
    phrases: list[tuple[str, str]],
    quoted_ids: set[int],
    *,
    today: date,
    classified_at: datetime,
) -> list[dict]:
    """Pure classification pass used by classify_all_deficiencies and unit tests."""
    keyword_excluded: dict[int, str] = {}
    tokens_by_id: dict[int, set[str]] = {}
    deficiency_by_id: dict[int, DeficiencyInput] = {}
    records: list[dict] = []

    for deficiency in deficiencies:
        def_id = int(deficiency.deficiency_id)
        deficiency_by_id[def_id] = deficiency
        desc_hash = description_hash(deficiency.description)

        match = _match_keyword(deficiency.description, phrases)
        if match is not None:
            keyword_excluded[def_id] = match[0]
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
            continue

        tokens = tokenize(deficiency.description)
        if tokens:
            tokens_by_id[def_id] = tokens

    clusterable_ids = sorted(tokens_by_id.keys())
    clusters = build_similarity_clusters(clusterable_ids, tokens_by_id)

    stale_excluded: set[int] = set()
    for members in clusters.values():
        if len(members) < STALE_CLUSTER_MIN_SIZE:
            continue
        if any(member in quoted_ids for member in members):
            continue
        cluster_key = f"cluster:{min(members)}"
        for member in members:
            deficiency = deficiency_by_id[member]
            if member in quoted_ids:
                continue
            if not _is_stale_unquoted(deficiency.deficiency_created_on, today):
                continue
            stale_excluded.add(member)
            records.append(
                {
                    "deficiency_id": member,
                    "eligible": False,
                    "reason": "stale_cluster",
                    "detail": cluster_key,
                    "description_hash": description_hash(deficiency.description),
                    "classified_at": classified_at,
                }
            )

    classified_ids = keyword_excluded.keys() | stale_excluded
    for deficiency in deficiencies:
        def_id = int(deficiency.deficiency_id)
        if def_id in classified_ids:
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


def _upsert_eligibility(
    deficiency_id: int,
    *,
    eligible: bool,
    reason: str,
    detail: str | None,
    desc_hash: str,
    classified_at: datetime,
) -> None:
    row = DeficiencyServiceEligibility.query.filter_by(deficiency_id=deficiency_id).first()
    if row is None:
        row = DeficiencyServiceEligibility(deficiency_id=deficiency_id)
    row.eligible = eligible
    row.reason = reason
    row.detail = detail
    row.description_hash = desc_hash
    row.classified_at = classified_at
    db.session.add(row)


def classify_all_deficiencies(*, commit: bool = True) -> dict:
    """
    Full reclassification pass: keyword denylist then stale similarity clusters.
    Returns summary counts for logging and admin UI.
    """
    classified_at = datetime.now(timezone.utc)
    today_pacific = datetime.now(PACIFIC_TZ).date()

    deficiencies = Deficiency.query.all()
    phrases = _load_active_phrases()
    quoted_ids = _load_quoted_deficiency_ids()

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
        quoted_ids,
        today=today_pacific,
        classified_at=classified_at,
    )
    for record in records:
        _upsert_eligibility(
            record["deficiency_id"],
            eligible=record["eligible"],
            reason=record["reason"],
            detail=record["detail"],
            desc_hash=record["description_hash"],
            classified_at=record["classified_at"],
        )

    if commit:
        db.session.commit()

    return summarize_eligibility_records(records, len(deficiencies), classified_at)
