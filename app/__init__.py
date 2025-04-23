# app/__init__.py
import os
from flask import Flask
from flask_migrate import Migrate
from app.config import Config
from app.routes import register_blueprints
from app.utils.logger import setup_logging
from app.db_models import db
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))
print("DATABASE_URL:", os.environ.get("DATABASE_URL"))
migrate = Migrate()

def create_app():
    basedir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    template_path = os.path.join(basedir, 'templates')
    static_path = os.path.join(basedir, 'static')
    # Explicitly set static_folder and static_url_path
    app = Flask(__name__,
                template_folder=template_path,
                static_folder=static_path)
    app.config.from_object(Config)
    app.secret_key = Config.SECRET_KEY
    database_url = os.environ.get("DATABASE_URL")
    if database_url and database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    migrate.init_app(app, db)
    setup_logging(app)
    register_blueprints(app)

    return app
