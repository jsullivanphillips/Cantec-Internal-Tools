# app/routes/__init__.py
from .auth import auth_bp
from .home import home_bp
from .scheduling import scheduling_bp

def register_blueprints(app):
    app.register_blueprint(auth_bp)
    app.register_blueprint(home_bp)
    app.register_blueprint(scheduling_bp)
