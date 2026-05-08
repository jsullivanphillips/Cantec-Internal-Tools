"""Add monthly_route_run and per-run snapshot columns on monthly_route_test_history.

Promotes a route execution to a first-class "Run" entity and turns history rows
into per-run snapshots for technician-editable fields. Backfills runs from the
existing ``(test_monthly_route_id or location.monthly_route_id, month_date)``
pairs and copies current ``MonthlyRouteLocation`` values into the new history
snapshot columns so old months stay faithful to what was true at that time.

Revision ID: o4d5e6f7a8b9
Revises: n3c4d5e6f7a8
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "o4d5e6f7a8b9"
down_revision = "n3c4d5e6f7a8"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def _has_fk(table_name: str, fk_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any((fk.get("name") or "") == fk_name for fk in insp.get_foreign_keys(table_name))


def upgrade():
    if not _has_table("monthly_route_run"):
        op.create_table(
            "monthly_route_run",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("monthly_route_id", sa.BigInteger(), nullable=False),
            sa.Column("month_date", sa.Date(), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
            sa.Column(
                "source",
                sa.String(length=32),
                nullable=False,
                server_default="technician_app",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.ForeignKeyConstraint(
                ["monthly_route_id"], ["monthly_route.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "monthly_route_id",
                "month_date",
                name="uq_monthly_route_run_route_month",
            ),
        )
        op.create_index(
            "ix_monthly_route_run_monthly_route_id",
            "monthly_route_run",
            ["monthly_route_id"],
            unique=False,
        )
        op.create_index(
            "ix_monthly_route_run_month_date",
            "monthly_route_run",
            ["month_date"],
            unique=False,
        )

    snapshot_cols = [
        ("facp", sa.String(length=255)),
        ("ring", sa.String(length=255)),
        ("key_number", sa.String(length=255)),
        ("annual_month", sa.String(length=32)),
    ]
    for col_name, col_type in snapshot_cols:
        if not _has_column("monthly_route_test_history", col_name):
            op.add_column(
                "monthly_route_test_history",
                sa.Column(col_name, col_type, nullable=True),
            )

    if not _has_column("monthly_route_test_history", "run_id"):
        op.add_column(
            "monthly_route_test_history",
            sa.Column("run_id", sa.BigInteger(), nullable=True),
        )
        op.create_index(
            "ix_monthly_route_test_history_run_id",
            "monthly_route_test_history",
            ["run_id"],
            unique=False,
        )
    if not _has_fk("monthly_route_test_history", "fk_monthly_route_test_history_run_id"):
        op.create_foreign_key(
            "fk_monthly_route_test_history_run_id",
            "monthly_route_test_history",
            "monthly_route_run",
            ["run_id"],
            ["id"],
            ondelete="SET NULL",
        )

    bind = op.get_bind()
    dialect = getattr(getattr(bind, "dialect", None), "name", "") or ""

    if dialect == "postgresql":
        op.execute(
            sa.text(
                """
                INSERT INTO monthly_route_run
                    (monthly_route_id, month_date, started_at, status, source,
                     created_at, updated_at)
                SELECT DISTINCT
                    COALESCE(h.test_monthly_route_id, loc.monthly_route_id) AS rid,
                    h.month_date,
                    NULL::timestamptz AS started_at,
                    'open' AS status,
                    'csv_import' AS source,
                    now(),
                    now()
                FROM monthly_route_test_history h
                JOIN monthly_route_location loc ON loc.id = h.location_id
                WHERE COALESCE(h.test_monthly_route_id, loc.monthly_route_id) IS NOT NULL
                ON CONFLICT (monthly_route_id, month_date) DO NOTHING;
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE monthly_route_test_history h
                SET run_id = r.id
                FROM monthly_route_run r,
                     monthly_route_location loc
                WHERE h.location_id = loc.id
                  AND r.monthly_route_id = COALESCE(h.test_monthly_route_id, loc.monthly_route_id)
                  AND r.month_date = h.month_date
                  AND h.run_id IS NULL;
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE monthly_route_test_history h
                SET facp = COALESCE(h.facp, loc.facp_detail),
                    ring = COALESCE(h.ring, loc.ring_detail),
                    key_number = COALESCE(h.key_number, loc.keys),
                    annual_month = COALESCE(h.annual_month, loc.annual_month)
                FROM monthly_route_location loc
                WHERE loc.id = h.location_id;
                """
            )
        )
    else:
        # SQLite / other dialects: portable Python-side backfill for tests.
        history_table = sa.table(
            "monthly_route_test_history",
            sa.column("id", sa.BigInteger),
            sa.column("location_id", sa.BigInteger),
            sa.column("month_date", sa.Date),
            sa.column("test_monthly_route_id", sa.BigInteger),
            sa.column("run_id", sa.BigInteger),
            sa.column("facp", sa.String),
            sa.column("ring", sa.String),
            sa.column("key_number", sa.String),
            sa.column("annual_month", sa.String),
        )
        location_table = sa.table(
            "monthly_route_location",
            sa.column("id", sa.BigInteger),
            sa.column("monthly_route_id", sa.BigInteger),
            sa.column("facp_detail", sa.String),
            sa.column("ring_detail", sa.String),
            sa.column("keys", sa.String),
            sa.column("annual_month", sa.String),
        )
        run_table = sa.table(
            "monthly_route_run",
            sa.column("id", sa.BigInteger),
            sa.column("monthly_route_id", sa.BigInteger),
            sa.column("month_date", sa.Date),
            sa.column("status", sa.String),
            sa.column("source", sa.String),
        )
        rows = bind.execute(
            sa.select(
                history_table.c.id,
                history_table.c.location_id,
                history_table.c.month_date,
                history_table.c.test_monthly_route_id,
                history_table.c.run_id,
                location_table.c.monthly_route_id.label("loc_route_id"),
                location_table.c.facp_detail,
                location_table.c.ring_detail,
                location_table.c.keys,
                location_table.c.annual_month.label("loc_annual_month"),
            ).select_from(
                history_table.join(
                    location_table, history_table.c.location_id == location_table.c.id
                )
            )
        ).fetchall()
        seen_runs: dict[tuple[int, object], int] = {}
        existing_runs = bind.execute(
            sa.select(run_table.c.id, run_table.c.monthly_route_id, run_table.c.month_date)
        ).fetchall()
        for r in existing_runs:
            seen_runs[(int(r.monthly_route_id), r.month_date)] = int(r.id)
        for r in rows:
            rid = r.test_monthly_route_id or r.loc_route_id
            if rid is None:
                continue
            key = (int(rid), r.month_date)
            if key not in seen_runs:
                ins = bind.execute(
                    run_table.insert().values(
                        monthly_route_id=int(rid),
                        month_date=r.month_date,
                        status="open",
                        source="csv_import",
                    )
                )
                seen_runs[key] = int(ins.inserted_primary_key[0])
            bind.execute(
                history_table.update()
                .where(history_table.c.id == r.id)
                .values(
                    run_id=seen_runs[key] if r.run_id is None else r.run_id,
                    facp=r.facp_detail,
                    ring=r.ring_detail,
                    key_number=r.keys,
                    annual_month=r.loc_annual_month,
                )
            )


def downgrade():
    if _has_fk("monthly_route_test_history", "fk_monthly_route_test_history_run_id"):
        op.drop_constraint(
            "fk_monthly_route_test_history_run_id",
            "monthly_route_test_history",
            type_="foreignkey",
        )
    if _has_column("monthly_route_test_history", "run_id"):
        try:
            op.drop_index(
                "ix_monthly_route_test_history_run_id",
                table_name="monthly_route_test_history",
            )
        except Exception:
            pass
        op.drop_column("monthly_route_test_history", "run_id")

    for col_name in ("annual_month", "key_number", "ring", "facp"):
        if _has_column("monthly_route_test_history", col_name):
            op.drop_column("monthly_route_test_history", col_name)

    if _has_table("monthly_route_run"):
        try:
            op.drop_index("ix_monthly_route_run_month_date", table_name="monthly_route_run")
        except Exception:
            pass
        try:
            op.drop_index(
                "ix_monthly_route_run_monthly_route_id", table_name="monthly_route_run"
            )
        except Exception:
            pass
        op.drop_table("monthly_route_run")
