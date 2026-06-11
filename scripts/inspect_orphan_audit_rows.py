from app import create_app
from app.db_models import db
from sqlalchemy import text

app = create_app()
with app.app_context():
    rows = db.session.execute(text(
        'SELECT id, location_id, history_row_id, month_date, field_name, old_value, new_value FROM monthly_route_worksheet_audit_event WHERE location_id IN (645,646,647) ORDER BY location_id, id'
    )).fetchall()
    print('rows', len(rows))
    for r in rows:
        print(dict(r._mapping))
