from app import create_app
from app.db_models import db
from sqlalchemy import text

app = create_app()
with app.app_context():
    q = db.session.execute(text(
        'SELECT DISTINCT location_id FROM monthly_route_worksheet_audit_event WHERE location_id NOT IN (SELECT id FROM monthly_location) ORDER BY location_id'
    ))
    ids = [row[0] for row in q.fetchall()]
    print('missing_location_ids', ids)
    q2 = db.session.execute(text(
        'SELECT COUNT(*) FROM monthly_route_worksheet_audit_event WHERE location_id NOT IN (SELECT id FROM monthly_location)'
    ))
    print('missing_count', q2.scalar())
    q3 = db.session.execute(text(
        'SELECT location_id, COUNT(*) FROM monthly_route_worksheet_audit_event WHERE location_id NOT IN (SELECT id FROM monthly_location) GROUP BY location_id ORDER BY COUNT(*) DESC LIMIT 20'
    ))
    print('top_missing')
    for row in q3:
        print(row[0], row[1])
