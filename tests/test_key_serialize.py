"""Linked key UI status serialization."""

from __future__ import annotations

from app.db_models import Key, KeyStatus


def test_compute_key_ui_fields_signed_out():
    from app.monthly.key_serialize import compute_key_ui_fields

    key = Key(id=1, keycode="ABC 1", home_location="Office")
    key.statuses = [
        KeyStatus(key_id=1, status="Signed Out", key_location="Jamie"),
    ]
    ui = compute_key_ui_fields(key)
    assert ui["is_out"] is True
    assert ui["is_in"] is False
    assert ui["current_loc"] == "Jamie"


def test_compute_key_ui_fields_at_home():
    from app.monthly.key_serialize import compute_key_ui_fields

    key = Key(id=2, keycode="ABC 2", home_location="Office")
    key.statuses = [
        KeyStatus(key_id=2, status="Returned", key_location="Office"),
    ]
    ui = compute_key_ui_fields(key)
    assert ui["is_out"] is False
    assert ui["is_in"] is True


def test_serialize_linked_key_summary_includes_ui_when_requested():
    from app.monthly.key_serialize import serialize_linked_key_summary

    key = Key(id=3, keycode="ABC 3", home_location="R7")
    key.statuses = [
        KeyStatus(key_id=3, status="Signed Out", key_location="Tech van"),
    ]
    payload = serialize_linked_key_summary(key, include_status=True)
    assert payload is not None
    assert payload["keycode"] == "ABC 3"
    assert payload["ui"]["is_out"] is True
