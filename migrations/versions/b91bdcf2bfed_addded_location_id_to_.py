from alembic import op
import sqlalchemy as sa

revision = "b91bdcf2bfed"
down_revision = "f877bdb725f4"
branch_labels = None
depends_on = None


def upgrade():
    # 1) Add location_id as nullable first (backfill later), otherwise existing rows break
    with op.batch_alter_table("scheduling_attack_v2") as batch_op:
        batch_op.add_column(sa.Column("location_id", sa.BigInteger(), nullable=True))

    # 2) Convert month (VARCHAR -> timestamptz) with explicit USING clause
    #
    # Handle common cases:
    # - '2026-01'         -> to_timestamp via to_date(...,'YYYY-MM')
    # - '01 26'           -> to_date(...,'MM YY')  (assumes 20YY)
    # - '2026-01-01'      -> castable via ::date
    #
    op.execute(
        """
        ALTER TABLE scheduling_attack_v2
        ALTER COLUMN month
        TYPE TIMESTAMPTZ
        USING (
          CASE
            WHEN month IS NULL OR btrim(month) = '' THEN NULL
            WHEN month ~ '^[0-9]{4}-[0-9]{2}$' THEN (to_date(month, 'YYYY-MM')::timestamp AT TIME ZONE 'UTC')
            WHEN month ~ '^[0-9]{2}\\s+[0-9]{2}$' THEN (to_date(month, 'MM YY')::timestamp AT TIME ZONE 'UTC')
            WHEN month ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (month::date::timestamp AT TIME ZONE 'UTC')
            ELSE NULL
          END
        )
        """
    )

    # 3) If any rows failed to parse, decide what you want:
    #    Option A (strict): fail migration if any NULL after conversion
    #    Option B (lenient): set NULLs to current month's anchor, etc.
    #
    # Here is strict (recommended so you don't silently lose data):
    res = op.get_bind().execute(sa.text("""
        SELECT count(*) 
        FROM scheduling_attack_v2
        WHERE month IS NULL
    """))
    null_count = res.scalar() or 0
    if null_count:
        raise RuntimeError(
            f"{null_count} rows have month=NULL after conversion. "
            f"Fix the original month strings or adjust the conversion logic."
        )

    # 4) Now set month NOT NULL (safe because we checked)
    with op.batch_alter_table("scheduling_attack_v2") as batch_op:
        batch_op.alter_column("month", nullable=False)

    # 5) Backfill location_id (YOU MUST define how)
    #    If you have a locations table, you'll need a rule:
    #    - match on address
    #    - or if you already stored location_id elsewhere
    #
    # Example: if you have a "location" table with "id" and "address":
    # op.execute("""
    #   UPDATE scheduling_attack_v2 s
    #   SET location_id = l.id
    #   FROM location l
    #   WHERE s.location_id IS NULL AND s.address = l.address;
    # """)

    # If you cannot backfill automatically, you can temporarily default to -1
    # (not great) or keep nullable until you populate.
    #
    # I’ll show the "keep nullable until backfilled" approach below:
    #
    # If you *can* backfill, then enforce NOT NULL:
    # with op.batch_alter_table("scheduling_attack_v2") as batch_op:
    #     batch_op.alter_column("location_id", nullable=False)

    # 6) Add index + unique constraint (only after location_id is populated & non-null)
    with op.batch_alter_table("scheduling_attack_v2") as batch_op:
        batch_op.create_index(
            batch_op.f("ix_scheduling_attack_v2_location_id"),
            ["location_id"],
            unique=False,
        )
        batch_op.create_unique_constraint(
            "uq_scheduling_attack_v2_location",
            ["location_id"],
        )


def downgrade():
    with op.batch_alter_table("scheduling_attack_v2") as batch_op:
        batch_op.drop_constraint("uq_scheduling_attack_v2_location", type_="unique")
        batch_op.drop_index(batch_op.f("ix_scheduling_attack_v2_location_id"))

    # timestamptz -> varchar (store as YYYY-MM)
    op.execute(
        """
        ALTER TABLE scheduling_attack_v2
        ALTER COLUMN month
        TYPE VARCHAR(255)
        USING to_char(month AT TIME ZONE 'UTC', 'YYYY-MM')
        """
    )

    with op.batch_alter_table("scheduling_attack_v2") as batch_op:
        batch_op.drop_column("location_id")
        batch_op.alter_column("month", nullable=True)
