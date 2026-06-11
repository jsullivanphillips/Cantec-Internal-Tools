import json

import pytest
from sqlalchemy.exc import IntegrityError

from app import create_app
from app.db_models import (
    MonitoringCompany,
    MonthlyLocation,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteCalculatedPath,
    db,
)
from tests.monthly_location_helpers import make_location
from app.monthly.mapbox_routes import calculated_path_payload


@pytest.fixture
def route_map_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = [
        MonitoringCompany.__table__,
        MonthlyRoute.__table__,
        MonthlyLocation.__table__,
        MonthlyLocationMonth.__table__,
        MonthlyRouteCalculatedPath.__table__,
    ]
    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "route.map"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def _seed_route_with_locations() -> None:
    route = MonthlyRoute(id=1, route_number=4, weekday_iso=0, week_occurrence=1)
    locs = [
        make_location(
            id=101,
            address="100 Test St",
            property_management_company="PM",
            property_management_company_normalized="pm",
            monthly_route_id=1,
            route_stop_order=0,
            latitude=48.42,
            longitude=-123.36,
        ),
        make_location(
            id=102,
            address="200 Test St",
            property_management_company="PM",
            property_management_company_normalized="pm",
            monthly_route_id=1,
            route_stop_order=1,
            latitude=48.43,
            longitude=-123.37,
        ),
    ]
    db.session.add(route)
    db.session.add_all(locs)
    db.session.commit()


class _DirectionsResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(
            {
                "routes": [
                    {
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[-123.36, 48.42], [-123.37, 48.43]],
                        },
                        "distance": 1234.5,
                        "duration": 456.7,
                    }
                ]
            }
        ).encode("utf-8")


def test_calculated_path_persists_and_reuses_cache(route_map_client, monkeypatch):
    _client, app = route_map_client
    calls = {"count": 0}

    def fake_urlopen(_req, timeout):
        assert timeout == 15
        calls["count"] += 1
        return _DirectionsResponse()

    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "test-token")
    monkeypatch.setattr("app.monthly.mapbox_routes.url_request.urlopen", fake_urlopen)

    with app.app_context():
        _seed_route_with_locations()
        first = calculated_path_payload(1)
        assert first["status"] == "ok"
        assert first["cache_status"] == "miss"
        assert first["distance_meters"] == 1234.5
        assert MonthlyRouteCalculatedPath.query.count() == 1

        second = calculated_path_payload(1)
        assert second["status"] == "ok"
        assert second["cache_status"] == "hit"
        assert calls["count"] == 1


def test_changed_stop_order_recalculates_from_signature(route_map_client, monkeypatch):
    _client, app = route_map_client
    calls = {"count": 0}

    def fake_urlopen(_req, timeout):
        calls["count"] += 1
        return _DirectionsResponse()

    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "test-token")
    monkeypatch.setattr("app.monthly.mapbox_routes.url_request.urlopen", fake_urlopen)

    with app.app_context():
        _seed_route_with_locations()
        first = calculated_path_payload(1)
        loc_a = db.session.get(MonthlyLocation, 101)
        loc_b = db.session.get(MonthlyLocation, 102)
        loc_a.route_stop_order = 1
        loc_b.route_stop_order = 0
        db.session.commit()

        second = calculated_path_payload(1)
        assert second["cache_status"] == "miss"
        assert second["stop_signature"] != first["stop_signature"]
        assert calls["count"] == 2


def test_missing_mapbox_token_returns_unavailable_state(route_map_client, monkeypatch):
    _client, app = route_map_client
    monkeypatch.delenv("MAPBOX_ACCESS_TOKEN", raising=False)

    with app.app_context():
        _seed_route_with_locations()
        payload = calculated_path_payload(1)
        assert payload["status"] == "mapbox_token_missing"
        assert payload["geometry"] is None
        assert MonthlyRouteCalculatedPath.query.count() == 0


def test_location_order_endpoint_invalidates_cached_path(route_map_client):
    client, app = route_map_client
    with app.app_context():
        _seed_route_with_locations()
        db.session.add(
            MonthlyRouteCalculatedPath(
                monthly_route_id=1,
                profile="driving",
                provider="mapbox",
                stop_signature="old",
                geometry_geojson={"type": "LineString", "coordinates": [[-123.36, 48.42], [-123.37, 48.43]]},
                distance_meters=1,
                duration_seconds=1,
                waypoint_count=2,
            )
        )
        db.session.commit()
        assert MonthlyRouteCalculatedPath.query.count() == 1

    response = client.put(
        "/api/monthly_routes/routes/1/location_order",
        json={"ordered_location_ids": [102, 101]},
    )
    assert response.status_code == 200

    with app.app_context():
        assert MonthlyRouteCalculatedPath.query.count() == 0


def test_calculated_path_recovers_when_parallel_request_inserted_cache(route_map_client, monkeypatch):
    _client, app = route_map_client

    def fake_urlopen(_req, timeout):
        return _DirectionsResponse()

    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "test-token")
    monkeypatch.setattr("app.monthly.mapbox_routes.url_request.urlopen", fake_urlopen)

    with app.app_context():
        _seed_route_with_locations()
        real_commit = db.session.commit
        first_commit = {"pending": True}

        def flaky_commit():
            if first_commit["pending"]:
                first_commit["pending"] = False
                with db.engine.begin() as conn:
                    conn.execute(
                        MonthlyRouteCalculatedPath.__table__.insert().values(
                            monthly_route_id=1,
                            profile="driving",
                            provider="mapbox",
                            stop_signature="parallel-request",
                            geometry_geojson={
                                "type": "LineString",
                                "coordinates": [[-123.36, 48.42], [-123.37, 48.43]],
                            },
                            distance_meters=1,
                            duration_seconds=1,
                            waypoint_count=2,
                        )
                    )
                raise IntegrityError("insert", {}, Exception("duplicate"))
            return real_commit()

        monkeypatch.setattr(db.session, "commit", flaky_commit)

        payload = calculated_path_payload(1)
        assert payload["status"] == "ok"
        assert MonthlyRouteCalculatedPath.query.count() == 1
        cache = MonthlyRouteCalculatedPath.query.one()
        assert cache.stop_signature == payload["stop_signature"]
        assert cache.distance_meters == 1234.5
