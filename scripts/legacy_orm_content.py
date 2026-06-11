"""Legacy ORM models retained only for one-time flat-location data migration."""

from __future__ import annotations

from app.db_models import db


class MonthlyRouteLocation(db.Model):
    __tablename__ = "monthly_route_location"
    __table_args__ = {"extend_existing": True}

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    address = db.Column(db.String(255), nullable=False)
    address_normalized = db.Column(db.String(255), nullable=False)
    property_management_company = db.Column(db.String(255), nullable=True)
    property_management_company_normalized = db.Column(db.String(255), nullable=False, default="")
    building = db.Column(db.String(255), nullable=True)
    building_normalized = db.Column(db.String(255), nullable=False, default="")
    notes = db.Column(db.Text, nullable=True)
    billing_comments = db.Column(db.Text, nullable=True)
    barcode = db.Column(db.String(64), nullable=True)
    price_per_month = db.Column(db.Numeric(10, 2), nullable=True)
    area = db.Column(db.String(255), nullable=True)
    start_up_date = db.Column(db.Date, nullable=True)
    status_normalized = db.Column(db.String(32), nullable=False, default="active")
    status_raw = db.Column(db.String(255), nullable=True)
    keys = db.Column(db.Text, nullable=True)
    test_day = db.Column(db.String(255), nullable=True)
    annual_month = db.Column(db.String(32), nullable=True)
    display_address = db.Column(db.String(255), nullable=True)
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    monthly_route_id = db.Column(db.BigInteger, nullable=True, index=True)
    route_stop_order = db.Column(db.SmallInteger, nullable=True)
    service_trade_site_location_id = db.Column(db.BigInteger, nullable=True)
    key_id = db.Column(db.BigInteger, nullable=True)
    monitoring_company_id = db.Column(db.BigInteger, nullable=True)
    pending_monitoring_company_proposal_id = db.Column(db.BigInteger, nullable=True)
    annual_month_pending = db.Column(db.String(64), nullable=True)
    annual_month_pending_submitted_at = db.Column(db.DateTime(timezone=True), nullable=True)
    annual_month_pending_submitted_by_name = db.Column(db.String(255), nullable=True)
    ring_detail = db.Column(db.Text, nullable=True)
    facp_detail = db.Column(db.Text, nullable=True)
    testing_procedures = db.Column(db.Text, nullable=True)
    inspection_tech_notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)

    monthly_site = db.relationship(
        "MonthlySite",
        back_populates="legacy_location",
        foreign_keys="MonthlySite.legacy_monthly_route_location_id",
        uselist=False,
    )


class MonthlySite(db.Model):
    __tablename__ = "monthly_site"
    __table_args__ = {"extend_existing": True}

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    legacy_monthly_route_location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route_location.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)

    legacy_location = db.relationship(
        "MonthlyRouteLocation",
        back_populates="monthly_site",
        foreign_keys=[legacy_monthly_route_location_id],
    )
    testing_sites = db.relationship(
        "MonthlyTestingSite",
        back_populates="monthly_site",
        cascade="all, delete-orphan",
        order_by="MonthlyTestingSite.sort_order",
    )


class MonthlyTestingSite(db.Model):
    __tablename__ = "monthly_testing_site"
    __table_args__ = {"extend_existing": True}

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_site_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_site.id", ondelete="CASCADE"),
        nullable=False,
    )
    sort_order = db.Column(db.SmallInteger, nullable=False, default=0)
    label = db.Column(db.String(255), nullable=True)
    price_per_month = db.Column(db.Numeric(10, 2), nullable=True)
    ring_detail = db.Column(db.Text, nullable=True)
    facp_detail = db.Column(db.Text, nullable=True)
    panel = db.Column(db.Text, nullable=True)
    panel_location = db.Column(db.String(255), nullable=True)
    door_code = db.Column(db.String(255), nullable=True)
    annual_month = db.Column(db.String(32), nullable=True)
    property_management_company = db.Column(db.String(255), nullable=True)
    building_name = db.Column(db.String(255), nullable=True)
    testing_procedures = db.Column(db.Text, nullable=True)
    inspection_tech_notes = db.Column(db.Text, nullable=True)
    key_id = db.Column(db.BigInteger, nullable=True)
    keys = db.Column(db.Text, nullable=True)
    barcode = db.Column(db.String(64), nullable=True)
    monitoring_company_id = db.Column(db.BigInteger, nullable=True)
    monitoring_account_number = db.Column(db.String(64), nullable=True)
    monitoring_password = db.Column(db.String(64), nullable=True)
    monitoring_notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)

    monthly_site = db.relationship("MonthlySite", back_populates="testing_sites")


class MonthlyTestingSiteMonth(db.Model):
    __tablename__ = "monthly_testing_site_month"
    __table_args__ = {"extend_existing": True}

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_testing_site_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_testing_site.id", ondelete="CASCADE"),
        nullable=False,
    )
    month_date = db.Column(db.Date, nullable=False)
    run_id = db.Column(db.BigInteger, nullable=True)
    test_monthly_route_id = db.Column(db.BigInteger, nullable=True)
    session_route_stop_order = db.Column(db.SmallInteger, nullable=True)
    result_status = db.Column(db.String(32), nullable=True)
    skip_reason = db.Column(db.String(255), nullable=True)
    source_value_raw = db.Column(db.String(255), nullable=True)
    facp = db.Column(db.Text, nullable=True)
    panel = db.Column(db.Text, nullable=True)
    panel_location = db.Column(db.String(255), nullable=True)
    door_code = db.Column(db.String(255), nullable=True)
    property_management_company = db.Column(db.String(255), nullable=True)
    building_name = db.Column(db.String(255), nullable=True)
    ring = db.Column(db.String(255), nullable=True)
    key_number = db.Column(db.String(255), nullable=True)
    annual_month = db.Column(db.String(32), nullable=True)
    testing_procedures = db.Column(db.Text, nullable=True)
    inspection_tech_notes = db.Column(db.Text, nullable=True)
    run_comments = db.Column(db.Text, nullable=True)
    office_job_comment = db.Column(db.Text, nullable=True)
    office_attention = db.Column(db.Boolean, nullable=False, default=False)
    prior_month_out_of_order_dismissed = db.Column(db.Boolean, nullable=False, default=False)
    sheet_time_in_raw = db.Column(db.String(64), nullable=True)
    sheet_time_out_raw = db.Column(db.String(64), nullable=True)
    test_outcome = db.Column(db.String(32), nullable=True)
    skip_category = db.Column(db.String(64), nullable=True)
    skip_note = db.Column(db.Text, nullable=True)
    confirmed_no_deficiencies = db.Column(db.Boolean, nullable=False, default=False)
    monitoring_company_name = db.Column(db.String(255), nullable=True)
    monitoring_company_id = db.Column(db.BigInteger, nullable=True)
    monitoring_account_number = db.Column(db.String(64), nullable=True)
    monitoring_password = db.Column(db.String(64), nullable=True)
    monitoring_notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)


class MonthlyRouteTestHistory(db.Model):
    __tablename__ = "monthly_route_test_history"
    __table_args__ = {"extend_existing": True}

    id = db.Column(db.BigInteger, primary_key=True)
    location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route_location.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    month_date = db.Column(db.Date, nullable=False)
    result_status = db.Column(db.String(32), nullable=True)
    skip_reason = db.Column(db.String(255), nullable=True)
    source_value_raw = db.Column(db.String(255), nullable=True)
    test_monthly_route_id = db.Column(db.BigInteger, nullable=True)
    session_route_stop_order = db.Column(db.SmallInteger, nullable=True)
    facp = db.Column(db.Text, nullable=True)
    ring = db.Column(db.String(255), nullable=True)
    key_number = db.Column(db.String(255), nullable=True)
    annual_month = db.Column(db.String(32), nullable=True)
    testing_procedures = db.Column(db.Text, nullable=True)
    inspection_tech_notes = db.Column(db.Text, nullable=True)
    sheet_time_in_raw = db.Column(db.String(64), nullable=True)
    sheet_time_out_raw = db.Column(db.String(64), nullable=True)
    billing_status = db.Column(db.String(16), nullable=True)
    monitoring_notes = db.Column(db.Text, nullable=True)
    run_id = db.Column(db.BigInteger, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)


class MonthlyRouteLocationComment(db.Model):
    __tablename__ = "monthly_route_location_comment"
    __table_args__ = {"extend_existing": True}

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route_location.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    body = db.Column(db.Text, nullable=False)
    author_username = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)


class MonthlyTestingSiteDeficiency(db.Model):
    __tablename__ = "monthly_testing_site_deficiency"
    __table_args__ = {"extend_existing": True}

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_testing_site_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_testing_site.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_run_id = db.Column(db.BigInteger, nullable=True)
    title = db.Column(db.String(255), nullable=False)
    severity = db.Column(db.String(32), nullable=False)
    status = db.Column(db.String(32), nullable=False, default="new")
    description = db.Column(db.Text, nullable=True)
    verification_notes = db.Column(db.Text, nullable=True)
    reported_by_tech_id = db.Column(db.String(64), nullable=True)
    reported_by_tech_name = db.Column(db.String(255), nullable=True)
    last_edited_by_tech_id = db.Column(db.String(64), nullable=True)
    last_edited_by_tech_name = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), nullable=False)
