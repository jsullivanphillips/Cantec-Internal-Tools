from app import create_app
from app.db_models import db
from sqlalchemy import text

app = create_app()
with app.app_context():
    bind = db.session.get_bind()
    insp = __import__("sqlalchemy").inspect(bind)
    if not insp.has_table("monthly_stop_clock_event"):
        print("no table")
    else:
        cols = {c["name"] for c in insp.get_columns("monthly_stop_clock_event")}
        if "monthly_location_month_id" in cols:
            rows = db.session.execute(text(
                "SELECT id, monthly_testing_site_month_id, time_in_raw, time_out_raw FROM monthly_stop_clock_event WHERE monthly_location_month_id IS NULL LIMIT 20"
            )).fetchall()
            for r in rows:
                print(dict(r._mapping))
