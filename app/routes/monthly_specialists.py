from flask import Blueprint, jsonify, session
from app.db_models import MonthlyRouteSnapshot
from flask import redirect, url_for
import requests

from app.spa import send_spa_index
from app.response_cache import cached_json_response

monthly_specialist_bp = Blueprint("monthly_specialist", __name__)


@monthly_specialist_bp.route('/monthly_specialist', methods=['GET'])
def monthly_specialists():
    # Serve the HTML page
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {
        "username": session.get('username'),
        "password": session.get('password')
    }

    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        return redirect(url_for("auth.login"))  # or whatever your login route is
    return send_spa_index()

@monthly_specialist_bp.route("/api/monthly_specialists")
@cached_json_response(prefix="monthly_specialists:list", ttl_seconds=180)
def get_monthly_specialists():
    """
    Returns cached monthly route specialist data.
    One row per ServiceTrade *route* clock-in location (``MonthlyRouteSnapshot.location_id``),
    not per street-address row in ``MonthlyRouteLocation``.
    ``top_technicians`` lists everyone attributed from completed jobs (including former techs).
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
