from app import create_app
from app.db_models import db
from app.monthly.legacy_orm_migration import MonthlyRouteTestHistory

app = create_app()
with app.app_context():
    for hist_id in [2522, 2542, 2543]:
        hist = MonthlyRouteTestHistory.query.get(hist_id)
        print('hist', hist_id, '->', 'exists' if hist else 'missing')
        if hist:
            print('  location_id', hist.location_id, 'month_date', hist.month_date, 'test_monthly_route_id', hist.test_monthly_route_id, 'result_status', hist.result_status)
            print('  fields', {k: v for k, v in hist.__dict__.items() if not k.startswith('_')})
