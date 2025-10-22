import os
import requests
from app import create_app
from datetime import datetime, timedelta

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

# ---------------------------------------------------------------------------
#  🔐 SERVICE TRADE AUTHENTICATION
# ---------------------------------------------------------------------------
def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    resp = api_session.post(auth_url, json={"username": username, "password": password})
    resp.raise_for_status()
    print("Authenticated to ServiceTrade")


def call_service_trade_api(endpoint: str, params=None):
    url = f"{SERVICE_TRADE_API_BASE}/{endpoint}"
    resp = api_session.get(url, params=params or {})
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
#  🚀 MAIN
# ---------------------------------------------------------------------------
def main():
    st_app = create_app()
    with st_app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit(" Missing PROCESSING_USERNAME / PROCESSING_PASSWORD environment variables.")

        authenticate(username, password)

        # -----------------------------------------------------------------------
        resp = call_service_trade_api("job", params={
            'status': 'completed', 
            'isInvoiced': False,
            'scheduleDateFrom': datetime.timestamp((datetime.now() - timedelta(days=365))), 
            'scheduleDateTo': datetime.timestamp(datetime.now() + timedelta(80))})
        
        jobs = resp.get("data", {}).get("jobs", [])
        print(f"Retrieved {len(jobs)} jobs to be invoiced from a year ago to today from ServiceTrade.")

        
       


if __name__ == "__main__":
    main()