# app/routes/__init__.py
from .auth import auth_bp
from .home import home_bp
from .scheduling import scheduling_bp
from .data_analytics import data_analytics_bp, init_cache
from .life_of_a_job import life_of_a_job_bp



def register_blueprints(app):
    app.register_blueprint(auth_bp)
    app.register_blueprint(home_bp)
    app.register_blueprint(scheduling_bp)
    app.register_blueprint(data_analytics_bp)
    app.register_blueprint(life_of_a_job_bp)
    init_cache(app)
