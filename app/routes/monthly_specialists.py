from flask import Blueprint, jsonify, render_template
from app.db_models import db, MonthlyRouteSnapshot
from sqlalchemy import desc

monthly_specialist_bp = Blueprint(
    "monthly_specialist",
    __name__,
    template_folder="templates"
)


@monthly_specialist_bp.route('/monthly_specialist', methods=['GET'])
def monthly_specialists():
    # Serve the HTML page
    return render_template("monthly_specialists.html")

@monthly_specialist_bp.route("/api/monthly_specialists")
def get_monthly_specialists():
    """
    Returns cached monthly route specialist data.
    One row per route, already aggregated.
    """

    routes = (
        MonthlyRouteSnapshot.query
        .order_by(MonthlyRouteSnapshot.location_name.asc())
        .all()
    )

    result = []
    for route in routes:
        result.append({
            "location_id": route.location_id,
            "location_name": route.location_name,
            "completed_jobs_count": route.completed_jobs_count,
            "top_technicians": route.top_technicians or [],
            "last_updated_at": (
                route.last_updated_at.isoformat()
                if route.last_updated_at
                else None
            ),
        })

    return jsonify({
        "routes": result,
        "route_count": len(result),
    })
