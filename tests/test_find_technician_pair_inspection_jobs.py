from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

from app.scripts.find_technician_pair_inspection_jobs import (
    category_codes_for_row,
    category_totals,
    completed_on_range_unix,
    job_has_technician_pair,
    job_to_result,
    service_categories_for_texts,
    technician_names_for_job,
)


def test_job_has_technician_pair_matches_names_case_insensitively():
    job = {
        "appointments": [
            {"techs": [{"name": "seth ealing"}]},
            {"techs": [{"name": "  Korby   Odegaard  "}]},
        ]
    }

    assert job_has_technician_pair(job, "Seth Ealing", "Korby Odegaard") is True


def test_job_has_technician_pair_requires_both_technicians():
    job = {"appointments": [{"techs": [{"name": "Seth Ealing"}]}]}

    assert job_has_technician_pair(job, "Seth Ealing", "Korby Odegaard") is False


def test_technician_names_for_job_deduplicates_display_names():
    job = {
        "appointments": [
            {"techs": [{"name": "Seth Ealing"}, {"name": "Korby Odegaard"}]},
            {"techs": [{"name": "Seth Ealing"}]},
        ]
    }

    assert technician_names_for_job(job) == {"Seth Ealing", "Korby Odegaard"}


def test_job_to_result_includes_inspection_date_address_and_categories():
    result = job_to_result(
        {
            "id": 12345,
            "completedOn": 1_700_000_000,
            "customerName": "Example Customer",
            "location": {
                "name": "Example Location",
                "address": {
                    "street": "123 Main St",
                    "city": "Victoria",
                    "state": "BC",
                    "postalCode": "V8V 1A1",
                },
            },
            "appointments": [{"techs": [{"name": "Seth Ealing"}]}],
        },
        ["Annual Fire Alarm Inspection"],
    )

    assert result == {
        "inspection_date": "2023-11-14",
        "address": "123 Main St, Victoria, BC, V8V 1A1",
        "categories": ["fire_alarm"],
        "service_descriptions": ["Annual Fire Alarm Inspection"],
    }


def test_service_categories_for_texts_can_match_multiple_reference_groups():
    assert service_categories_for_texts(["Extinguisher and emergency light annual inspection"]) == ["ext", "elu"]
    assert service_categories_for_texts(["Annual Fire Alarm inspection"]) == ["fire_alarm"]
    assert service_categories_for_texts(["General inspection"]) == ["unknown"]


def test_category_codes_and_totals_use_report_labels():
    rows = [
        {"categories": ["ext", "fire_alarm", "elu"]},
        {"categories": ["fire_alarm"]},
        {"categories": ["unknown"]},
    ]

    assert category_codes_for_row(rows[0]) == ["FE", "FA", "ELU"]
    assert category_totals(rows) == {
        "FA": 2,
        "ELU": 1,
        "EXT": 1,
    }


def test_completed_on_range_unix_uses_full_local_days():
    begin, end = completed_on_range_unix("2025-01-01", "2026-12-31", "America/Vancouver")
    tz = ZoneInfo("America/Vancouver")

    assert begin == int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=tz).timestamp())
    assert end == int(datetime.combine(datetime(2026, 12, 31).date(), time.max.replace(microsecond=0), tzinfo=tz).timestamp())
