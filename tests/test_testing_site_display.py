"""Tests for flat monthly location display label helpers."""

from __future__ import annotations

from app.db_models import MonthlyLocation
from app.monthly import location_display as ld
from app.monthly import testing_site_display as tsd


def _loc(**kwargs) -> MonthlyLocation:
    defaults = {
        "id": 1,
        "address": "2471 Sidney Ave",
        "address_normalized": "2471 sidney ave",
        "label": "2471 Sidney Ave",
        "label_normalized": "2471 sidney ave",
        "property_management_company_normalized": "",
        "display_address": "2471 Sidney Ave",
    }
    defaults.update(kwargs)
    return MonthlyLocation(**defaults)


def test_empty_label_uses_billing_address():
    loc = _loc(label="", label_normalized="")
    assert ld.location_primary_label(loc) == "2471 Sidney Ave"
    assert ld.location_billing_subline("2471 Sidney Ave", loc) is None


def test_label_differs_from_address_shows_subline():
    loc = _loc(label="9838 Second Street", label_normalized="9838 second street")
    primary = ld.location_primary_label(loc)
    assert primary == "9838 Second Street"
    assert ld.location_billing_subline(primary, loc) == "2471 Sidney Ave"


def test_enrich_location_display_fields():
    loc = _loc(label="9838 Second Street", label_normalized="9838 second street")
    stop: dict = {"display_address": "2471 Sidney Ave", "label": "9838 Second Street"}
    ld.enrich_location_display_fields(stop, loc)
    assert stop["primary_label"] == "9838 Second Street"
    assert stop["billing_address_subline"] == "2471 Sidney Ave"


def test_location_row_display_labels_flat():
    loc = _loc()
    title, labels = ld.location_row_display_labels(loc)
    assert title == "2471 Sidney Ave"
    assert labels is None


def test_compat_wrapper_preserves_legacy_imports():
    loc = _loc(label="9838 Second Street", label_normalized="9838 second street")
    stop: dict = {"display_address": "2471 Sidney Ave", "label": "9838 Second Street"}
    tsd.enrich_stop_display_fields(stop, loc)
    assert stop["primary_label"] == "9838 Second Street"
