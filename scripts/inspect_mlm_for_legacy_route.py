from app import create_app
from app.db_models import db
from sqlalchemy import text

app = create_app()
with app.app_context():
    for legacy in [645, 646, 647]:
        print('legacy', legacy)
        rows = db.session.execute(text(
            'SELECT mlm.id AS mlm_id, mlm.monthly_location_id AS loc_id, mlm.month_date, mlm.key_number, ml.address, ml.label, ml.property_management_company, ml.legacy_monthly_route_location_id, ml.legacy_monthly_testing_site_id FROM monthly_location_month mlm JOIN monthly_location ml ON mlm.monthly_location_id = ml.id WHERE ml.legacy_monthly_route_location_id = :legacy AND mlm.month_date = :dt ORDER BY ml.id'
        ), {'legacy': legacy, 'dt': '2026-06-01'}).fetchall()
        for r in rows:
            print(dict(r._mapping))
