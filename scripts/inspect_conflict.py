from app import create_app
from app.db_models import MonthlyLocation

app = create_app()
with app.app_context():
    rows = MonthlyLocation.query.filter_by(
        address_normalized='9838 second street',
        property_management_company_normalized='devon properties',
        label_normalized='9838 second street',
    ).all()
    print('COUNT', len(rows))
    for r in rows:
        print(r.id, getattr(r, 'legacy_monthly_route_location_id', None), getattr(r, 'legacy_monthly_testing_site_id', None), repr(r.address), repr(r.property_management_company), repr(r.label))
