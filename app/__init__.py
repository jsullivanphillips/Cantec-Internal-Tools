# app/__init__.py
import os
from flask import Flask
from app.config import Config
from app.routes import register_blueprints
from app.utils.logger import setup_logging

def create_app():
    basedir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    template_path = os.path.join(basedir, 'templates')
    app = Flask(__name__, template_folder=template_path)
    app.config.from_object(Config)
    app.secret_key = Config.SECRET_KEY

    setup_logging(app)
    register_blueprints(app)
    return app
