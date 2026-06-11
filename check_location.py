from app import create_app, db
from sqlalchemy import text

app = create_app()
with app.app_context():
    # Check if location 597 exists at all
    ml = db.session.execute(text(
        "SELECT id, legacy_monthly_route_location_id FROM monthly_location WHERE legacy_monthly_route_location_id = 597 OR id = 597"
    )).fetchone()
    
    if ml:
        print(f"Found location: id={ml[0]}, legacy_id={ml[1]}")
    else:
        print("Location 597 does not exist in monthly_location")
    
    # Check what the worksheet audit events are referring to
    print("\nCurrent state of the 2 orphaned rows:")
    rows = db.session.execute(text(
        "SELECT id, location_id, location_month_row_id, history_row_id FROM monthly_route_worksheet_audit_event WHERE history_row_id = 113"
    )).fetchall()
    for row in rows:
        print(f"  Row {row[0]}: location_id={row[1]}, location_month_row_id={row[2]}, history_row_id={row[3]}")
