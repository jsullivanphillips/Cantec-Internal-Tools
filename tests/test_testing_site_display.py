"""Tests for testing site display label helpers."""

from __future__ import annotations

from app.monthly import testing_site_display as tsd
from app.db_models import MonthlyRouteLocation, MonthlyTestingSite


def _loc(**kwargs) -> MonthlyRouteLocation:
    defaults = {
        "id": 1,
        "address": "2471 Sidney Ave",
        "display_address": "2471 Sidney Ave",
    }
    defaults.update(kwargs)
    return MonthlyRouteLocation(**defaults)


def _ts(**kwargs) -> MonthlyTestingSite:
    defaults = {"id": 10, "monthly_site_id": 1, "sort_order": 0}
    defaults.update(kwargs)
    return MonthlyTestingSite(**defaults)


def test_single_site_null_label_uses_billing_address():
    loc = _loc()
    ts = _ts(label=None)
    assert tsd.testing_site_primary_label(ts, loc, site_count=1) == "2471 Sidney Ave"
    assert tsd.testing_site_billing_subline("2471 Sidney Ave", loc) is None


def test_single_site_label_differs_from_address_shows_subline():
    loc = _loc()
    ts = _ts(label="9838 Second Street")
    primary = tsd.testing_site_primary_label(ts, loc, site_count=2, site_index=1)
    assert primary == "9838 Second Street"
    assert tsd.testing_site_billing_subline(primary, loc) == "2471 Sidney Ave"


def test_multi_site_empty_label_falls_back_to_testing_site_n():
    loc = _loc()
    ts = _ts(label=None, sort_order=1)
    assert tsd.testing_site_primary_label(ts, loc, site_count=2, site_index=1) == "Testing site 2"


def test_enrich_stop_display_fields():
    loc = _loc()
    ts = _ts(label="9838 Second Street")
    stop: dict = {"display_address": "2471 Sidney Ave", "label": "9838 Second Street"}
    tsd.enrich_stop_display_fields(stop, ts, loc, site_count=2, site_index=1)
    assert stop["primary_label"] == "9838 Second Street"
    assert stop["billing_address_subline"] == "2471 Sidney Ave"


def test_location_row_display_labels_single_site():
    loc = _loc()
    ts = _ts(label=None)
    title, labels = tsd.location_row_display_labels(loc, [ts])
    assert title == "2471 Sidney Ave"
    assert labels is None


def test_location_row_display_labels_multi_site():
    loc = _loc()
    ts1 = _ts(id=10, label="2471 Sidney Ave", sort_order=0)
    ts2 = _ts(id=11, label="9838 Second Street", sort_order=1)
    title, labels = tsd.location_row_display_labels(loc, [ts1, ts2])
    assert title == "2471 Sidney Ave"
    assert labels == ["2471 Sidney Ave", "9838 Second Street"]
