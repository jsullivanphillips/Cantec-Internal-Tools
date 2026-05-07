"""Monthly inspection: monitoring directory/proposals, location sheet fields, revision log.

Revision ID: f8e9a0b1c2d3
Revises: d1e2f3a4b5c6

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "f8e9a0b1c2d3"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def _json_value_type():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def _has_index(table_name: str, index_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(i["name"] == index_name for i in insp.get_indexes(table_name))


def _has_fk(table_name: str, fk_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(fk.get("name") == fk_name for fk in insp.get_foreign_keys(table_name))


def _has_check(table_name: str, check_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    checks = insp.get_check_constraints(table_name)
    return any(c.get("name") == check_name for c in checks)


def upgrade():
    json_type = _json_value_type()

    if not _has_table("monitoring_company"):
        op.create_table(
            "monitoring_company",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("name_normalized", sa.String(length=255), nullable=False),
            sa.Column("primary_phone", sa.String(length=64), nullable=True),
            sa.Column("secondary_phone", sa.String(length=64), nullable=True),
            sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("monitoring_company", "ix_monitoring_company_name_normalized"):
        op.create_index(
            "ix_monitoring_company_name_normalized",
            "monitoring_company",
            ["name_normalized"],
            unique=False,
        )

    if not _has_table("monitoring_company_proposal"):
        op.create_table(
            "monitoring_company_proposal",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("proposed_name", sa.String(length=255), nullable=False),
            sa.Column("proposed_name_normalized", sa.String(length=255), nullable=False),
            sa.Column("proposed_primary_phone", sa.String(length=64), nullable=True),
            sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
            sa.Column("submitted_by_name", sa.String(length=255), nullable=True),
            sa.Column("route_session_id", sa.BigInteger(), nullable=True),
            sa.Column("resulting_monitoring_company_id", sa.BigInteger(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("resolved_by_username", sa.String(length=255), nullable=True),
            sa.ForeignKeyConstraint(
                ["resulting_monitoring_company_id"],
                ["monitoring_company.id"],
                name="fk_monitoring_company_proposal_resulting_company_id",
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("monitoring_company_proposal", "ix_monitoring_company_proposal_status"):
        op.create_index(
            "ix_monitoring_company_proposal_status",
            "monitoring_company_proposal",
            ["status"],
            unique=False,
        )
    if not _has_index("monitoring_company_proposal", "ix_monitoring_company_proposal_name_normalized"):
        op.create_index(
            "ix_monitoring_company_proposal_name_normalized",
            "monitoring_company_proposal",
            ["proposed_name_normalized"],
            unique=False,
        )
    if not _has_index("monitoring_company_proposal", "ix_monitoring_company_proposal_route_session_id"):
        op.create_index(
            "ix_monitoring_company_proposal_route_session_id",
            "monitoring_company_proposal",
            ["route_session_id"],
            unique=False,
        )
    if not _has_index(
        "monitoring_company_proposal",
        "ix_monitoring_company_proposal_resulting_monitoring_company_id",
    ):
        op.create_index(
            "ix_monitoring_company_proposal_resulting_monitoring_company_id",
            "monitoring_company_proposal",
            ["resulting_monitoring_company_id"],
            unique=False,
        )

    monthly_location_new_cols = [
        ("monitoring_company_id", sa.BigInteger()),
        ("pending_monitoring_company_proposal_id", sa.BigInteger()),
        ("annual_month_pending", sa.String(length=64)),
        ("annual_month_pending_submitted_at", sa.DateTime(timezone=True)),
        ("annual_month_pending_submitted_by_name", sa.String(length=255)),
        ("ring_detail", sa.Text()),
        ("facp_detail", sa.Text()),
        ("testing_procedures", sa.Text()),
        ("inspection_tech_notes", sa.Text()),
    ]
    for col_name, col_type in monthly_location_new_cols:
        if not _has_column("monthly_route_location", col_name):
            op.add_column("monthly_route_location", sa.Column(col_name, col_type, nullable=True))

    if not _has_fk("monthly_route_location", "fk_monthly_route_location_monitoring_company_id"):
        op.create_foreign_key(
            "fk_monthly_route_location_monitoring_company_id",
            "monthly_route_location",
            "monitoring_company",
            ["monitoring_company_id"],
            ["id"],
            ondelete="SET NULL",
        )
    # PostgreSQL identifier limit is 63 chars; keep FK/index names short.
    _fk_mrl_pending_prop = "fk_mrl_pending_mon_prop_id"
    _ix_mrl_pending_prop = "ix_mrl_pending_mon_prop_id"

    if not _has_fk("monthly_route_location", _fk_mrl_pending_prop):
        op.create_foreign_key(
            _fk_mrl_pending_prop,
            "monthly_route_location",
            "monitoring_company_proposal",
            ["pending_monitoring_company_proposal_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if not _has_index("monthly_route_location", "ix_monthly_route_location_monitoring_company_id"):
        op.create_index(
            "ix_monthly_route_location_monitoring_company_id",
            "monthly_route_location",
            ["monitoring_company_id"],
            unique=False,
        )
    if not _has_index("monthly_route_location", _ix_mrl_pending_prop):
        op.create_index(
            _ix_mrl_pending_prop,
            "monthly_route_location",
            ["pending_monitoring_company_proposal_id"],
            unique=False,
        )

    if not _has_check("monthly_route_location", "ck_mrl_monitoring_company_xor_pending_proposal"):
        op.create_check_constraint(
            "ck_mrl_monitoring_company_xor_pending_proposal",
            "monthly_route_location",
            "(monitoring_company_id IS NULL OR pending_monitoring_company_proposal_id IS NULL)",
        )

    if not _has_table("monthly_route_location_inspection_revision"):
        op.create_table(
            "monthly_route_location_inspection_revision",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("location_id", sa.BigInteger(), nullable=False),
            sa.Column("field_key", sa.String(length=64), nullable=False),
            sa.Column("value_previous", json_type, nullable=True),
            sa.Column("value_new", json_type, nullable=True),
            sa.Column(
                "edited_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column("edited_at_client", sa.DateTime(timezone=True), nullable=True),
            sa.Column("actor_name", sa.String(length=255), nullable=False),
            sa.Column("actor_role", sa.String(length=32), nullable=False),
            sa.Column("route_session_id", sa.BigInteger(), nullable=True),
            sa.Column("client_mutation_id", sa.String(length=36), nullable=True),
            sa.Column("restored_from_revision_id", sa.BigInteger(), nullable=True),
            sa.ForeignKeyConstraint(
                ["location_id"],
                ["monthly_route_location.id"],
                name="fk_monthly_rloc_ins_rev_location_id",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["restored_from_revision_id"],
                ["monthly_route_location_inspection_revision.id"],
                name="fk_monthly_rloc_ins_rev_restored_from_id",
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("client_mutation_id", name="uq_monthly_rloc_ins_rev_client_mut_id"),
        )
    if not _has_index(
        "monthly_route_location_inspection_revision",
        "ix_monthly_rloc_ins_rev_location_id",
    ):
        op.create_index(
            "ix_monthly_rloc_ins_rev_location_id",
            "monthly_route_location_inspection_revision",
            ["location_id"],
            unique=False,
        )
    if not _has_index(
        "monthly_route_location_inspection_revision",
        "ix_monthly_rloc_ins_rev_route_session_id",
    ):
        op.create_index(
            "ix_monthly_rloc_ins_rev_route_session_id",
            "monthly_route_location_inspection_revision",
            ["route_session_id"],
            unique=False,
        )
    if not _has_index(
        "monthly_route_location_inspection_revision",
        "ix_monthly_rloc_ins_rev_restored_from_revision_id",
    ):
        op.create_index(
            "ix_monthly_rloc_ins_rev_restored_from_revision_id",
            "monthly_route_location_inspection_revision",
            ["restored_from_revision_id"],
            unique=False,
        )
    if not _has_index(
        "monthly_route_location_inspection_revision",
        "ix_monthly_rloc_ins_rev_loc_field_edited",
    ):
        op.create_index(
            "ix_monthly_rloc_ins_rev_loc_field_edited",
            "monthly_route_location_inspection_revision",
            ["location_id", "field_key", "edited_at"],
            unique=False,
        )
    if not _has_index(
        "monthly_route_location_inspection_revision",
        "ix_monthly_rloc_ins_rev_loc_edited",
    ):
        op.create_index(
            "ix_monthly_rloc_ins_rev_loc_edited",
            "monthly_route_location_inspection_revision",
            ["location_id", "edited_at"],
            unique=False,
        )


def downgrade():
    if _has_index(
        "monthly_route_location_inspection_revision",
        "ix_monthly_rloc_ins_rev_loc_edited",
    ):
        op.drop_index(
            "ix_monthly_rloc_ins_rev_loc_edited",
            table_name="monthly_route_location_inspection_revision",
        )
    if _has_index(
        "monthly_route_location_inspection_revision",
        "ix_monthly_rloc_ins_rev_loc_field_edited",
    ):
        op.drop_index(
            "ix_monthly_rloc_ins_rev_loc_field_edited",
            table_name="monthly_route_location_inspection_revision",
        )
    if _has_index(
        "monthly_route_location_inspection_revision",
        "ix_monthly_rloc_ins_rev_restored_from_revision_id",
    ):
        op.drop_index(
            "ix_monthly_rloc_ins_rev_restored_from_revision_id",
            table_name="monthly_route_location_inspection_revision",
        )
    if _has_index(
        "monthly_route_location_inspection_revision",
        "ix_monthly_rloc_ins_rev_route_session_id",
    ):
        op.drop_index(
            "ix_monthly_rloc_ins_rev_route_session_id",
            table_name="monthly_route_location_inspection_revision",
        )
    if _has_index(
        "monthly_route_location_inspection_revision",
        "ix_monthly_rloc_ins_rev_location_id",
    ):
        op.drop_index(
            "ix_monthly_rloc_ins_rev_location_id",
            table_name="monthly_route_location_inspection_revision",
        )
    if _has_table("monthly_route_location_inspection_revision"):
        op.drop_table("monthly_route_location_inspection_revision")

    if _has_check("monthly_route_location", "ck_mrl_monitoring_company_xor_pending_proposal"):
        op.drop_constraint(
            "ck_mrl_monitoring_company_xor_pending_proposal",
            "monthly_route_location",
            type_="check",
        )
    _ix_mrl_pending_prop = "ix_mrl_pending_mon_prop_id"
    _ix_mrl_pending_prop_legacy = "ix_monthly_route_location_pending_monitoring_company_proposal_id"
    if _has_index("monthly_route_location", _ix_mrl_pending_prop):
        op.drop_index(_ix_mrl_pending_prop, table_name="monthly_route_location")
    elif _has_index("monthly_route_location", _ix_mrl_pending_prop_legacy):
        op.drop_index(_ix_mrl_pending_prop_legacy, table_name="monthly_route_location")
    if _has_index("monthly_route_location", "ix_monthly_route_location_monitoring_company_id"):
        op.drop_index(
            "ix_monthly_route_location_monitoring_company_id",
            table_name="monthly_route_location",
        )
    _fk_mrl_pending_prop = "fk_mrl_pending_mon_prop_id"
    _fk_mrl_pending_prop_legacy = "fk_monthly_route_location_pending_monitoring_company_proposal_id"
    if _has_fk("monthly_route_location", _fk_mrl_pending_prop):
        op.drop_constraint(_fk_mrl_pending_prop, "monthly_route_location", type_="foreignkey")
    elif _has_fk("monthly_route_location", _fk_mrl_pending_prop_legacy):
        op.drop_constraint(
            _fk_mrl_pending_prop_legacy,
            "monthly_route_location",
            type_="foreignkey",
        )
    if _has_fk("monthly_route_location", "fk_monthly_route_location_monitoring_company_id"):
        op.drop_constraint(
            "fk_monthly_route_location_monitoring_company_id",
            "monthly_route_location",
            type_="foreignkey",
        )
    for col_name in [
        "inspection_tech_notes",
        "testing_procedures",
        "facp_detail",
        "ring_detail",
        "annual_month_pending_submitted_by_name",
        "annual_month_pending_submitted_at",
        "annual_month_pending",
        "pending_monitoring_company_proposal_id",
        "monitoring_company_id",
    ]:
        if _has_column("monthly_route_location", col_name):
            op.drop_column("monthly_route_location", col_name)

    if _has_index(
        "monitoring_company_proposal",
        "ix_monitoring_company_proposal_resulting_monitoring_company_id",
    ):
        op.drop_index(
            "ix_monitoring_company_proposal_resulting_monitoring_company_id",
            table_name="monitoring_company_proposal",
        )
    if _has_index(
        "monitoring_company_proposal",
        "ix_monitoring_company_proposal_route_session_id",
    ):
        op.drop_index(
            "ix_monitoring_company_proposal_route_session_id",
            table_name="monitoring_company_proposal",
        )
    if _has_index(
        "monitoring_company_proposal",
        "ix_monitoring_company_proposal_name_normalized",
    ):
        op.drop_index(
            "ix_monitoring_company_proposal_name_normalized",
            table_name="monitoring_company_proposal",
        )
    if _has_index("monitoring_company_proposal", "ix_monitoring_company_proposal_status"):
        op.drop_index(
            "ix_monitoring_company_proposal_status",
            table_name="monitoring_company_proposal",
        )
    if _has_table("monitoring_company_proposal"):
        op.drop_table("monitoring_company_proposal")

    if _has_index("monitoring_company", "ix_monitoring_company_name_normalized"):
        op.drop_index("ix_monitoring_company_name_normalized", table_name="monitoring_company")
    if _has_table("monitoring_company"):
        op.drop_table("monitoring_company")
