"""Unit tests for monthly route classification (no DB)."""

from types import SimpleNamespace

from app.monthly.route_backfill import classify_monthly_locations


def test_classify_groups_route_number():
    locs = [
        SimpleNamespace(id=1, test_day="W1-R7"),
        SimpleNamespace(id=2, test_day="W1-R7"),
        SimpleNamespace(id=3, test_day="TH2-R15"),
    ]
    r = classify_monthly_locations(locs)
    assert set(r.buckets.keys()) == {7, 15}
    assert set(r.buckets[7].location_ids) == {1, 2}
    assert r.buckets[7].weekday_iso == 2  # Wednesday
    assert r.buckets[7].week_occurrence == 1


def test_cancelled_and_blank_skipped():
    locs = [
        SimpleNamespace(id=1, test_day="-"),
        SimpleNamespace(id=2, test_day=""),
        SimpleNamespace(id=3, test_day="   "),
    ]
    r = classify_monthly_locations(locs)
    assert r.buckets == {}
    assert len(r.cancelled_test_day_ids) == 1
    assert len(r.blank_test_day_ids) == 2


def test_pattern_conflict_excludes_bucket():
    locs = [
        SimpleNamespace(id=1, test_day="W1-R7"),
        SimpleNamespace(id=2, test_day="TH2-R7"),
    ]
    r = classify_monthly_locations(locs)
    assert 7 not in r.buckets
    assert len(r.pattern_conflict_msgs) == 1
