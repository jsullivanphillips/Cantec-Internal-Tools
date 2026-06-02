"""Unit tests for prep-phase prior-month visit order hints."""

from __future__ import annotations

from app.monthly.prep_insights import _out_of_order_from_visit_rank


def test_out_of_order_expected_stop_numbers():
    stops = [
        {"testing_site_id": 1, "stop_number": 1},
        {"testing_site_id": 2, "stop_number": 2},
        {"testing_site_id": 3, "stop_number": 3},
    ]
    visit_rank = {1: 1, 2: 3, 3: 2}
    out_ids = _out_of_order_from_visit_rank(stops, visit_rank)
    assert out_ids == {2, 3}

    route_ordered = sorted(
        (int(s["testing_site_id"]), int(s.get("stop_number") or 0)) for s in stops
    )
    route_ordered.sort(key=lambda pair: pair[1])
    route_rank = {tid: idx + 1 for idx, (tid, _) in enumerate(route_ordered)}
    expected = {tid: route_rank[tid] for tid in out_ids if tid in route_rank}
    assert expected == {2: 2, 3: 3}
