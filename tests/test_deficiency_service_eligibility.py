"""Tests for deficiency service eligibility classification."""

from datetime import date, datetime, timezone

from app.deficiency.service_eligibility import (
    DeficiencyInput,
    compute_eligibility_records,
    description_hash,
    jaccard,
    normalize_description,
    phrase_matches,
    summarize_eligibility_records,
    tally_phrase_matches,
    tokenize,
)


def _classify(
    deficiencies: list[DeficiencyInput],
    phrases: list[tuple[str, str]] | None = None,
    quoted_ids: set[int] | None = None,
    *,
    today: date = date(2026, 6, 16),
) -> list[dict]:
    classified_at = datetime(2026, 6, 16, 12, 0, tzinfo=timezone.utc)
    return compute_eligibility_records(
        deficiencies,
        phrases or [],
        quoted_ids or set(),
        today=today,
        classified_at=classified_at,
    )


def _by_id(records: list[dict]) -> dict[int, dict]:
    return {int(row["deficiency_id"]): row for row in records}


def test_phrase_matches_substring_and_word_boundary():
    assert phrase_matches("Site missing fire safety plan on file", "fire safety plan")
    assert phrase_matches("No FSP posted at panel", "fsp")
    assert not phrase_matches("Workshop panel missing screw", "fsp")


def test_tally_phrase_matches_counts_per_phrase_in_window():
    descriptions = [
        "Building has no fire safety plan",
        "No FSP posted at panel",
        "Missing monitoring company contact",
        "Another fire safety plan issue",
    ]
    counts = tally_phrase_matches(
        descriptions,
        ["fire safety plan", "fsp", "monitoring company"],
    )
    assert counts["fire safety plan"] == 2
    assert counts["fsp"] == 1
    assert counts["monitoring company"] == 1


def test_description_hash_changes_when_text_changes():
    first = description_hash("Missing monitoring company contact")
    second = description_hash("Missing monitoring company phone")
    assert first != second


def test_jaccard_similarity():
    left = tokenize("missing fire safety plan posted on site")
    right = tokenize("no fire safety plan available on site")
    assert jaccard(left, right) >= 0.35


def test_classify_keyword_exclusion():
    records = _classify(
        [
            DeficiencyInput(
                deficiency_id=1001,
                description="Building has no fire safety plan",
                deficiency_created_on=datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
        ],
        phrases=[("fire safety plan", "FSP")],
    )
    row = _by_id(records)[1001]
    summary = summarize_eligibility_records(records, 1, datetime.now(timezone.utc))

    assert summary["excluded_keyword"] == 1
    assert row["eligible"] is False
    assert row["reason"] == "keyword"
    assert row["detail"] == "fire safety plan"


def test_classify_stale_similarity_cluster():
    stale_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    records = _classify(
        [
            DeficiencyInput(
                deficiency_id=2001,
                description="monitoring company contact incorrect on file for site",
                deficiency_created_on=stale_date,
            ),
            DeficiencyInput(
                deficiency_id=2002,
                description="monitoring company contact wrong on file for site",
                deficiency_created_on=stale_date,
            ),
        ]
    )
    summary = summarize_eligibility_records(records, 2, datetime.now(timezone.utc))

    assert summary["excluded_stale_cluster"] == 2
    assert all(_by_id(records)[def_id]["reason"] == "stale_cluster" for def_id in (2001, 2002))


def test_cluster_member_quoted_immunizes_cluster():
    stale_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    records = _classify(
        [
            DeficiencyInput(
                deficiency_id=3001,
                description="smoke detector missing hallway unit 101",
                deficiency_created_on=stale_date,
            ),
            DeficiencyInput(
                deficiency_id=3002,
                description="smoke detector missing hallway unit 102",
                deficiency_created_on=stale_date,
            ),
        ],
        quoted_ids={3001},
    )
    rows = _by_id(records)
    summary = summarize_eligibility_records(records, 2, datetime.now(timezone.utc))

    assert summary["excluded_stale_cluster"] == 0
    assert rows[3001]["eligible"] is True
    assert rows[3002]["eligible"] is True


def test_single_stale_unquoted_stays_eligible():
    records = _classify(
        [
            DeficiencyInput(
                deficiency_id=4001,
                description="Unique standalone administrative note only here",
                deficiency_created_on=datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
        ]
    )
    row = _by_id(records)[4001]
    assert row["eligible"] is True
    assert row["reason"] == "eligible"


def test_get_deficiency_insights_excludes_non_quoteable(monkeypatch):
    from app.routes import performance_summary as ps

    base_filter = True

    class FakeQuery:
        def __init__(self, count_value: int):
            self._count_value = count_value

        def filter(self, *args, **kwargs):
            return self

        def outerjoin(self, *args, **kwargs):
            return self

        def join(self, *args, **kwargs):
            return self

        def count(self):
            return self._count_value

        def distinct(self):
            return self

    counts = iter([1, 0, 0, 0, 0, 1, 0])

    def fake_query(*args, **kwargs):
        return FakeQuery(next(counts))

    monkeypatch.setattr(ps.db.session, "query", fake_query)
    monkeypatch.setattr(
        ps,
        "and_",
        lambda *args, **kwargs: base_filter,
    )

    window_start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    window_end = datetime(2026, 12, 31, tzinfo=timezone.utc)
    result = ps.get_deficiency_insights(
        window_start,
        window_end,
        exclude_non_quoteable=True,
    )

    assert result["total_deficiencies"] == 1
    assert result["approved_deficiencies"] == 0
    assert result["excluded_non_quoteable"] == 1
    assert result["excluded_keyword"] == 1


def test_get_deficiency_insights_approved_of_quoted_pct(monkeypatch):
    from app.routes import performance_summary as ps

    class FakeQuery:
        def __init__(self, count_value: int):
            self._count_value = count_value

        def filter(self, *args, **kwargs):
            return self

        def outerjoin(self, *args, **kwargs):
            return self

        def join(self, *args, **kwargs):
            return self

        def count(self):
            return self._count_value

        def distinct(self):
            return self

    # total, quoted, approved, with_job, completed, keyword, stale_cluster
    counts = iter([10, 8, 6, 4, 2, 0, 0])

    monkeypatch.setattr(ps.db.session, "query", lambda *a, **k: FakeQuery(next(counts)))
    monkeypatch.setattr(ps, "and_", lambda *a, **k: True)

    result = ps.get_deficiency_insights(
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        datetime(2026, 3, 31, tzinfo=timezone.utc),
        exclude_inspection_jobs=True,
        exclude_non_quoteable=True,
    )

    assert result["quoted_deficiencies"] == 8
    assert result["approved_deficiencies"] == 6
    assert result["percentages"]["approved_of_quoted_pct"] == 75.0


def test_normalize_description_collapses_whitespace():
    assert normalize_description("  Fire   Safety   Plan  ") == "fire safety plan"


def test_get_excluded_non_quoteable_deficiencies(monkeypatch):
    from app.routes import performance_summary as ps

    class FakeDeficiency:
        deficiency_id = 9001
        description = "No fire safety plan on site"
        service_line = "Fire Alarm"
        reported_by = "Tech A"
        deficiency_created_on = datetime(2026, 6, 1, tzinfo=timezone.utc)

    class FakeEligibility:
        reason = "keyword"
        detail = "fire safety plan"

    monkeypatch.setattr(
        ps.db.session,
        "query",
        lambda *args, **kwargs: type(
            "Q",
            (),
            {
                "join": lambda self, *a, **k: self,
                "filter": lambda self, *a, **k: self,
                "order_by": lambda self, *a, **k: self,
                "all": lambda self: [(FakeDeficiency(), FakeEligibility())],
            },
        )(),
    )

    rows = ps.get_excluded_non_quoteable_deficiencies(
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        datetime(2026, 12, 31, tzinfo=timezone.utc),
    )
    assert len(rows) == 1
    assert rows[0]["deficiency_id"] == 9001
    assert rows[0]["reason"] == "keyword"
    assert "9001" in rows[0]["deficiency_url"]
