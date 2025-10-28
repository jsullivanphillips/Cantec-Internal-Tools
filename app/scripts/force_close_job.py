import os
import requests
from app import create_app
from dotenv import load_dotenv

load_dotenv()

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
        url = f"{SERVICE_TRADE_API_BASE}/job/1943318847949057"

        try:
            resp = api_session.put(url, json={"status": "completed"})
            print(f"Response code: {resp.status_code}")
            resp.raise_for_status()
        except requests.HTTPError as e:
            print(f"HTTP error {resp.status_code}: {e}")
        
        print(resp.status_code)


if __name__ == "__main__":
    main()
