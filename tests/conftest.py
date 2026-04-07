import os

import pytest

from app import create_app
from app.db_models import db

os.environ.setdefault("SECRET_KEY", "pytest-secret")


@pytest.fixture
def test_app(monkeypatch):
    """Full app + in-memory SQLite schema (for tests that need tables)."""
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()

        db_url = app.config["SQLALCHEMY_DATABASE_URI"]
        if "sqlite:///:memory:" not in db_url:
            raise RuntimeError(f"Refusing to drop_all() on non-test DB: {db_url}")

        db.drop_all()


@pytest.fixture
def smoke_client(monkeypatch):
    """Lightweight client: no DB migrations (routes under test do not query)."""
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c
