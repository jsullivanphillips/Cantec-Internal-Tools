import pytest
from app import create_app, db

@pytest.fixture
def test_app():
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()

        # 🛡️ Protect against real DB being wiped
        db_url = app.config["SQLALCHEMY_DATABASE_URI"]
        if "sqlite:///:memory:" not in db_url:
            raise RuntimeError(f"Refusing to drop_all() on non-test DB: {db_url}")

        db.drop_all()
