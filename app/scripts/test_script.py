from datetime import datetime, timedelta
import requests
import os
import json
from app import create_app
import msal
from dotenv import load_dotenv
from app.scripts.backflow_automation import get_graph_token, get_recent_messages, get_full_message, normalize, extract_street_search, handle_test_result, handle_device_assignment

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

load_dotenv()

CLIENT_ID = os.getenv("CLIENT_ID")
TENANT_ID = os.getenv("TENANT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
INCOMING_BACKFLOWS_FOLDER_ID = os.getenv("INCOMING_BACKFLOWS_FOLDER_ID")
OUTSANDING_BACKFLOWS_FOLDER_ID = os.getenv("OUTSTANDING_BACKFLOWS_FOLDER_ID")
ASSIGNED_COMPLETED_BACKFLOWS_FOLDER_ID = os.getenv("ASSIGNED_COMPLETED_BACKFLOWS_FOLDER_ID")

AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPE = ["https://graph.microsoft.com/.default"]
USER_EMAIL = "service@cantec.ca"
PORTAL_LINK = "https://crims.crd.bc.ca/ccc-portal/device-testers/"

def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    resp = api_session.post(auth_url, json={"username": username, "password": password})
    resp.raise_for_status()
    print("Authenticated with Service Trade")

def call_service_trade_api(endpoint: str, params=None):
    url = f"{SERVICE_TRADE_API_BASE}/{endpoint}"
    resp = api_session.get(url, params=params or {})
    resp.raise_for_status()
    return resp.json()

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


def update_backflow_visibility():
    processed_emails = 0
    # -----------------------------------------------------------------------
    #  Step 1. Authenticate with Microsoft Graph
    # -----------------------------------------------------------------------
    token = get_graph_token()
    headers = {"Authorization": f"Bearer {token}"}

    # -----------------------------------------------------------------------
    #  Step 2. Fetch and parse recent CRD emails
    # -----------------------------------------------------------------------
    messages = get_recent_messages(headers, ASSIGNED_COMPLETED_BACKFLOWS_FOLDER_ID, top_n=150)
    print(f"\n Found {len(messages)} messages to process.\n")

    email_data = []

    for msg in messages:
        full_msg = get_full_message(headers, msg["id"])
        body_html = full_msg["body"]["content"]
        subject = msg.get("subject", "").lower()

        if "accepted" in subject:
            parsed = handle_test_result(msg, body_html)
        else:
            parsed = handle_device_assignment(msg, body_html)

        # Keep track of the message ID for moving later
        parsed["MessageId"] = msg["id"]
        email_data.append(parsed)

    # -----------------------------------------------------------------------
    #  Step 3. Filter duplicate serial numbers based on ReceivedAt timestamps
    # -----------------------------------------------------------------------

    # Build map of serial -> item, but avoid duplicating same item reference
    serial_map = {}
    unique_items = []

    for item in email_data:
        added = False
        for sn in item.get("SerialNumbers", []):
            serial_map.setdefault(sn.upper(), []).append(item)
            added = True
        if added and item not in unique_items:
            unique_items.append(item)

    # Now apply filtering logic once per unique item, not per serial
    filtered_data = []

    for item in unique_items:
        serials = item.get("SerialNumbers", [])
        if not serials:
            continue

        # Apply duplicate filtering logic across emails with shared serials
        duplicates = []
        for sn in serials:
            duplicates.extend(serial_map.get(sn.upper(), []))

        duplicates = sorted(
            [r for r in duplicates if r.get("ReceivedAt")],
            key=lambda r: r["ReceivedAt"]
        )

        if duplicates:
            latest = duplicates[-1]
            filtered_data.append(latest)

    # -----------------------------------------------------------------------
    #  Step 4. Authenticate with ServiceTrade
    # -----------------------------------------------------------------------
    st_app = create_app()
    with st_app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit(" Missing PROCESSING_USERNAME / PROCESSING_PASSWORD environment variables.")

        authenticate(username, password)

        # -------------------------------------------------------------------
        #  Step 5. Query ServiceTrade for matching locations and assets
        # -------------------------------------------------------------------
        for item in filtered_data:
            address = item.get("Address")
            if not address:
                print(f" No address found for '{item['Subject']}' — skipping.")
                continue

            search_name = extract_street_search(address)
            resp = call_service_trade_api("location", params={"name": search_name, "status": "active"})
            locations = resp.get("data", {}).get("locations", [])
            item["ServiceTradeLocations"] = locations

            for loc in locations:
                loc_id = loc.get("id")
                if not loc_id:
                    continue

                # Fetch all existing assets for this location
                assets_resp = call_service_trade_api("asset", params={"locationId": loc_id})
                assets = assets_resp.get("data", {}).get("assets", [])

                # Normalize serials for comparison
                wanted_serials = [normalize(sn) for sn in item.get("SerialNumbers", [])]
                matched_assets = [
                    asset for asset in assets
                    if normalize(asset.get("properties", {}).get("serial", "")) in wanted_serials
                ]

                for asset in matched_assets:
                    asset_id = asset.get("id")
                    entity_type = 2  # Asset

                    # Fetch and filter existing comments
                    resp = call_service_trade_api("comment", params={"entityId": asset_id, "entityType": entity_type})
                    comments = resp.get("data", {}).get("comments", [])

                    for comment in comments:
                        comment_id = comment.get("id")
                        update_url = f"{SERVICE_TRADE_API_BASE}/comment/{comment_id}"
                        visibility = comment.get("visibility", [])

                        if "tech" in visibility:
                            # Already visible to techs — skip
                            continue

                        payload = {
                            "visibility": ["tech"]
                        }
                        update_resp = api_session.put(update_url, json=payload)
                        update_resp.raise_for_status()

                        print(f"-----\n[{loc.get("address").get("street")} - {loc.get("id")}]\nUpdated comment for tech visibility.\nPrevious visibility: {comment.get("visibility")}\nResponse: {update_resp.json().get("data").get("visibility")}")
                        


def main():
    update_backflow_visibility()

if __name__ == "__main__":
    main()
