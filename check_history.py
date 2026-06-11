from app import create_app, db
from sqlalchemy import text

app = create_app()
with app.app_context():
    # Check if history_row_id 113 exists  
    hist = db.session.execute(text(
        "SELECT id, location_id, month_date FROM monthly_route_test_history WHERE id = 113"
    )).fetchone()
    
    if hist:
        print(f"History row 113 found:")
        print(f"  location_id: {hist[1]}, month_date: {hist[2]}")
        
        # Check the worksheet audit event rows
        print("\nWorksheet audit event rows:")
        rows = db.session.execute(text(
            "SELECT id, location_id FROM monthly_route_worksheet_audit_event WHERE history_row_id = 113"
        )).fetchall()
        for row in rows:
            print(f"  ID: {row[0]}, location_id: {row[1]}")
        
        # Try to find matching monthly_location_month  
        # The history refers to location_id 113 (legacy), which should map to a monthly_location
        print(f"\nLooking for monthly_location_month for location_id {hist[1]} on month {hist[2]}...")
        
        # First find the monthly_location
        ml = db.session.execute(text(
            "SELECT id FROM monthly_location WHERE legacy_monthly_route_location_id = :legacy_id LIMIT 1"
        ), {"legacy_id": hist[1]}).fetchone()
        
        if ml:
            print(f"  Found monthly_location id: {ml[0]}")
            
            # Now find the monthly_location_month
            mlm = db.session.execute(text(
                "SELECT id FROM monthly_location_month WHERE monthly_location_id = :loc_id AND month_date = :month_date"
            ), {"loc_id": ml[0], "month_date": hist[2]}).fetchone()
            
            if mlm:
                print(f"  Found monthly_location_month id: {mlm[0]} - CAN BE FIXED!")
            else:
                print(f"  No monthly_location_month found for this date - CANNOT BE FIXED")
        else:
            print(f"  No monthly_location found for legacy_id {hist[1]}")
    else:
        print("History row 113 NOT found")
