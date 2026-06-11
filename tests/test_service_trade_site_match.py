"""Tests for monthly ↔ ServiceTrade site location matching."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from app.monthly.service_trade_site_match import (
    build_street_index,
    monthly_location_street_key,
    normalize_street_match_key,
    propose_monthly_site_matches,
    service_trade_site_location_url,
    _lookup_keys_for_address,
)


@dataclass
class FakeMonthlyLocation:
    id: int
    address: str
    label: str = "Site"
    display_address: str | None = None
    property_management_company: str | None = None
    status_normalized: str = "active"
    service_trade_site_location_id: int | None = None
    monthly_route_id: int | None = None


def test_normalize_street_match_key():
    assert normalize_street_match_key("425 Michigan St, Victoria, BC") == "425 MICHIGAN"
    assert normalize_street_match_key("  12 O'Connor Ave ") == "12 O'CONNOR"
    assert normalize_street_match_key("1005 St. Charles Street") == "1005 CHARLES"
    assert normalize_street_match_key("1005 St Charles St") == "1005 CHARLES"
    assert normalize_street_match_key("") is None
    assert normalize_street_match_key("No number street") is None


def test_monthly_location_street_key_falls_back_to_display_address():
    assert monthly_location_street_key("", "100 Main St") == "100 MAIN"


def test_service_trade_site_location_url():
    url = service_trade_site_location_url(12345)
    assert url.endswith("/12345")


def test_propose_match_st_charles_street_variants():
    index = build_street_index(
        [
            {
                "id": 9001,
                "name": "St Charles",
                "address": {"street": "1005 St Charles St"},
            }
        ]
    )
    rows = [FakeMonthlyLocation(id=101, address="1005 St. Charles Street")]
    result = propose_monthly_site_matches(rows, index)
    assert len(result.proposed) == 1
    assert result.proposed[0].service_trade_location_id == 9001
    assert result.unmatched == []


def test_propose_match_dedupes_street_type_variants():
    index = build_street_index(
        [
            {"id": 9001, "name": "A", "address": {"street": "100 Main St"}},
            {"id": 9002, "name": "B", "address": {"street": "100 Main Street"}},
        ]
    )
    rows = [FakeMonthlyLocation(id=101, address="100 Main St")]
    result = propose_monthly_site_matches(rows, index)
    assert len(result.proposed) == 1
    assert result.proposed[0].service_trade_location_id == 9001
    assert result.unmatched == []


def test_propose_match_single_candidate():
    index = build_street_index(
        [
            {
                "id": 9001,
                "name": "Tower A",
                "address": {"street": "425 Michigan St"},
            }
        ]
    )
    rows = [FakeMonthlyLocation(id=101, address="425 Michigan St, Victoria")]
    result = propose_monthly_site_matches(rows, index)
    assert len(result.proposed) == 1
    assert result.proposed[0].monthly_location_id == 101
    assert result.proposed[0].service_trade_location_id == 9001
    assert result.unmatched == []
    assert result.conflicts == []


def test_propose_match_skips_multiple_candidates():
    index = build_street_index(
        [
            {"id": 9001, "name": "A", "address": {"street": "100 Main St"}},
            {"id": 9002, "name": "B", "address": {"street": "100 Main Ave"}},
        ]
    )
    rows = [FakeMonthlyLocation(id=101, address="100 Main")]
    result = propose_monthly_site_matches(rows, index)
    assert result.proposed == []
    assert len(result.unmatched) == 1
    assert result.unmatched[0].reason == "multiple_service_trade_candidates"
    assert result.unmatched[0].candidate_count == 2


def test_propose_match_skips_already_linked():
    index = build_street_index(
        [{"id": 9001, "name": "Tower", "address": {"street": "100 Main St"}}]
    )
    rows = [
        FakeMonthlyLocation(id=101, address="100 Main St", service_trade_site_location_id=555),
    ]
    result = propose_monthly_site_matches(rows, index)
    assert result.proposed == []
    assert result.skipped_already_linked == 1


def test_propose_match_conflict_when_st_id_already_used():
    index = build_street_index(
        [{"id": 9001, "name": "Tower", "address": {"street": "100 Main St"}}]
    )
    rows = [
        FakeMonthlyLocation(id=101, address="100 Main St", service_trade_site_location_id=9001),
        FakeMonthlyLocation(id=102, address="100 Main St"),
    ]
    result = propose_monthly_site_matches(rows, index)
    assert len(result.proposed) == 1
    assert result.proposed[0].monthly_location_id == 102
    assert result.proposed[0].service_trade_location_id == 9001
    assert result.skipped_already_linked == 1
    assert result.conflicts == []


def test_propose_match_two_monthly_share_one_st_id():
    index = build_street_index(
        [{"id": 9001, "name": "Tower", "address": {"street": "100 Main St"}}]
    )
    rows = [
        FakeMonthlyLocation(id=101, address="100 Main St"),
        FakeMonthlyLocation(id=102, address="100 Main Street"),
    ]
    result = propose_monthly_site_matches(rows, index)
    assert len(result.proposed) == 2
    assert {row.monthly_location_id for row in result.proposed} == {101, 102}
    assert all(row.service_trade_location_id == 9001 for row in result.proposed)
    assert result.conflicts == []
    assert result.unmatched == []


def test_propose_match_address_range():
    index = build_street_index(
        [{"id": 9001, "name": "Yates", "address": {"street": "1137 Yates St"}}]
    )
    rows = [FakeMonthlyLocation(id=101, address="1137-1139 Yates Street")]
    result = propose_monthly_site_matches(rows, index)
    assert len(result.proposed) == 1
    assert result.proposed[0].service_trade_location_id == 9001


def test_propose_match_directional_abbreviation():
    index = build_street_index(
        [{"id": 9001, "name": "Gorge", "address": {"street": "129 Gorge Road East"}}]
    )
    rows = [FakeMonthlyLocation(id=101, address="129 Gorge Road E")]
    result = propose_monthly_site_matches(rows, index)
    assert len(result.proposed) == 1
    assert result.proposed[0].service_trade_location_id == 9001


def test_propose_match_civic_letter_suffix():
    index = build_street_index(
        [{"id": 9001, "name": "Reynolds", "address": {"street": "1133 Reynolds Rd"}}]
    )
    rows = [FakeMonthlyLocation(id=101, address="1133A Reynolds Road")]
    result = propose_monthly_site_matches(rows, index)
    assert len(result.proposed) == 1
    assert result.proposed[0].service_trade_location_id == 9001


def test_normalize_street_match_key_directional():
    assert normalize_street_match_key("129 Gorge Road E") == "129 GORGE EAST"
    assert normalize_street_match_key("129 Gorge Road East") == "129 GORGE EAST"


def test_normalize_street_match_key_range():
    assert normalize_street_match_key("1137-1139 Yates Street") == "1137 YATES"
    assert normalize_street_match_key("331/333 Robert Street") == "331 ROBERT"
    keys = _lookup_keys_for_address("4480-4494 Chatterton Way")
    assert "4488 CHATTERTON" in keys


def test_propose_match_skips_cancelled():
    index = build_street_index(
        [{"id": 9001, "name": "Tower", "address": {"street": "100 Main St"}}]
    )
    rows = [FakeMonthlyLocation(id=101, address="100 Main St", status_normalized="cancelled")]
    result = propose_monthly_site_matches(rows, index)
    assert result.proposed == []
    assert result.skipped_inactive == 1
    assert result.unmatched == []


def test_propose_match_skips_non_active_statuses():
    index = build_street_index(
        [{"id": 9001, "name": "Tower", "address": {"street": "100 Main St"}}]
    )
    for status in ("on_hold", "waiting_keys", "unknown"):
        result = propose_monthly_site_matches(
            [FakeMonthlyLocation(id=101, address="100 Main St", status_normalized=status)],
            index,
        )
        assert result.proposed == []
        assert result.skipped_inactive == 1
        assert result.unmatched == []
