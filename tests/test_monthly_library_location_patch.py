"""Library location detail GET/PATCH field round-trip."""

from __future__ import annotations

import pytest

from app import create_app
from app.db_models import MonitoringCompany, MonthlyLocation, db
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location


@pytest.fixture
def library_detail_client(monkeypatch, tmp_path):
    db_file = tmp_path / "library_detail_patch.db"
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


def _monitoring_company(*, id: int, name: str) -> MonitoringCompany:
    return MonitoringCompany(
        id=id,
        name=name,
        name_normalized=name.casefold(),
        active=True,
    )


def _seed_location(**extra) -> int:
    loc = make_location(
        id=42,
        address="100 Test Ave",
        label="Tower A",
        property_management_company="PMC Co",
        property_management_company_normalized="pmc co",
        ring_detail="Ring 1",
        **extra,
    )
    db.session.add(loc)
    db.session.commit()
    return int(loc.id)


def test_library_get_detail_includes_master_fields(library_detail_client):
    mc = _monitoring_company(id=7, name="Guardian Monitoring")
    db.session.add(mc)
    loc_id = _seed_location(
        panel_location="Basement electrical",
        door_code="1234",
        monitoring_company_id=7,
        monitoring_account_number="ACC-99",
        monitoring_password="secret",
        monitoring_notes="Call first",
        facp_detail="Notifier NFS2",
        panel="Notifier NFS2",
    )

    res = library_detail_client.get(f"/api/monthly_routes/library/{loc_id}")
    assert res.status_code == 200
    body = res.get_json()
    loc = body["location"]
    assert loc["ring_detail"] == "Ring 1"
    assert loc["panel_location"] == "Basement electrical"
    assert loc["door_code"] == "1234"
    assert loc["facp_detail"] == "Notifier NFS2"
    assert loc["panel"] == "Notifier NFS2"
    assert loc["monitoring_company_id"] == 7
    assert loc["monitoring_company"]["name"] == "Guardian Monitoring"
    assert loc["monitoring_account_number"] == "ACC-99"
    assert loc["monitoring_password"] == "secret"
    assert loc["monitoring_notes"] == "Call first"


@pytest.mark.parametrize(
    "patch_body,expected_attr,expected_value",
    [
        ({"ring_detail": "Ring B"}, "ring_detail", "Ring B"),
        ({"ring": "Ring C"}, "ring_detail", "Ring C"),
        ({"panel_location": "Lobby"}, "panel_location", "Lobby"),
        ({"door_code": "5678"}, "door_code", "5678"),
        ({"monitoring_account_number": "ACC-1"}, "monitoring_account_number", "ACC-1"),
        ({"monitoring_password": "pw"}, "monitoring_password", "pw"),
        ({"panel": "Simplex 4100"}, "facp_detail", "Simplex 4100"),
    ],
)
def test_library_patch_master_fields_persist(
    library_detail_client, patch_body, expected_attr, expected_value
):
    loc_id = _seed_location()
    res = library_detail_client.patch(
        f"/api/monthly_routes/library/{loc_id}",
        json=patch_body,
    )
    assert res.status_code == 200
    loc_payload = res.get_json()["location"]
    assert loc_payload[expected_attr if expected_attr != "facp_detail" else "facp_detail"] == expected_value
    if expected_attr == "facp_detail":
        assert loc_payload["panel"] == expected_value

    row = db.session.get(MonthlyLocation, loc_id)
    assert getattr(row, expected_attr) == expected_value
    if expected_attr == "facp_detail":
        assert row.panel == expected_value


def test_library_patch_monitoring_company_id(library_detail_client):
    mc = _monitoring_company(id=3, name="Central Station")
    db.session.add(mc)
    loc_id = _seed_location()

    res = library_detail_client.patch(
        f"/api/monthly_routes/library/{loc_id}",
        json={"monitoring_company_id": 3},
    )
    assert res.status_code == 200
    loc = res.get_json()["location"]
    assert loc["monitoring_company_id"] == 3
    assert loc["monitoring_company"]["name"] == "Central Station"

    clear = library_detail_client.patch(
        f"/api/monthly_routes/library/{loc_id}",
        json={"monitoring_company_id": None},
    )
    assert clear.status_code == 200
    assert clear.get_json()["location"]["monitoring_company_id"] is None


def test_library_patch_invalid_monitoring_company_id_returns_400(library_detail_client):
    loc_id = _seed_location()
    res = library_detail_client.patch(
        f"/api/monthly_routes/library/{loc_id}",
        json={"monitoring_company_id": 99999},
    )
    assert res.status_code == 400
    assert "monitoring company" in res.get_json()["error"].lower()


def test_library_patch_address_with_geocode_coordinates(library_detail_client):
    loc_id = _seed_location()
    res = library_detail_client.patch(
        f"/api/monthly_routes/library/{loc_id}",
        json={
            "address": "1234 Douglas St, Victoria, BC",
            "display_address": "1234 Douglas Street, Victoria, British Columbia V8W 2B7, Canada",
            "latitude": 48.4284,
            "longitude": -123.3656,
        },
    )
    assert res.status_code == 200
    loc = res.get_json()["location"]
    assert loc["address"] == "1234 Douglas St, Victoria, BC"
    assert loc["display_address"] == "1234 Douglas Street, Victoria, British Columbia V8W 2B7, Canada"
    assert loc["latitude"] == pytest.approx(48.4284)
    assert loc["longitude"] == pytest.approx(-123.3656)

    row = db.session.get(MonthlyLocation, loc_id)
    assert row.address == "1234 Douglas St, Victoria, BC"
    assert row.display_address == "1234 Douglas Street, Victoria, British Columbia V8W 2B7, Canada"
    assert row.latitude == pytest.approx(48.4284)
    assert row.longitude == pytest.approx(-123.3656)


def test_library_patch_building_name(library_detail_client):
    loc_id = _seed_location()
    res = library_detail_client.patch(
        f"/api/monthly_routes/library/{loc_id}",
        json={"building_name": "Seaport Place"},
    )
    assert res.status_code == 200
    assert res.get_json()["location"]["building_name"] == "Seaport Place"

    row = db.session.get(MonthlyLocation, loc_id)
    assert row.building_name == "Seaport Place"
