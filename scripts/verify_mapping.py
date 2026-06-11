from app import create_app
from app.db_models import MonthlyLocationMonth
from app.monthly.legacy_orm_migration import MonthlyTestingSiteMonth
from sqlalchemy import and_

app = create_app()
with app.app_context():
    mtsm = MonthlyTestingSiteMonth.query.filter_by(monthly_testing_site_id=597).all()
    print('mtsm count for ts 597:', len(mtsm))
    migrated = []
    for row in mtsm:
        mlm = MonthlyLocationMonth.query.filter_by(month_date=row.month_date, monthly_location_id=302).one_or_none()
        migrated.append((row.id, row.month_date, mlm.id if mlm is not None else None))
    for m in migrated:
        print(m)
