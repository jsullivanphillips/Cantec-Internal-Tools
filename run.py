# run.py
from app import create_app
from app.db_models import db
from app import migrate

app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0")
