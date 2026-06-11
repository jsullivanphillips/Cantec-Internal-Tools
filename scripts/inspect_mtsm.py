from app import create_app
from app.db_models import db, MonthlyLocationMonth
from app.monthly.legacy_orm_migration import MonthlyTestingSiteMonth


app = create_app()
with app.app_context():
    mtsm = MonthlyTestingSiteMonth.query.get(59)
    if mtsm is None:
        print('no mtsm 59')
    else:
        print('mtsm', mtsm.id, mtsm.month_date, mtsm.monthly_testing_site_id, getattr(mtsm,'key_number',None))
        mlms = MonthlyLocationMonth.query.filter_by(month_date=mtsm.month_date).all()
        print('candidate mlm count', len(mlms))
        for m in mlms:
            print('mlm', m.id, m.monthly_location_id, m.month_date, getattr(m,'key_number',None))
