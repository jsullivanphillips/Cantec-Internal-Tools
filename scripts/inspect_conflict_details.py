from app import create_app
from app.db_models import MonthlyLocation
from app.monthly.legacy_orm_migration import MonthlyRouteLocation, MonthlyTestingSite

app = create_app()
with app.app_context():
    r597 = MonthlyRouteLocation.query.get(597)
    ts597 = MonthlyTestingSite.query.get(597)
    loc302 = MonthlyLocation.query.get(302)
    print('--- MonthlyRouteLocation 597 ---')
    if r597:
        print('id', r597.id)
        print('address', r597.address)
        print('display_address', getattr(r597,'display_address',None))
        print('property_management_company', getattr(r597,'property_management_company',None))
        print('route_stop_order', getattr(r597,'route_stop_order',None))
    else:
        print('not found')
    print('\n--- MonthlyTestingSite 597 ---')
    if ts597:
        print('id', ts597.id)
        print('label', getattr(ts597,'label',None))
        print('building_name', getattr(ts597,'building_name',None))
        print('property_management_company', getattr(ts597,'property_management_company',None))
    else:
        print('not found')
    print('\n--- MonthlyLocation 302 ---')
    if loc302:
        print('id', loc302.id)
        print('address', loc302.address)
        print('label', loc302.label)
        print('property_management_company', loc302.property_management_company)
        print('legacy_monthly_route_location_id', getattr(loc302,'legacy_monthly_route_location_id',None))
        print('legacy_monthly_testing_site_id', getattr(loc302,'legacy_monthly_testing_site_id',None))
    else:
        print('not found')
