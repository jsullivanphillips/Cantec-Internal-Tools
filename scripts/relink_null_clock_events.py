from app import create_app
from app.db_models import db
from app.monthly.legacy_orm_migration import MonthlyTestingSiteMonth
from app.db_models import MonthlyLocationMonth
from sqlalchemy import text

app = create_app()
with app.app_context():
    bind = db.session.get_bind()
    insp = __import__("sqlalchemy").inspect(bind)
    if not insp.has_table("monthly_stop_clock_event"):
        print("no table")
    else:
        rows = db.session.execute(text(
            "SELECT id, monthly_testing_site_month_id FROM monthly_stop_clock_event WHERE monthly_location_month_id IS NULL"
        )).fetchall()
        print('null clock events:', len(rows))
        for r in rows:
            ev = dict(r._mapping)
            mtsm_id = ev['monthly_testing_site_month_id']
            mtsm = MonthlyTestingSiteMonth.query.get(mtsm_id)
            if not mtsm:
                print('no mtsm', mtsm_id)
                continue
            # find candidate MLMs for same month_date, prefer matching key_number and pmc
            candidates = MonthlyLocationMonth.query.filter_by(month_date=mtsm.month_date).all()
            good = []
            for c in candidates:
                if getattr(c, 'key_number', None) and getattr(mtsm, 'key_number', None):
                    if c.key_number == mtsm.key_number:
                        good.append(c)
                else:
                    # fallback: match property_management_company
                    if getattr(c, 'property_management_company', None) == getattr(mtsm, 'property_management_company', None):
                        good.append(c)
            if len(good) == 1:
                target = good[0]
                print('updating event', ev['id'], '-> mlm', target.id)
                db.session.execute(text('UPDATE monthly_stop_clock_event SET monthly_location_month_id = :mlm WHERE id = :eid'), {'mlm': target.id, 'eid': ev['id']})
            else:
                print('ambiguous candidates for event', ev['id'], 'mtsm', mtsm_id, 'candidates', len(good))
                for c in good:
                    print(' candidate mlm', c.id, 'monthly_location_id', c.monthly_location_id, 'key', getattr(c,'key_number',None), 'pmc', getattr(c,'property_management_company',None))
        db.session.commit()
        print('done')
