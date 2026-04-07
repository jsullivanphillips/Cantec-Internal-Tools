# app/__init__.py
import os
from flask import Flask
from flask_migrate import Migrate
from app.config import Config
from app.routes import register_blueprints
from app.api_auth_gate import register_api_session_auth
from app.spa import register_spa_static_routes, send_spa_index
from app.utils.logger import setup_logging
from app.db_models import db
from app.cli_commands import register_cli_commands
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))
migrate = Migrate()


def _refuse_debug_against_production_db(app: Flask) -> None:
    """
    Opt-in guard: if FLASK_DEBUG is on and DATABASE_URL contains the substring
    DEV_BLOCK_DATABASE_URL_CONTAINING, abort startup. Set that env var to a
    fragment unique to your production host or DB name so local dev never
    accidentally hits prod again.
    """
    if os.environ.get("FLASK_DEBUG") not in ("1", "true", "True"):
        return
    needle = (os.environ.get("DEV_BLOCK_DATABASE_URL_CONTAINING") or "").strip()
    if not needle:
        return
    uri = app.config.get("SQLALCHEMY_DATABASE_URI") or ""
    if needle in uri:
        raise RuntimeError(
            f"Refusing to start with FLASK_DEBUG: DATABASE_URL contains {needle!r}. "
            "Use a local or staging database for development, or remove "
            "DEV_BLOCK_DATABASE_URL_CONTAINING from the environment."
        )


def create_app():
    # Templates live next to the app package (empty unless you add Jinja later).
    # No repo-root static/: SPA assets are frontend/dist + routes in app/spa.py.
    pkg_dir = os.path.dirname(__file__)
    template_path = os.path.join(pkg_dir, 'templates')
    app = Flask(
        __name__,
        template_folder=template_path,
        static_folder=None,
        static_url_path=None,
    )
    app.config.from_object(Config)
    app.secret_key = Config.SECRET_KEY
    database_url = os.environ.get("DATABASE_URL")
    if database_url and database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    _refuse_debug_against_production_db(app)
    db.init_app(app)
    migrate.init_app(app, db)
    register_cli_commands(app)
    setup_logging(app)
    register_blueprints(app)
    register_api_session_auth(app)
    register_spa_static_routes(app)

    @app.get("/")
    def spa_root():
        return send_spa_index()

    return app
