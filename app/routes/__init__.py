# app/routes/__init__.py
from .api_auth import api_auth_bp
from .auth import auth_bp
from .home import home_bp
from .scheduling import scheduling_bp
from .processing_attack import processing_attack_bp
from .scheduling_attack import scheduling_attack_bp
from .deficiency_tracker import deficiency_tracker_bp
from .limbo_job_tracker import limbo_job_tracker_bp
from .performance_summary import performance_summary_bp
from .pink_folder import pink_folder_bp
from .webhook import webhook_bp
from .monthly_specialists import monthly_specialist_bp
from .keys import keys_bp


def register_blueprints(app):
    app.register_blueprint(api_auth_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(home_bp)
    app.register_blueprint(scheduling_bp)
    app.register_blueprint(processing_attack_bp)
    app.register_blueprint(scheduling_attack_bp)
    app.register_blueprint(deficiency_tracker_bp)
    app.register_blueprint(limbo_job_tracker_bp)
    app.register_blueprint(performance_summary_bp)
    app.register_blueprint(pink_folder_bp)
    app.register_blueprint(webhook_bp)
    app.register_blueprint(monthly_specialist_bp)
    app.register_blueprint(keys_bp)

