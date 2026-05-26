from __future__ import annotations

from app.scripts.find_technician_pair_inspection_jobs import (
    job_has_technician_pair,
    job_to_result,
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


def test_job_to_result_includes_service_trade_job_link():
    result = job_to_result(
        {
            "id": 12345,
            "completedOn": 1_700_000_000,
            "customerName": "Example Customer",
            "location": {
                "name": "Example Location",
                "address": {"street": "123 Main St"},
            },
            "appointments": [{"techs": [{"name": "Seth Ealing"}]}],
        }
    )

    assert result["job_id"] == 12345
    assert result["job_link"] == "https://app.servicetrade.com/jobs/12345"
    assert result["customer"] == "Example Customer"
    assert result["location"] == "Example Location - 123 Main St"
    assert result["technicians"] == ["Seth Ealing"]
