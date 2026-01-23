from flask import Blueprint, jsonify, render_template, session
from app.db_models import db, MonthlyRouteSnapshot
from sqlalchemy import desc
from .scheduling_attack import get_active_techs
from flask import redirect, url_for
import requests

monthly_specialist_bp = Blueprint(
    "monthly_specialist",
    __name__,
    template_folder="templates"
)


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
    return render_template("monthly_specialists.html")

@monthly_specialist_bp.route("/api/monthly_specialists")
def get_monthly_specialists():
    """
    Returns cached monthly route specialist data.
    One row per route, already aggregated.
    Filters top_technicians to only currently active techs.
    """

    # 1) Build a fast lookup set of ACTIVE tech names (trimmed + normalized)
    active_techs_raw = get_active_techs() or []
    active_name_set = {
        (t.get("name") or "").strip().casefold()
        for t in active_techs_raw
        if str(t.get("status", "")).lower() == "active"
        and t.get("isTech") is True
        and (t.get("name") or "").strip()
    }

    routes = (
        MonthlyRouteSnapshot.query
        .order_by(MonthlyRouteSnapshot.location_name.asc())
        .all()
    )

    def _extract_name(item):
        # supports either dicts like {"name": "..."} or raw strings like "Adam Bendorffe"
        if isinstance(item, dict):
            return (item.get("tech_name") or "").strip()
        if isinstance(item, str):
            return item.strip()
        return ""

    result = []
    for route in routes:
        top = route.top_technicians or []

        filtered_top = []
        for item in top:
            print(item)
            nm = _extract_name(item)
            if nm and nm.casefold() in active_name_set:
                filtered_top.append(item)

        result.append({
            "location_id": route.location_id,
            "location_name": route.location_name,
            "completed_jobs_count": route.completed_jobs_count,
            "top_technicians": filtered_top,
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
