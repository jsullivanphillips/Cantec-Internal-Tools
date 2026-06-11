"""Rebuild legacy_orm_migration.py from git HEAD db_models."""
from pathlib import Path
import subprocess

text = subprocess.check_output(["git", "show", "HEAD:app/db_models.py"], text=True)
start = text.index("class MonthlyRouteLocation")
end = text.index("LOCATION_TICKET_STATUSES")
header = '''"""Legacy ORM models retained only for one-time flat-location data migration."""

from __future__ import annotations

from app.db_models import JSONB, db

'''
Path("app/monthly/legacy_orm_migration.py").write_text(header + text[start:end], encoding="utf-8")
print("ok", len(text[start:end]))
