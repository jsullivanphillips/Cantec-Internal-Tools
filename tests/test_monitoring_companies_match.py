"""Monitoring company directory name matching."""

from __future__ import annotations

import pytest

from app import create_app
from app.db_models import MonitoringCompany, db
from app.monthly.monitoring_companies import find_active_monitoring_company_by_name


@pytest.fixture
def monitoring_match_app(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    tables = [MonitoringCompany.__table__]
    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def _seed(*names: str) -> None:
    for idx, name in enumerate(names, start=1):
        db.session.add(
            MonitoringCompany(
                id=idx,
                name=name,
                name_normalized=name.casefold(),
                active=True,
            )
        )
    db.session.commit()


def test_telus_matches_telus_security_directory(monitoring_match_app):
    with monitoring_match_app.app_context():
        _seed("Telus Security")
        matched = find_active_monitoring_company_by_name("Telus")
        assert matched is not None
        assert matched.name == "Telus Security"


def test_telus_security_matches_telus_directory(monitoring_match_app):
    with monitoring_match_app.app_context():
        _seed("Telus")
        matched = find_active_monitoring_company_by_name("Telus Security")
        assert matched is not None
        assert matched.name == "Telus"


def test_exact_match_preferred_when_multiple_telus_variants(monitoring_match_app):
    with monitoring_match_app.app_context():
        _seed("Telus", "Telus Security", "Telus Alarms")
        matched = find_active_monitoring_company_by_name("Telus")
        assert matched is not None
        assert matched.name == "Telus"


def test_protec_exact_match(monitoring_match_app):
    with monitoring_match_app.app_context():
        _seed("Protec", "Telus")
        matched = find_active_monitoring_company_by_name("Protec")
        assert matched is not None
        assert matched.name == "Protec"
