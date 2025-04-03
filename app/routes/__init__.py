# app/routes/__init__.py
from .auth import auth_bp
from .home import home_bp
from .scheduling import scheduling_bp
from .data_analytics import data_analytics_bp, init_cache
from .life_of_a_job import life_of_a_job_bp
from .processing_attack import processing_attack_bp
from .scheduling_attack import scheduling_attack_bp
from .update_db import update_db_bp


def register_blueprints(app):
    app.register_blueprint(auth_bp)
    app.register_blueprint(home_bp)
    app.register_blueprint(scheduling_bp)
    app.register_blueprint(data_analytics_bp)
    app.register_blueprint(life_of_a_job_bp)
    app.register_blueprint(processing_attack_bp)
    app.register_blueprint(scheduling_attack_bp)
    app.register_blueprint(update_db_bp)
    init_cache(app)

