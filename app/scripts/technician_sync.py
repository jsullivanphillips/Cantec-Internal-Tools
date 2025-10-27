
from datetime import datetime, timezone
import requests
import os
from app import create_app
from app.db_models import db, Technician


SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

non_tech_names = ['Jordan Zwicker', 'Shop Tech', 'Sub Contractors']

def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    resp = api_session.post(auth_url, json={"username": username, "password": password})
    resp.raise_for_status()
    print("Authenticated with Service Trade")


def sync_technicians_from_st():
    app = create_app()
    with app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)
        """Sync active technicians from ServiceTrade to the local database."""
        response = api_session.get(f"{SERVICE_TRADE_API_BASE}/user", params={"limit": 1000})
        response.raise_for_status()
        users = response.json().get("data", {}).get("users", [])

        
        print({u["name"] for u in users if u.get("isTech") and u.get("status") == "active"})

        st_names = {u["name"] for u in users if u.get("isTech") and u.get("status") == "active"}
        db_names = {t.name for t in Technician.query.all()}

        # Add new techs
        for name in st_names - db_names:
            if name not in non_tech_names:
                db.session.add(Technician(name=name, active=True, updated_on_st=datetime.now(timezone.utc)))

        # Mark inactive techs
        for tech in Technician.query.all():
            tech.active = tech.name in st_names
            tech.updated_on_st = datetime.now(timezone.utc)

        db.session.commit()

def main():
    sync_technicians_from_st()

if __name__ == "__main__":
    print("compiled")
    main()
