# Schedule Assist (Cantec BI)

Flask API and session-backed backend with a **React + Vite** SPA in `frontend/`.

There is **no** repo-root `static/` or `templates/` folder anymore: the UI is the SPA, and optional Jinja templates would live under [`app/templates/`](app/templates/). One-off and scheduled **Python** jobs live under [`app/scripts/`](app/scripts/) (do not confuse with a removed empty root `scripts/` folder).

## Production

1. Build the SPA: `cd frontend && npm install && npm run build`
2. Set `DATABASE_URL`, `SECRET_KEY`, and other env vars (see `app/config.py`).
3. Run the Flask app with the same factory the dev server uses, after the SPA build exists under `frontend/dist/`. Example with Gunicorn:

   `gunicorn --bind 0.0.0.0:8000 --factory app:create_app`

   For local development you can still use `python run.py` or `flask run` (see `.flaskenv`).

   Flask serves `frontend/dist/index.html` for **`GET /`** and other SPA entry routes, plus `/assets/*` for Vite chunks.

**`flask run`:** With [`.flaskenv`](.flaskenv) (`FLASK_APP=app:create_app`), `flask run` loads the same factory as `python run.py`, including **`GET /`** → SPA. Install `python-dotenv` so Flask picks up `.flaskenv`.

If the SPA build is missing, protected pages return **503** with a message to run `npm run build`.

## Continuous integration

On push and pull requests, GitHub Actions runs `npm ci` and `npm run build` in `frontend/` (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Local development

1. **Backend:** activate your venv, install `requirements.txt`, run Flask on port **5000** with `python run.py` or `flask run` (use project root so `.flaskenv` applies).
2. **Frontend:** `cd frontend && npm install && npm run dev` (Vite on **5173**). The dev server proxies `/api` (and `/assets` for SPA chunks in some setups) to `http://127.0.0.1:5000`.
3. Open `http://127.0.0.1:5173` and sign in. Use in-app navigation; deep-link refresh on non-root paths may require using the Flask URL on **5000** after a production build, or staying within the Vite shell.

### Navbar logo

Add `cantec-logo-horizontal.png` to [`frontend/public/`](frontend/public/), then run `npm run build` so it is copied into `frontend/dist/`. The navbar loads it from `/cantec-logo-horizontal.png`. Flask serves that path from the dist root (see [`app/spa.py`](app/spa.py)); if the file is missing from `dist` after a build, the UI falls back to the text “Cantec”. Add other root `public/` files to the allowlist in `spa.py` if you need them on port 5000.

Legacy global styles from the old Flask static bundle now live under [`frontend/src/styles/`](frontend/src/styles/) (`base.css`, `legacy-global.css`).

## Smoke checklist (after deploy)

- Login / logout
- Home KPIs and “Needs attention” links
- Scheduling Assistant (compute JSON result)
- Keys: search, detail, sign out / return, metrics (`/keys/metrics`)
- Each navbar destination loads
- Performance summary: date filter, both tabs (charts load)
- Webhook status JSON; Update DB table + POST update

## Removed

- **Fleet overview** (blueprint, templates, and related static assets) has been removed.
