from datetime import datetime, timedelta
import requests
import os
from app import create_app


SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    resp = api_session.post(auth_url, json={"username": username, "password": password})
    resp.raise_for_status()
    print("Authenticated with Service Trade")


# Wanna try and find all scheduled jobs that have a report_conversion or v8_conversion tag
# Return the number of jobs and the earliest scheduled job that requires report conversion
def find_report_conversion_jobs():
    app = create_app()
    with app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)

        # Grab locations with Report_conversion tag
        params = {
            "tag": "Report_Conversion",
            "limit": 1000
        }
        response = api_session.get(f"{SERVICE_TRADE_API_BASE}/location", params=params)
        response.raise_for_status()
        locations = response.json().get("data", {}).get("locations", [])
        print(f"\nfound {len(locations)} locations")

        location_ids = ""
        for l in locations:
            l_id = l.get("id")
            print(f"{l.get("address").get("street")}: {l.get("id")}")
            location_ids += f"{l_id},"
        
        params = {
            "status": "scheduled",
            "scheduleDateFrom": datetime.timestamp(datetime.now()),
            "scheduleDateTo": datetime.timestamp(datetime.now() + timedelta(days=180)),
            "locationId": location_ids,
            "type": "inspection"
        }
        response = api_session.get(f"{SERVICE_TRADE_API_BASE}/job", params=params)
        response.raise_for_status()
        jobs = response.json().get("data", {}).get("jobs", [])
        print(f"found {len(jobs)} jobs")
    
        # Sort jobs by job.get("scheduledDate")
        jobs.sort(key=lambda job: job.get("scheduledDate"))

        for job in jobs:
            print(f"{job.get("location").get("address").get("street")}: {job.get("id")} : Scheduled -> {datetime.fromtimestamp(job.get("scheduledDate"))}")

        return len(locations), jobs




def main():
    find_report_conversion_jobs()

if __name__ == "__main__":
    main()
