"""JSON auth endpoints for the React SPA (session cookie unchanged)."""
import requests
from flask import Blueprint, jsonify, request, session

api_auth_bp = Blueprint("api_auth", __name__, url_prefix="/api/auth")


@api_auth_bp.route("/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"ok": False, "error": "Username and password required"}), 400

    user_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": username, "password": password}
    try:
        auth_response = user_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        return jsonify({"ok": False, "error": f"Authentication failed: {e!s}"}), 401

    account_url = "https://api.servicetrade.com/api/account"
    try:
        account_response = user_session.get(account_url)
        account_response.raise_for_status()
        account_data = account_response.json()
        account_timezone = account_data["data"]["accounts"][0]["timezone"]
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to retrieve account timezone: {e!s}"}), 401

    session["authenticated"] = True
    session["username"] = username
    session["password"] = password
    session["account_timezone"] = account_timezone

    return jsonify({"ok": True, "redirect": "/home"})


@api_auth_bp.route("/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True, "redirect": "/login"})


@api_auth_bp.route("/me", methods=["GET"])
def api_me():
    return jsonify(
        {
            "authenticated": bool(session.get("authenticated")),
            "username": session.get("username"),
            "account_timezone": session.get("account_timezone"),
        }
    )
