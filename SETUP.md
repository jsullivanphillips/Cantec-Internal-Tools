# Schedule Assist - Local Setup (Contributor Onboarding)

Use this guide to set up a brand-new machine for local development.

## AI Agent Quick Context

If an AI coding agent is helping with setup, provide this block first:

```txt
Project: Schedule Assist (Flask backend + React/Vite frontend)
OS: Windows (PowerShell)
Backend: Python 3.11+, Flask, SQLAlchemy, Flask-Migrate
Frontend: Node 20 LTS, npm
Database: PostgreSQL (local)
Run backend on: http://127.0.0.1:5000
Run frontend on: http://127.0.0.1:5173
Important: Do NOT use production DATABASE_URL locally.
Important: .env is gitignored; create your own local .env at repo root.
```

## 1) Install Prerequisites

- Git
- Python 3.11+ (`python --version`)
- Node.js 20 LTS (`node -v`, `npm -v`)
- PostgreSQL 15+ (`psql --version`)

## 2) Clone and Enter Project

```powershell
git clone <repo-url>
cd "Schedule Assist"
```

## 3) Backend Setup (Python + Flask)

Create and activate virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install backend dependencies:

```powershell
pip install -r requirements.txt
```

## 4) Create Local PostgreSQL Database

Open `psql` (or pgAdmin) and run:

```sql
CREATE DATABASE schedule_assist_dev;
CREATE USER schedule_assist_user WITH PASSWORD 'change_this_password';
GRANT ALL PRIVILEGES ON DATABASE schedule_assist_dev TO schedule_assist_user;
```

## 5) Create Local `.env` (Repo Root)

Create a file named `.env` in the repo root (this file is ignored by git).

Template:

```dotenv
SECRET_KEY=replace-with-random-long-string
DATABASE_URL=postgresql://schedule_assist_user:change_this_password@localhost:5432/schedule_assist_dev

# ServiceTrade credentials (ask project owner for approved dev credentials)
SERVICE_TRADE_USERNAME=
SERVICE_TRADE_PASSWORD=

# Some scripts/routes use these names:
PROCESSING_USERNAME=
PROCESSING_PASSWORD=

# Safety guard: prevents debug server from booting if URL contains this text
# Set to a fragment that appears in your prod DB URL/host/name.
DEV_BLOCK_DATABASE_URL_CONTAINING=prod
```

Notes:
- Do not copy production database credentials into local `.env`.
- `DEV_BLOCK_DATABASE_URL_CONTAINING` is optional but strongly recommended.

## 6) Run Database Migrations

With venv active:

```powershell
flask db upgrade
```

Optional sanity check:

```powershell
flask db-verify
```

## 7) Frontend Setup (React + Vite)

```powershell
cd frontend
npm install
cd ..
```

`frontend/.env.development` already sets:

```dotenv
VITE_API_BASE_URL=
```

Blank value means frontend calls backend at same origin via local dev proxy behavior in this project.

## 8) Run the App (Two Terminals)

Terminal A (backend):

```powershell
.\.venv\Scripts\Activate.ps1
python run.py
```

Terminal B (frontend):

```powershell
cd frontend
npm run dev
```

Open:
- `http://127.0.0.1:5173` for normal frontend dev
- Backend API/debug at `http://127.0.0.1:5000`

## 9) First-Day Verify Checklist

- Backend starts without DB errors.
- `flask db upgrade` completes successfully.
- Frontend loads at port 5173.
- You can sign in and load core pages.
- No production data is being used.

## 10) Collaboration Workflow (Short Version)

- Branch from `main`:
  - `git checkout main`
  - `git pull origin main`
  - `git checkout -b feature/<short-name>`
- Commit and push your branch.
- Open a Pull Request into `main`.
- Merge PR after review (do not push directly to `main`).

## Troubleshooting

- `ModuleNotFoundError` / Flask command missing:
  - venv is not active; activate `.\.venv\Scripts\Activate.ps1`
- DB connection errors:
  - check `DATABASE_URL`, PostgreSQL service running, username/password
- Migration drift:
  - run `flask db upgrade` again and verify correct local DB URL
- Frontend cannot reach backend:
  - confirm backend running on port 5000 and frontend on 5173
