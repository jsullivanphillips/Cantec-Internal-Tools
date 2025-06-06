# app/routes/__init__.py
from .auth import auth_bp
from .home import home_bp
from .scheduling import scheduling_bp
from .data_analytics import data_analytics_bp, init_cache
from .life_of_a_job import life_of_a_job_bp
from .processing_attack import processing_attack_bp
from .scheduling_attack import scheduling_attack_bp
from .update_db import update_db_bp
from .deficiency_tracker import deficiency_tracker_bp
from .limbo_job_tracker import limbo_job_tracker_bp
from .performance_summary import performance_summary_bp
from .webhook import webhook_bp



def register_blueprints(app):
    app.register_blueprint(auth_bp)
    app.register_blueprint(home_bp)
    app.register_blueprint(scheduling_bp)
    app.register_blueprint(data_analytics_bp)
    app.register_blueprint(life_of_a_job_bp)
    app.register_blueprint(processing_attack_bp)
    app.register_blueprint(scheduling_attack_bp)
    app.register_blueprint(update_db_bp)
    app.register_blueprint(deficiency_tracker_bp)
    app.register_blueprint(limbo_job_tracker_bp)
    app.register_blueprint(performance_summary_bp)
    app.register_blueprint(webhook_bp)
    init_cache(app)

