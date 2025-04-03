# app/__init__.py
import os
from flask import Flask
from app.config import Config
from app.routes import register_blueprints
from app.utils.logger import setup_logging
from app.models import db

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
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)

    setup_logging(app)
    register_blueprints(app)

    return app
