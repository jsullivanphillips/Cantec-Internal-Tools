from app import create_app
from app.db_models import MonthlyStopClockEvent, db

app = create_app()
with app.app_context():
    total = MonthlyStopClockEvent.query.count()
    null_new_column = 0
    null_old_column = 0
    cols = {c['name'] for c in __import__('sqlalchemy').inspect(db.session.get_bind()).get_columns('monthly_stop_clock_event')} if True else set()
    # check columns existence safely
    bind = db.session.get_bind()
    insp = __import__('sqlalchemy').inspect(bind)
    cols = {c['name'] for c in insp.get_columns('monthly_stop_clock_event')}
    has_new = 'monthly_location_month_id' in cols
    has_old = 'monthly_testing_site_month_id' in cols
    if has_new:
        null_new_column = MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=None).count()
    if has_old:
        null_old_column = MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=None).count()
    print('total_clock_events', total)
    print('has_monthly_location_month_id', has_new)
    print('has_monthly_testing_site_month_id', has_old)
    print('null_monthly_location_month_id', null_new_column)
    print('null_monthly_testing_site_month_id', null_old_column)
    # show sample rows where monthly_location_month_id is NULL
    samples = []
    if has_new:
        rows = MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=None).limit(10).all()
        for r in rows:
            samples.append({'id': r.id, 'monthly_testing_site_month_id': getattr(r, 'monthly_testing_site_month_id', None)})
    print('samples_null_monthly_location_month_id')
    for s in samples:
        print(s)
