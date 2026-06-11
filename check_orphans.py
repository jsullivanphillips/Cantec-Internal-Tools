from app import create_app, db
from sqlalchemy import text

app = create_app()
with app.app_context():
    rows = db.session.execute(text(
        "SELECT id, history_row_id, location_id FROM monthly_route_worksheet_audit_event WHERE location_month_row_id IS NULL"
    )).fetchall()
    print(f"Orphaned rows: {len(rows)}")
    for row in rows:
        print(f"  ID: {row[0]}, history_row_id: {row[1]}, location_id: {row[2]}")
