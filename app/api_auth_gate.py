"""Return 401 JSON for unauthenticated /api/* requests (SPA uses fetch + JSON)."""
import re

from flask import jsonify, request, session


# Worksheet endpoints a PIN-unlocked technician needs:
#   GET   /api/monthly_routes/routes/<id>
#   GET   /api/monthly_routes/routes/<id>/worksheet
#   GET   /api/monthly_routes/routes/<id>/worksheet/stream   (SSE)
#   PATCH /api/monthly_routes/routes/<id>/worksheet/rows/<locId>
#   POST  /api/monthly_routes/routes/<id>/worksheet/reset_run
#   GET   /api/monthly_routes/routes/<id>/worksheet/rows/<locId>/audit
_PORTAL_WORKSHEET_PATH_RE = re.compile(
    r"^/api/monthly_routes/routes/\d+(?:/worksheet(?:/(?:stream|reset_run|rows/\d+(?:/audit)?))?)?$"
)


def register_api_session_auth(app):
    exempt_prefixes = ("/api/auth/", "/api/technician_portal/")

    def _keys_tool_public_api(path: str) -> bool:
        """Technicians use Keys without staff login; allow /api/keys/* except internal metrics."""
        if not path.startswith("/api/keys"):
            return False
        if path == "/api/keys/metrics" or path.startswith("/api/keys/metrics/"):
            return False
        return True

    def _portal_unlocked_api(path: str) -> bool:
        """When the technician portal is unlocked in this session, allow worksheet endpoints."""
        if not session.get("tech_portal_unlocked"):
            return False
        return bool(_PORTAL_WORKSHEET_PATH_RE.match(path))

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
        if _portal_unlocked_api(path):
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
