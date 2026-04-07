"""Return 401 JSON for unauthenticated /api/* requests (SPA uses fetch + JSON)."""
from flask import jsonify, request, session


def register_api_session_auth(app):
    exempt_prefixes = ("/api/auth/",)

    @app.before_request
    def _require_session_for_api():
        if request.method == "OPTIONS":
            return None
        path = request.path or ""
        if not path.startswith("/api/"):
            return None
        for prefix in exempt_prefixes:
            if path.startswith(prefix):
                return None
        if session.get("authenticated"):
            return None
        return (
            jsonify(
                {
                    "error": "Authentication required",
                    "code": "auth_required",
                }
            ),
            401,
        )
