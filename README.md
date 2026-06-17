# Schedule Assist (Cantec BI)

Flask API and session-backed backend with a **React + Vite** SPA in `frontend/`.

There is **no** repo-root `static/` or `templates/` folder anymore: the UI is the SPA, and optional Jinja templates would live under [`app/templates/`](app/templates/). One-off and scheduled **Python** jobs live under [`app/scripts/`](app/scripts/) (do not confuse with a removed empty root `scripts/` folder).

## Production

1. Build the SPA: `cd frontend && npm install && npm run build`
2. Set `DATABASE_URL`, `SECRET_KEY`, and other env vars (see `app/config.py`). For PostgreSQL/RDS, the app enables connection pool pre-ping and recycle so idle dropped connections do not cause 500s.
3. Run the Flask app with the same factory the dev server uses, after the SPA build exists under `frontend/dist/`. Example with Gunicorn:

   `gunicorn --bind 0.0.0.0:8000 --factory app:create_app`

   For local development you can still use `python run.py` or `flask run` (see `.flaskenv`).

   Flask serves `frontend/dist/index.html` for **`GET /`** and other SPA entry routes, plus `/assets/*` for Vite chunks. The technician portal PWA also requires Flask to serve `/sw.js`, `/manifest.webmanifest`, and `/workbox-*.js` from `frontend/dist/` (see [`app/spa.py`](app/spa.py)).

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

## Technician portal (`/tech`)

Field technicians use a public, PIN-gated portal at `/tech` to pick today's monthly route and open the worksheet without a staff sign-in. To enable it, set `TECHNICIAN_PORTAL_PIN` in the environment (e.g. in [`app/.env`](app/.env)) to the shared PIN — when unset, `POST /api/technician_portal/auth` returns **503 portal_disabled**. Rotate by changing the env var and restarting the app. The flow is: `/tech` (PIN) → `/tech/technician` (name) → `/tech/home` (start a monthly run or look up a location) → `/tech/start` (today's expected routes by `weekday_iso`/`week_occurrence`, plus a manual route-number lookup) or `/tech/location/:locationId` (read-only site reference) → existing worksheet at `/tech/route/:routeId/worksheet/:monthIso`.

The portal is a **PWA** (installable from Safari, scoped to `/tech`) so field iPads can reload the app shell offline after one online visit; worksheet data and pending edits are cached client-side. See [monthly route testing — field iPad setup](docs/monthly-route-testing-system.md).

### Training route (live sync demo)

Route **R99** (override with `TECHNICIAN_DEMO_ROUTE_NUMBER`) is reserved for technician training. It uses the real worksheet API, SSE sync, and offline queues — not an in-memory mock.

**One-time setup** (or after deploy):

```bash
python -m app.scripts.seed_technician_demo_route
```

**Reset the current month** before or after a class:

```bash
python -m app.scripts.seed_technician_demo_route --reset
```

Technicians open it from `/tech/start` → **Training route (live sync)** after PIN and name entry. Instructors can open the office paperwork URL from the worksheet banner to demonstrate live sync on a laptop. See [Training demo walkthrough](docs/monthly-route-testing-system.md#training-demo-walkthrough) in the monthly route testing doc.

## Monday Meeting — service deficiency filters

The **Service** tab excludes record-only deficiencies from pipeline KPIs using:

1. **Keyword denylist** — phrases in `deficiency_non_quoteable_phrase` (managed at `/monday_meeting/service/admin`).
2. **Stale similarity clusters** — unquoted deficiencies 90+ business days old that match similar descriptions in groups of 2+, where no cluster member was ever quoted.

Classification runs automatically after `update_deficiencies()` and can be refreshed manually from the admin page or:

`PYTHONPATH=. python scripts/classify_deficiency_service_eligibility.py`

Apply migration `b2c3d4e5f6a8` before using this feature.

From the **Excluded deficiencies** modal on the Service tab, you can **Include in metrics** for any filter-excluded deficiency. Overrides are stored on `deficiency_service_eligibility.included_override` and survive automatic reclassification. Use **Exclude again** to remove an override and re-run classification for that deficiency.

## Smoke checklist (after deploy)

- Login / logout
- Monday Meeting loads as default landing page (`/`, `/home` redirect, post-login)
- Scheduling Assistant (compute JSON result)
- Keys: search, detail, sign out / return, metrics (`/keys/metrics`)
- Each navbar destination loads
- Performance summary: date filter, both tabs (charts load)
- Webhook status JSON; Update DB table + POST update

## Removed

- **Fleet overview** (blueprint, templates, and related static assets) has been removed.
