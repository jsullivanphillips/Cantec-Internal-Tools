"""Monthly KEYS column canonicalization (legacy suffix stripping)."""

from app.monthly.monthly_keys_keycode import (
    canonical_keycode_from_monthly_keys_field,
    monthly_keys_field_indicates_no_key,
)
from app.monthly.test_day import monthly_test_day_is_cancelled


def test_strip_k_suffix_and_bracket():
    assert canonical_keycode_from_monthly_keys_field("PP 823 K7") == "PP 823"
    assert canonical_keycode_from_monthly_keys_field("B 881 K4-F1") == "B 881"
    assert canonical_keycode_from_monthly_keys_field("CJ 5551 [K2]") == "CJ 5551"
    assert canonical_keycode_from_monthly_keys_field("SP 401 K1-F1") == "SP 401"


def test_strip_extended_legacy_report_examples():
    """Regression: remaining canonical mismatches from migration readiness report."""
    assert canonical_keycode_from_monthly_keys_field("IW 5111 K6-G1") == "IW 5111"
    assert canonical_keycode_from_monthly_keys_field("AQ 512 [K2,F1]") == "AQ 512"
    assert canonical_keycode_from_monthly_keys_field("GT 1122 K2w") == "GT 1122"
    assert canonical_keycode_from_monthly_keys_field("433 F-1") == "433"
    assert canonical_keycode_from_monthly_keys_field("G 7723 K5lrg+7sm") == "G 7723"
    assert canonical_keycode_from_monthly_keys_field("MPW 366 K8-G1") == "MPW 366"
    assert canonical_keycode_from_monthly_keys_field("385 (K2)") == "385"


def test_cancelled_marker():
    assert monthly_test_day_is_cancelled("-") is True
    assert monthly_test_day_is_cancelled(" – ") is True  # en-dash
    assert monthly_test_day_is_cancelled("") is False
    assert monthly_test_day_is_cancelled("W1-R7") is False


def test_no_key_sentinels_not_keycodes():
    assert monthly_keys_field_indicates_no_key("-") is True
    assert monthly_keys_field_indicates_no_key("No keys") is True
    assert monthly_keys_field_indicates_no_key("  NO KEY  ") is True
    assert monthly_keys_field_indicates_no_key("") is True
    assert monthly_keys_field_indicates_no_key("PP 823") is False


def test_canonical_empty_for_no_key_sentinel():
    assert canonical_keycode_from_monthly_keys_field("-") == ""
    assert canonical_keycode_from_monthly_keys_field("No keys") == ""
