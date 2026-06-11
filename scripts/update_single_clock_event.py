from app import create_app
from app.db_models import db
from sqlalchemy import text

app = create_app()
with app.app_context():
    db.session.execute(text('UPDATE monthly_stop_clock_event SET monthly_location_month_id = :mlm WHERE id = :eid'), {'mlm': 53, 'eid': 78})
    db.session.commit()
    print('updated event 78 -> mlm 53')
