from app import create_app
from app.db_models import db
from sqlalchemy import text

app = create_app()
with app.app_context():
    bind = db.session.get_bind()
    insp = __import__("sqlalchemy").inspect(bind)
    if not insp.has_table("monthly_stop_clock_event"):
        print("no_table")
    else:
        cols = {c["name"] for c in insp.get_columns("monthly_stop_clock_event")}
        print("columns:", sorted(cols))
        if "monthly_location_month_id" in cols:
            q = db.session.execute(text("SELECT COUNT(*) FROM monthly_stop_clock_event WHERE monthly_location_month_id IS NULL"))
            print("null_monthly_location_month_id:", q.scalar())
        if "monthly_testing_site_month_id" in cols:
            q = db.session.execute(text("SELECT COUNT(*) FROM monthly_stop_clock_event WHERE monthly_testing_site_month_id IS NULL"))
            print("null_monthly_testing_site_month_id:", q.scalar())
