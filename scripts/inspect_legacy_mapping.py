from app import create_app
from app.db_models import db, MonthlyLocation
from sqlalchemy import text

app = create_app()
with app.app_context():
    for legacy in [645, 646, 647]:
        rows = MonthlyLocation.query.filter_by(legacy_monthly_route_location_id=legacy).all()
        print('legacy', legacy, 'rows_by_legacy_route', len(rows))
        for row in rows:
            print('  id', row.id, 'address', row.address, 'label', row.label, 'pmc', row.property_management_company)
        rows2 = MonthlyLocation.query.filter_by(legacy_monthly_testing_site_id=legacy).all()
        print('legacy', legacy, 'rows_by_legacy_testing', len(rows2))
        for row in rows2:
            print('  id', row.id, 'address', row.address, 'label', row.label, 'pmc', row.property_management_company)
        q = db.session.execute(text('SELECT COUNT(*) FROM monthly_route_location WHERE id = :legacy'), {'legacy': legacy})
        print('legacy route exists', q.scalar())
