"""Flask CLI helpers (run with: flask <command>)."""
from __future__ import annotations

import re
from urllib.parse import urlparse

from sqlalchemy import inspect, text

from app.db_models import db


def _mask_db_url(url: str | None) -> str:
    if not url:
        return "(DATABASE_URL not set)"
    try:
        p = urlparse(url)
        host = p.hostname or "?"
        dbn = (p.path or "").lstrip("/") or "?"
        if p.password:
            return f"{p.scheme}://{p.username}:***@{host}:{p.port or ''}/{dbn}"
        return f"{p.scheme}://{host}:{p.port or ''}/{dbn}"
    except Exception:
        return re.sub(r"://([^:/@]+):([^@]+)@", r"://\1:***@", url)


def register_cli_commands(app):
    @app.cli.command("db-sanity")
    def db_sanity():
        """Compare Postgres tables to SQLAlchemy models; show alembic_version."""
        with app.app_context():
            url = app.config.get("SQLALCHEMY_DATABASE_URI")
            print(f"Database (masked): {_mask_db_url(str(url) if url else None)}")
            try:
                insp = inspect(db.engine)
                existing = set(insp.get_table_names())
            except Exception as e:
                print(f"ERROR: cannot connect or inspect: {e}")
                return

            expected = sorted(db.metadata.tables.keys())
            missing = [t for t in expected if t not in existing]
            extra = sorted(existing - set(expected))

            try:
                row = db.session.execute(text("SELECT version_num FROM alembic_version")).fetchone()
                alembic_rev = row[0] if row else None
            except Exception:
                alembic_rev = None

            print(f"Alembic version in DB: {alembic_rev or '(no alembic_version row — never migrated here?)'}")
            print(f"Model tables expected: {len(expected)}")
            print(f"Tables present in DB:  {len(existing)}")
            if missing:
                print(
                    f"\nMISSING ({len(missing)}) - routes will error until these exist:"
                )
                for t in missing[:40]:
                    print(f"  - {t}")
                if len(missing) > 40:
                    print(f"  ... and {len(missing) - 40} more")
            else:
                print("\nAll model tables exist.")

            if extra and len(extra) <= 15:
                print(f"\nExtra tables (not in models): {', '.join(extra)}")

            if missing and alembic_rev:
                print(
                    "\n--- What this means ---\n"
                    "alembic_version is set, but most tables are missing. The React migration\n"
                    "did not cause this: the DB and Alembic are out of sync (wrong DB URL,\n"
                    "tables dropped, or `stamp` applied without running upgrades).\n"
                    "\nWhat to do:\n"
                    "  1) Confirm DATABASE_URL is the database you intend (same for `flask run`\n"
                    "     and `flask db upgrade`). Heroku/RDS: check config vars vs local .env.\n"
                    "  2) If this instance should hold your real data: restore from backup or\n"
                    "     point the app at the correct Postgres that still has the tables.\n"
                    "  3) If this DB is disposable (empty / test): you cannot rely on\n"
                    "     `flask db upgrade` alone if the first migrations expect existing\n"
                    "     tables. Typical recovery: create tables from models, then stamp head:\n"
                    "       flask shell\n"
                    "       >>> from app import create_app\n"
                    "       >>> from app.db_models import db\n"
                    "       >>> app = create_app()\n"
                    "       >>> with app.app_context(): db.create_all()\n"
                    "       >>> exit()\n"
                    "       flask db stamp head\n"
                    "     (Backup first; review with your team before doing this on shared DBs.)\n"
                )
            elif missing and not alembic_rev:
                print("\nTry: flask db upgrade\n")
