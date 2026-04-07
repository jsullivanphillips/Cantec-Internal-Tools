"""Serve SPA from Vite in dev, frontend/dist in production."""
import os

from flask import abort, redirect, request, send_from_directory


def frontend_dist_path() -> str:
    basedir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    return os.path.join(basedir, "frontend", "dist")


def send_spa_index():
    """Return index.html for client-side routing.

    Dev (FLASK_DEBUG=1): redirect to Vite dev server for HMR.
    Prod: serve built frontend/dist/index.html.
    """
    if os.environ.get("FLASK_DEBUG") in ("1", "true", "True"):
        dev_url = (os.environ.get("SPA_DEV_SERVER_URL") or "http://127.0.0.1:5173").rstrip("/")
        path = (request.path or "/").lstrip("/")
        target = f"{dev_url}/{path}" if path else f"{dev_url}/"
        if request.query_string:
            target = f"{target}?{request.query_string.decode('utf-8', errors='ignore')}"
        return redirect(target, code=307)

    dist = frontend_dist_path()
    index_path = os.path.join(dist, "index.html")
    if not os.path.isfile(index_path):
        abort(
            503,
            description="Frontend build missing. Run: cd frontend && npm install && npm run build",
        )
    return send_from_directory(dist, "index.html")


def register_spa_static_routes(app):
    """Serve /assets/* from Vite build (hashed chunks). Register before page routes if needed."""
    dist = frontend_dist_path()

    @app.route("/assets/<path:filename>")
    def vite_assets(filename):
        assets_dir = os.path.join(dist, "assets")
        if not os.path.isdir(assets_dir):
            abort(503)
        return send_from_directory(assets_dir, filename)

    # Files from frontend/public/ are copied to dist/ root by Vite; Flask must expose them explicitly
    # (unlike /assets/*). Keep this list in sync with files linked from index.html or the SPA.
    _dist_root_files = frozenset({"cantec-logo-horizontal.png", "vite.svg"})

    def _send_dist_root(filename: str):
        if filename not in _dist_root_files:
            abort(404)
        path = os.path.join(dist, filename)
        if not os.path.isfile(path):
            abort(404)
        dist_real = os.path.realpath(dist)
        file_real = os.path.realpath(path)
        if os.path.commonpath([dist_real, file_real]) != dist_real:
            abort(404)
        return send_from_directory(dist, filename)

    @app.get("/cantec-logo-horizontal.png")
    def spa_cantec_logo():
        return _send_dist_root("cantec-logo-horizontal.png")

    @app.get("/vite.svg")
    def spa_vite_svg():
        return _send_dist_root("vite.svg")
