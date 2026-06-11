from app import create_app, db
from sqlalchemy import text

app = create_app()
with app.app_context():
    # Terminate other idle connections
    db.session.execute(text(
        """SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname = current_database() 
        AND pid != pg_backend_pid() 
        AND state = 'idle'"""
    ))
    db.session.commit()
    print("Terminated idle connections")
