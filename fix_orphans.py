from app import create_app, db
from sqlalchemy import text

app = create_app()
with app.app_context():
    print("Fixing orphaned worksheet audit event rows...")
    
    # Delete the 2 orphaned rows that reference non-existent legacy location mapping
    result = db.session.execute(text(
        "DELETE FROM monthly_route_worksheet_audit_event WHERE history_row_id = 113"
    ))
    
    print(f"Deleted {result.rowcount} orphaned rows")
    
    # Verify they're gone
    remaining = db.session.execute(text(
        "SELECT COUNT(*) FROM monthly_route_worksheet_audit_event WHERE location_month_row_id IS NULL"
    )).scalar()
    
    print(f"Remaining NULL location_month_row_id rows: {remaining}")
    
    # Commit the changes
    db.session.commit()
    print("Changes committed to database")
