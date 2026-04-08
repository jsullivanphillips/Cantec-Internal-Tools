"""Return 401 JSON for unauthenticated /api/* requests (SPA uses fetch + JSON)."""
from flask import jsonify, request, session


def register_api_session_auth(app):
    exempt_prefixes = ("/api/auth/",)

    def _keys_tool_public_api(path: str) -> bool:
        """Technicians use Keys without staff login; allow /api/keys/* except internal metrics."""
        if not path.startswith("/api/keys"):
            return False
        if path == "/api/keys/metrics" or path.startswith("/api/keys/metrics/"):
            return False
        return True

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
        if _keys_tool_public_api(path):
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
