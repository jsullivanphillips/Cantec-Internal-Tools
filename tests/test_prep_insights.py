"""Unit tests for prep-phase prior-month visit order hints."""

from __future__ import annotations

from datetime import date

from app.monthly.prep_insights import (
    _out_of_order_from_visit_rank,
    _tested_after_address_for_out_of_order,
    compute_prior_month_new_to_route_site_ids,
    site_ids_out_of_order_resolved_by_library_order,
)


def test_out_of_order_tested_after_addresses():
    stops = [
        {"testing_site_id": 1, "stop_number": 1, "display_address": "100 Main St"},
        {"testing_site_id": 2, "stop_number": 2, "display_address": "200 Oak Ave"},
        {"testing_site_id": 3, "stop_number": 3, "display_address": "300 Pine Rd"},
    ]
    visit_rank = {1: 1, 2: 3, 3: 2}
    out_ids = _out_of_order_from_visit_rank(stops, visit_rank)
    assert out_ids == {2, 3}

    tested_after = _tested_after_address_for_out_of_order(stops, visit_rank, out_ids)
    assert tested_after == {2: "300 Pine Rd", 3: "100 Main St"}


def test_new_to_route_site_ids_no_prior_ids(monkeypatch):
    from app.monthly import prep_insights

    monkeypatch.setattr(
        prep_insights,
        "_prior_month_route_testing_site_ids",
        lambda _route_id, _month: None,
    )
    assert compute_prior_month_new_to_route_site_ids(1, date(2026, 6, 1), [1, 2]) == set()


def test_new_to_route_site_ids_filters_missing(monkeypatch):
    from app.monthly import prep_insights

    monkeypatch.setattr(
        prep_insights,
        "_prior_month_route_testing_site_ids",
        lambda _route_id, _month: {10, 20},
    )
    assert compute_prior_month_new_to_route_site_ids(1, date(2026, 6, 1), [10, 30]) == {30}


def test_out_of_order_resolved_when_placed_after_tested_after_address(monkeypatch):
    from app.monthly import prep_insights

    stops = [
        {
            "testing_site_id": 1,
            "location_id": 101,
            "stop_number": 1,
            "display_address": "100 Main St",
        },
        {
            "testing_site_id": 2,
            "location_id": 102,
            "stop_number": 2,
            "display_address": "524 Culdesac Road",
        },
    ]
    visit_rank = {1: 2, 2: 1}

    class _Loc:
        def __init__(self, lid: int, address: str):
            self.id = lid
            self.display_address = address
            self.address = address

    class _Query:
        def filter(self, *_args, **_kwargs):
            return self

        def all(self):
            return [_Loc(101, "100 Main St"), _Loc(102, "524 Culdesac Road")]

    monkeypatch.setattr(
        prep_insights,
        "_prior_month_visit_context",
        lambda _route_id, _month: (stops, visit_rank),
    )
    class _IdCol:
        @staticmethod
        def in_(_ids):
            return _ids

    class _MRL:
        query = _Query()
        id = _IdCol

    monkeypatch.setattr(prep_insights, "MonthlyRouteLocation", _MRL)

    resolved = site_ids_out_of_order_resolved_by_library_order(1, date(2026, 6, 1), [102, 101])
    assert resolved == {1}
    assert site_ids_out_of_order_resolved_by_library_order(1, date(2026, 6, 1), [101, 102]) == set()
