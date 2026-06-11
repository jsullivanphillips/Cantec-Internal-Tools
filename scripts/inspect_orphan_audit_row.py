from app import create_app
from app.db_models import db
from sqlalchemy import text

app = create_app()
with app.app_context():
    rs = db.session.execute(text(
        'SELECT id, location_id, location_month_row_id, month_date, field_name, old_value, new_value FROM monthly_route_worksheet_audit_event WHERE location_id IN (645,646,647) ORDER BY location_id, id'
    )).fetchall()
    for r in rs:
        print(dict(r._mapping))
    print('---')
    rs2 = db.session.execute(text(
        'SELECT id, monthly_location_id, month_date, key_number, property_management_company, legacy_monthly_route_location_id, legacy_monthly_testing_site_id FROM monthly_location_month JOIN monthly_location ON monthly_location.id=monthly_location_month.monthly_location_id WHERE monthly_location_month.id IN (SELECT location_month_row_id FROM monthly_route_worksheet_audit_event WHERE location_id IN (645,646,647)) ORDER BY monthly_location_month.id'
    )).fetchall()
    for r in rs2:
        print(dict(r._mapping))
