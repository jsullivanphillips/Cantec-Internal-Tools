import os
import requests
import re
import msal
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from app import create_app
from dotenv import load_dotenv
import unicodedata

load_dotenv()

CLIENT_ID = os.getenv("CLIENT_ID")
TENANT_ID = os.getenv("TENANT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
INCOMING_BACKFLOWS_FOLDER_ID = os.getenv("INCOMING_BACKFLOWS_FOLDER_ID")
OUSTANDING_BACKFLOWS_FOLDER_ID = os.getenv("OUTSTANDING_BACKFLOWS_FOLDER_ID")

AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPE = ["https://graph.microsoft.com/.default"]
USER_EMAIL = "service@cantec.ca"
PORTAL_LINK = "https://crims.crd.bc.ca/ccc-portal/device-testers/"

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
#  🔐 GRAPH AUTHENTICATION
# ---------------------------------------------------------------------------

def get_graph_token():
    """Authenticate with Microsoft Graph using client credentials."""
    app = msal.ConfidentialClientApplication(
        CLIENT_ID, authority=AUTHORITY, client_credential=CLIENT_SECRET
    )
    result = app.acquire_token_for_client(scopes=SCOPE)
    if "access_token" not in result:
        raise RuntimeError(f"Authentication failed: {result.get('error_description')}")
    return result["access_token"]


# ---------------------------------------------------------------------------
#  📬 EMAIL FETCHING
# ---------------------------------------------------------------------------

def get_recent_messages(headers, folder_id, top_n=10):
    """Fetch the most recent UNREAD messages from a specific folder."""
    url = (
        f"https://graph.microsoft.com/v1.0/users/{USER_EMAIL}/mailFolders/"
        f"{folder_id}/messages"
        f"?$top={top_n}&$orderby=receivedDateTime desc&$filter=isRead eq false"
    )
    resp = requests.get(url, headers=headers)
    resp.raise_for_status()
    return resp.json().get("value", [])


def get_full_message(headers, message_id):
    """Fetch full message details including body content."""
    url = f"https://graph.microsoft.com/v1.0/users/{USER_EMAIL}/messages/{message_id}"
    resp = requests.get(url, headers=headers)
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
#  🧠 EMAIL PARSING
# ---------------------------------------------------------------------------

def parse_device_assignment(html_content):
    """Extract address, login id, portal link, and full device details keyed by serial number."""
    soup = BeautifulSoup(html_content, "html.parser")
    text = soup.get_text(" ", strip=True)

    # 🏠 Address
    address_tag = soup.find("td", string="Address:")
    address = address_tag.find_next("td").get_text(strip=True) if address_tag else None

    # 🔑 Login ID
    login_id_match = re.search(
        r"The Login Id provided to you is:\s*([a-f0-9-]{36})", text, re.IGNORECASE
    )
    login_id = login_id_match.group(1) if login_id_match else None

    # 🌐 CRD portal link
    link_match = re.search(r"(https://crims\.crd\.bc\.ca/[^\s]+)", text, re.IGNORECASE)
    portal_link = link_match.group(1) if link_match else PORTAL_LINK

    # 🔧 Extract all installed device blocks
    device_blocks = re.split(r"Device Make:", text)
    devices = {}
    serial_numbers = []

    for block in device_blocks[1:]:
        make_match = re.search(r"^\s*([A-Za-z0-9\s\-/]+)", block)
        model_match = re.search(r"Device Model:\s*([A-Za-z0-9\-]+)", block)
        serial_match = re.search(r"Device Serial Number:\s*([A-Za-z0-9]+)", block)
        external_match = re.search(
            r"Device External Number:\s*(.*?)(?:Device|The Login Id provided|$)", block, re.DOTALL)
        type_match = re.search(r"Device Device Type:\s*([A-Za-z0-9]+)", block)
        location_match = re.search(
            r"Device Location:\s*(.*?)(?:Device|The Login Id provided|$)", block, re.DOTALL)
        size_match = re.search(
            r"Device Plumbing Fixture Size:\s*(.*?)(?:Device|The Login Id provided|$)", block, re.DOTALL)
        hazard_match = re.search(
            r"Device Hazard Type:\s*(.*?)(?:Device|The Login Id provided|$)", block, re.DOTALL)

        serial = serial_match.group(1).strip() if serial_match else None
        if not serial:
            continue

        serial_numbers.append(serial)
        devices[serial] = {
            "Make": make_match.group(1).strip() if make_match else None,
            "Model": model_match.group(1).strip() if model_match else None,
            "SerialNumber": serial,
            "ExternalNumber": external_match.group(1).strip() if external_match else None,
            "Type": type_match.group(1).strip() if type_match else None,
            "Location": location_match.group(1).strip() if location_match else None,
            "FixtureSize": size_match.group(1).strip() if size_match else None,
            "HazardType": hazard_match.group(1).strip() if hazard_match else None,
        }

    return {
        "Address": address,
        "LoginId": login_id,
        "PortalLink": portal_link,
        "SerialNumbers": serial_numbers,
        "Devices": devices,  # indexed by serial
    }

def extract_street_search(address: str) -> str:
    """
    Extracts the address number and first street word for ServiceTrade lookup.
    Example: '425 MICHIGAN ST VICTORIA, BC' -> '425 MICHIGAN'
    """
    if not address:
        return None

    # Capture pattern like: 425 MICHIGAN ST
    match = re.match(r"(\d+)\s+([A-Za-z'\-]+)", address.strip())
    if match:
        street_num = match.group(1)
        street_name = match.group(2).upper()
        return f"{street_num} {street_name}"
    return address

def normalize(s):
    """Safely normalize and uppercase serial numbers or strings."""
    if s is None:
        return ""
    if not isinstance(s, str):
        s = str(s)
    return unicodedata.normalize("NFKC", s).strip().upper()

# ---------------------------------------------------------------------------
#  📨 EMAIL HANDLERS
# ---------------------------------------------------------------------------

def handle_device_assignment(message, body_html):
    """Process a CRD device assignment email and return structured data."""
    parsed = parse_device_assignment(body_html)
    serials = parsed["SerialNumbers"]

    received_str = message.get("receivedDateTime")
    try:
        received_dt = datetime.fromisoformat(received_str.replace("Z", "+00:00"))
    except Exception:
        received_dt = None

    data = {
        "Type": "DeviceAssignment",
        "Subject": message.get("subject"),
        "From": message["from"]["emailAddress"]["address"],
        "Received": received_str,
        "ReceivedAt": received_dt,
        "Address": parsed["Address"],
        "SerialNumbers": serials,
        "LoginId": parsed["LoginId"],
        "PortalLink": parsed["PortalLink"],
        "Devices": parsed["Devices"],  # all device fields by serial
    }
    return data

# ---------------------------------------------------------------------------
#  🚀 MAIN
# ---------------------------------------------------------------------------
def main():
    # -----------------------------------------------------------------------
    #  Step 1. Authenticate with Microsoft Graph
    # -----------------------------------------------------------------------
    token = get_graph_token()
    headers = {"Authorization": f"Bearer {token}"}

    # -----------------------------------------------------------------------
    #  Step 2. Fetch and parse recent CRD emails
    # -----------------------------------------------------------------------
    messages = get_recent_messages(headers, OUSTANDING_BACKFLOWS_FOLDER_ID, top_n=100)
    print(f"\n Found {len(messages)} messages to process.\n")

    email_data = []

    for msg in messages:
        full_msg = get_full_message(headers, msg["id"])
        body_html = full_msg["body"]["content"]
        subject = msg.get("subject", "").lower()


        parsed = handle_device_assignment(msg, body_html)

        # Keep track of the message ID for moving later
        parsed["MessageId"] = msg["id"]
        email_data.append(parsed)
    

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

    st_app = create_app()
    with st_app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit(" Missing PROCESSING_USERNAME / PROCESSING_PASSWORD environment variables.")

        authenticate(username, password)

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
                existing_serials = [normalize(asset.get("properties", {}).get("serial", "")) for asset in assets]

                # Find serials that do not yet exist as assets
                missing_serials = [sn for sn in wanted_serials if sn not in existing_serials]

                if not matched_assets:
                    continue
                
                job_found = False
                jobs_found = 0
                job_ids = []
                for asset in matched_assets:
                    # See if there is a job on this location with this asset attached
                    resp = call_service_trade_api("job", params={"locationId": loc_id,
                            "scheduleDateFrom": datetime.timestamp(item["ReceivedAt"]),
                            "scheduleDateTo": datetime.timestamp((datetime.now()) + timedelta(days=90) ),
                            "status": "all",
                            "assetId": asset.get("id")})
                    jobs = resp.get("data", {}).get("jobs", [])
                    if jobs:
                        job_ids.extend([job.get("id") for job in jobs])
                        job_found = True
                        jobs_found += 1
                
                if jobs_found == len(matched_assets) and not missing_serials:
                    print(f"\n------\n{item["Address"]}: All assets have jobs scheduled.")
                    for job_id in job_ids:
                        print(f" - Job ID: {job_id}")
                elif jobs_found == len(matched_assets) and missing_serials:
                    print(f"\n------\n{item["Address"]}: All found assets have jobs scheduled, but missing assets")
                    for job_id in job_ids:
                        print(f" - Job ID: {job_id}")
                elif job_found:
                    print(f"\n------\n{item["Address"]}: Some assets have jobs scheduled.")
                    for job_id in job_ids:
                        print(f" - Job ID: {job_id}")

                    



        




if __name__ == "__main__":
    main()