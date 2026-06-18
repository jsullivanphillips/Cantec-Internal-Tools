"""Tests for monthly library location tags."""

from __future__ import annotations

import pytest

from app import create_app
from app.db_models import db
from app.monthly.monthly_location_tags import (
    MAX_MONTHLY_LOCATION_TAGS,
    MAX_MONTHLY_LOCATION_TAG_LENGTH,
    normalize_monthly_location_tags,
    set_location_tags,
    tags_from_location,
)
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, []),
        ([], []),
        ([" High-rise ", "high-rise", "Devon"], ["High-rise", "Devon"]),
        (["  "], []),
    ],
)
def test_normalize_monthly_location_tags(raw, expected):
    assert normalize_monthly_location_tags(raw) == expected


def test_normalize_monthly_location_tags_rejects_invalid_payload():
    with pytest.raises(ValueError, match="invalid_tags"):
        normalize_monthly_location_tags("not-a-list")
    with pytest.raises(ValueError, match="invalid_tags"):
        normalize_monthly_location_tags([1, 2])


def test_normalize_monthly_location_tags_rejects_too_long():
    with pytest.raises(ValueError, match="tag_too_long"):
        normalize_monthly_location_tags(["x" * (MAX_MONTHLY_LOCATION_TAG_LENGTH + 1)])


def test_normalize_monthly_location_tags_rejects_too_many():
    tags = [f"tag-{i}" for i in range(MAX_MONTHLY_LOCATION_TAGS + 1)]
    with pytest.raises(ValueError, match="too_many_tags"):
        normalize_monthly_location_tags(tags)


def test_tags_from_location_and_set_location_tags():
    loc = make_location(id=1, address="100 Test Ave", label="Tower")
    assert tags_from_location(loc) == []
    set_location_tags(loc, ["Alpha", "Beta"])
    assert loc.tags_json == ["Alpha", "Beta"]
    assert tags_from_location(loc) == ["Alpha", "Beta"]
    set_location_tags(loc, [])
    assert loc.tags_json is None
    assert tags_from_location(loc) == []


@pytest.fixture
def location_tags_client(monkeypatch, tmp_path):
    db_file = tmp_path / "location_tags.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "staff"
                sess["authenticated"] = True
            yield client
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def _seed_location() -> int:
    loc = make_location(
        id=42,
        address="100 Test Ave",
        label="Tower A",
        property_management_company="PMC",
    )
    db.session.add(loc)
    db.session.commit()
    return int(loc.id)


def test_library_patch_tags_round_trip(location_tags_client):
    location_id = _seed_location()
    client = location_tags_client

    patch = client.patch(
        f"/api/monthly_routes/library/{location_id}",
        json={"tags": ["High-rise", "Key on site"]},
    )
    assert patch.status_code == 200
    assert patch.get_json()["location"]["tags"] == ["High-rise", "Key on site"]

    detail = client.get(f"/api/monthly_routes/library/{location_id}")
    assert detail.status_code == 200
    assert detail.get_json()["location"]["tags"] == ["High-rise", "Key on site"]

    listing = client.get("/api/monthly_routes/library?include_history=false&unpaginated=true")
    assert listing.status_code == 200
    rows = listing.get_json()["locations"]
    row = next(item for item in rows if item["id"] == location_id)
    assert row["tags"] == ["High-rise", "Key on site"]


def test_library_patch_tags_clear(location_tags_client):
    location_id = _seed_location()
    client = location_tags_client

    client.patch(
        f"/api/monthly_routes/library/{location_id}",
        json={"tags": ["One"]},
    )
    cleared = client.patch(
        f"/api/monthly_routes/library/{location_id}",
        json={"tags": []},
    )
    assert cleared.status_code == 200
    assert cleared.get_json()["location"]["tags"] == []


def test_library_patch_tags_validation_errors(location_tags_client):
    location_id = _seed_location()
    client = location_tags_client

    too_long = client.patch(
        f"/api/monthly_routes/library/{location_id}",
        json={"tags": ["x" * (MAX_MONTHLY_LOCATION_TAG_LENGTH + 1)]},
    )
    assert too_long.status_code == 400
    body = too_long.get_json()
    assert body["code"] == "tag_too_long"

    too_many = client.patch(
        f"/api/monthly_routes/library/{location_id}",
        json={"tags": [f"t-{i}" for i in range(MAX_MONTHLY_LOCATION_TAGS + 1)]},
    )
    assert too_many.status_code == 400
    assert too_many.get_json()["code"] == "too_many_tags"

    invalid = client.patch(
        f"/api/monthly_routes/library/{location_id}",
        json={"tags": "nope"},
    )
    assert invalid.status_code == 400
    assert invalid.get_json()["code"] == "invalid_tags"


def test_set_location_tags_persists_json_array():
    loc = make_location(id=99, address="200 New Street", label="New Tower")
    set_location_tags(loc, normalize_monthly_location_tags(["Portfolio A"]))
    assert loc.tags_json == ["Portfolio A"]
    assert tags_from_location(loc) == ["Portfolio A"]


def _seed_tagged_locations() -> tuple[int, int, int]:
    alpha = make_location(id=51, address="1 Alpha Ave", label="Alpha Site")
    beta = make_location(id=52, address="2 Beta Blvd", label="Beta Site")
    plain = make_location(id=53, address="3 Plain Pl", label="Plain Site")
    set_location_tags(alpha, ["High-rise", "Portfolio"])
    set_location_tags(beta, ["Portfolio"])
    db.session.add_all([alpha, beta, plain])
    db.session.commit()
    return int(alpha.id), int(beta.id), int(plain.id)


def test_library_tag_options_endpoint(location_tags_client):
    _seed_tagged_locations()
    client = location_tags_client

    res = client.get("/api/monthly_routes/library/tag_options")
    assert res.status_code == 200
    assert res.get_json()["tags"] == ["High-rise", "Portfolio"]


def test_library_list_filters_by_tag_and_exclude_tag(location_tags_client):
    alpha_id, beta_id, plain_id = _seed_tagged_locations()
    client = location_tags_client

    include = client.get("/api/monthly_routes/library?include_history=false&unpaginated=true&tag=High-rise")
    assert include.status_code == 200
    include_ids = {row["id"] for row in include.get_json()["locations"]}
    assert include_ids == {alpha_id}

    portfolio = client.get("/api/monthly_routes/library?include_history=false&unpaginated=true&tag=Portfolio")
    assert {row["id"] for row in portfolio.get_json()["locations"]} == {alpha_id, beta_id}

    exclude = client.get(
        "/api/monthly_routes/library?include_history=false&unpaginated=true&exclude_tag=Portfolio"
    )
    assert {row["id"] for row in exclude.get_json()["locations"]} == {plain_id}

    both = client.get(
        "/api/monthly_routes/library?include_history=false&unpaginated=true"
        "&tag=Portfolio&exclude_tag=High-rise"
    )
    assert {row["id"] for row in both.get_json()["locations"]} == {beta_id}

    multi_include = client.get(
        "/api/monthly_routes/library?include_history=false&unpaginated=true"
        "&tag=High-rise&tag=Portfolio"
    )
    assert {row["id"] for row in multi_include.get_json()["locations"]} == {alpha_id, beta_id}

    multi_exclude = client.get(
        "/api/monthly_routes/library?include_history=false&unpaginated=true"
        "&exclude_tag=High-rise&exclude_tag=Portfolio"
    )
    assert {row["id"] for row in multi_exclude.get_json()["locations"]} == {plain_id}


def test_library_list_tag_filter_tolerates_scalar_tags_json(location_tags_client):
    """Rows with non-array tags_json must not break tag search (PostgreSQL jsonb_array_elements)."""
    scalar = make_location(id=60, address="60 Scalar St", label="Scalar")
    scalar.tags_json = "Devon"
    valid = make_location(id=61, address="61 Valid Ave", label="Valid")
    set_location_tags(valid, ["Devon"])
    db.session.add_all([scalar, valid])
    db.session.commit()
    client = location_tags_client

    res = client.get("/api/monthly_routes/library?include_history=false&unpaginated=true&tag=Devon")
    assert res.status_code == 200
    assert {row["id"] for row in res.get_json()["locations"]} == {61}
