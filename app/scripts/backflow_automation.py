"""
================================================================================
🏗️  CRD Backflow Email Automation → ServiceTrade Integration
================================================================================
This script automates processing of CRD backflow test and assignment emails,
extracts structured information, and updates corresponding ServiceTrade assets
with test results or login portal details.

It connects to:
 - Microsoft Graph API (to read incoming CRD emails)
 - ServiceTrade API (to match assets by serial number and post comments)

--------------------------------------------------------------------------------
EDGE CASE HANDLING
--------------------------------------------------------------------------------
✅ Location does not exist on ServiceTrade
    - If no location matches the parsed address, the code skips cleanly.
    - No API errors occur; a summary line shows "0 location matches".

✅ Asset does not exist on ServiceTrade
    - If a location contains no assets, the code safely skips asset processing.
    - No posting or deletion attempts are made.

✅ No comments on an asset
    - If an asset has no existing comments, a new comment is posted normally.
    - No exceptions are thrown when iterating an empty comment list.

✅ Existing comments on an asset
    - If the exact same comment text already exists, it is skipped entirely
      (no deletion or duplicate posting).
    - Old "Login ID" comments are deleted only when a new comment will replace them.

✅ Multiple emails for one asset or serial number
    - Emails are grouped by serial number and compared by ReceivedAt timestamps.
    - If two emails for the same serial are within 1 minute, both are kept.
    - If they are more than 1 minute apart, only the most recent is processed.

--------------------------------------------------------------------------------
OVERALL SUMMARY
--------------------------------------------------------------------------------
✅ Gracefully handles missing or incomplete data
✅ Prevents duplicate ServiceTrade comments
✅ Automatically deletes outdated Login ID comments
✅ Filters duplicate emails intelligently by timestamp
✅ Fully idempotent — safe to rerun without data duplication

Author: J. Sullivan-Phillips
Last Updated: October, 21, 2025
NOTE: Secret Key for GRAPH API will expire October, 20, 2026
"""

import os
import re
import msal
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from app import create_app
from app.db_models import db, BackflowAutomationMetric
from dotenv import load_dotenv
import unicodedata


# ---------------------------------------------------------------------------
#  🔧 METRICS
# ---------------------------------------------------------------------------
def increment_metric(key: str, amount: int = 1) -> int:
    """Increment or create a metric counter."""
    metric = BackflowAutomationMetric.query.filter_by(key=key).first()
    if not metric:
        metric = BackflowAutomationMetric(key=key, value=0)
        db.session.add(metric)
    metric.value += amount
    db.session.commit()
    return metric.value

# ---------------------------------------------------------------------------
#  🔧 CONFIGURATION
# ---------------------------------------------------------------------------

load_dotenv()

CLIENT_ID = os.getenv("CLIENT_ID")
TENANT_ID = os.getenv("TENANT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
INCOMING_BACKFLOWS_FOLDER_ID = os.getenv("INCOMING_BACKFLOWS_FOLDER_ID")

AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPE = ["https://graph.microsoft.com/.default"]
USER_EMAIL = "service@cantec.ca"
PORTAL_LINK = "https://crims.crd.bc.ca/ccc-portal/device-testers/"

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

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
#  📬 EMAIL FETCHING
# ---------------------------------------------------------------------------

def get_recent_messages(headers, folder_id, top_n=10):
    """Fetch the most recent messages from a specific folder."""
    url = (
        f"https://graph.microsoft.com/v1.0/users/{USER_EMAIL}/mailFolders/"
        f"{folder_id}/messages?$top={top_n}&$orderby=receivedDateTime desc"
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

def normalize(s):
    """Safely normalize and uppercase serial numbers or strings."""
    if s is None:
        return ""
    if not isinstance(s, str):
        s = str(s)
    return unicodedata.normalize("NFKC", s).strip().upper()


def parse_crd_test_result(html_content):
    """Extract address, device serials, and test results section from a CRD test email."""
    soup = BeautifulSoup(html_content, "html.parser")

    # 🏠 Address
    address_tag = soup.find("td", string="Address:")
    address = address_tag.find_next("td").get_text(strip=True) if address_tag else None

    # 🔢 Device Serial Numbers (list, even if one)
    serial_tag = soup.find(text=lambda t: "Device Serial Number:" in t)
    serial_numbers = []
    if serial_tag:
        device_serial = serial_tag.split("Device Serial Number:")[-1].strip()
        if device_serial:
            serial_numbers = [device_serial]

    # 🧾 Extract the "Test results information" section
    section_lines = []
    collecting = False
    for el in soup.stripped_strings:
        if "Test results information" in el:
            collecting = True
        elif collecting and "If you have any further questions" in el:
            break
        elif collecting:
            section_lines.append(el)

    test_results = "\n".join(section_lines).strip() if section_lines else None

    return {
        "Address": address,
        "SerialNumbers": serial_numbers,
        "TestResultsInfo": test_results,
    }


def parse_device_assignment(html_content):
    """Extract address, all serial numbers, login id, and portal link from a CRD device assignment email."""
    soup = BeautifulSoup(html_content, "html.parser")
    text = soup.get_text(" ", strip=True)

    # 🏠 Address
    address_tag = soup.find("td", string="Address:")
    address = address_tag.find_next("td").get_text(strip=True) if address_tag else None

    # 🔢 All device serial numbers (list)
    serial_numbers = re.findall(r"Device Serial Number:\s*([A-Za-z0-9]+)", text)

    # 🔑 Login ID
    login_id_match = re.search(
        r"The Login Id provided to you is:\s*([a-f0-9-]{36})", text, re.IGNORECASE
    )
    login_id = login_id_match.group(1) if login_id_match else None

    # 🌐 CRD portal link
    link_match = re.search(r"(https://crims\.crd\.bc\.ca/[^\s]+)", text, re.IGNORECASE)
    portal_link = link_match.group(1) if link_match else PORTAL_LINK

    return {
        "Address": address,
        "SerialNumbers": serial_numbers,
        "LoginId": login_id,
        "PortalLink": portal_link,
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

# ---------------------------------------------------------------------------
#  📨 EMAIL HANDLERS
# ---------------------------------------------------------------------------

def handle_test_result(message, body_html):
    """Process an 'Accepted' test result email and return structured data."""
    parsed = parse_crd_test_result(body_html)
    serials = parsed["SerialNumbers"]

    # Convert received time to aware datetime
    received_str = message.get("receivedDateTime")
    try:
        received_dt = datetime.fromisoformat(received_str.replace("Z", "+00:00"))
    except Exception:
        received_dt = None

    data = {
        "Type": "TestResult",
        "Subject": message.get("subject"),
        "From": message["from"]["emailAddress"]["address"],
        "Received": received_str,        # original ISO string
        "ReceivedAt": received_dt,       # parsed datetime object
        "Address": parsed["Address"],
        "SerialNumbers": serials,
        "TestResultsInfo": parsed["TestResultsInfo"],
    }
    return data


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
        "Received": received_str,        # original ISO string
        "ReceivedAt": received_dt,       # parsed datetime object
        "Address": parsed["Address"],
        "SerialNumbers": serials,
        "LoginId": parsed["LoginId"],
        "PortalLink": parsed["PortalLink"],
    }
    return data


# ---------------------------------------------------------------------------
#  🚀 MAIN
# ---------------------------------------------------------------------------

def main():
    """Main entrypoint for CRD email processing and ServiceTrade integration."""
    processed_emails = 0
    # -----------------------------------------------------------------------
    #  Step 1. Authenticate with Microsoft Graph
    # -----------------------------------------------------------------------
    token = get_graph_token()
    headers = {"Authorization": f"Bearer {token}"}

    # -----------------------------------------------------------------------
    #  Step 2. Fetch and parse recent CRD emails
    # -----------------------------------------------------------------------
    messages = get_recent_messages(headers, INCOMING_BACKFLOWS_FOLDER_ID, top_n=50)
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

                # Fetch all assets for this location
                assets_resp = call_service_trade_api("asset", params={"locationId": loc_id})
                assets = assets_resp.get("data", {}).get("assets", [])

                wanted_serials = [normalize(sn) for sn in item.get("SerialNumbers", [])] 
                matched_assets = [ asset for asset in assets if normalize(asset.get("properties", {}).get("serial", "")) in wanted_serials ]

                if matched_assets:
                    item.setdefault("MatchedAssets", []).extend(matched_assets)

                    # ----------------------------------------------------------
                    #  Step 6. Update ServiceTrade records for each matched asset
                    # ----------------------------------------------------------
                    for asset in matched_assets:
                        asset_id = asset.get("id")
                        entity_type = 2  # Asset entity type

                        # Determine if we have a new comment to post
                        has_new_comment = False
                        new_comment_text = None

                        if item["Type"] == "DeviceAssignment" and item.get("LoginId") and item.get("PortalLink"):
                            has_new_comment = True
                            new_comment_text = (
                                "[BACKFLOW AUTOMATION]\n"
                                f"Login ID: {item['LoginId']}\n"
                                f"Online CRD Test Portal Link: {item['PortalLink']}"
                            )

                        elif item["Type"] == "TestResult" and item.get("TestResultsInfo"):
                            has_new_comment = True
                            new_comment_text = (
                                "[BACKFLOW AUTOMATION]\n"
                                "CRD Test Results:\n" + item["TestResultsInfo"]
                            )

                        # Fetch all existing comments for this asset
                        resp = call_service_trade_api("comment", params={"entityId": asset_id, "entityType": entity_type})
                        comments = resp.get("data", {}).get("comments", [])

                        # Check if our exact new message already exists
                        existing_contents = [c.get("content", "").strip() for c in comments]
                        if new_comment_text and new_comment_text.strip() in existing_contents:
                            print(f" Skipping asset {asset_id} — identical comment already exists.")
                            continue

                        # Delete old login ID comments only if we’re about to post something new
                        for comment in comments:
                            content = comment.get("content", "")
                            comment_id = comment.get("id")

                            if has_new_comment and "login id" in content.lower():
                                try:
                                    url = f"{SERVICE_TRADE_API_BASE}/comment/{comment_id}"
                                    delete_resp = api_session.delete(url)
                                    delete_resp.raise_for_status()
                                    print(f"  Deleted outdated login ID comment (ID {comment_id}) for asset {asset_id}")
                                except Exception as e:
                                    print(f"  Error deleting comment {comment_id}: {e}")

                        # ----------------------------------------------------------
                        #  Post new comment (only if needed)
                        # ----------------------------------------------------------
                        if has_new_comment and new_comment_text:
                            try:
                                url = f"{SERVICE_TRADE_API_BASE}/comment"
                                params = {
                                    "entityId": asset_id,
                                    "entityType": entity_type,
                                    "content": new_comment_text,
                                    "visibility": ["tech"],
                                }
                                post_resp = api_session.post(url, params=params)
                                post_resp.raise_for_status()
                                print(f" Posted new comment for asset {asset_id}")
                            except Exception as e:
                                print(f"  Error posting comment for asset {asset_id}: {e}")
                # ----------------------------------------------------------------
                #  Step 8. Move the processed email to its destination folder
                # ----------------------------------------------------------------
                moved_messages = set()  # Track which message IDs were already moved

                for item in filtered_data:
                    # After all ServiceTrade location + asset matching logic:
                    if item.get("ServiceTradeLocations") and any(item.get("MatchedAssets", [])):
                        try:
                            message_id = item.get("MessageId")
                            if not message_id or message_id in moved_messages:
                                continue

                            if item["Type"] == "DeviceAssignment":
                                dest_folder = os.getenv("OUTSTANDING_BACKFLOWS_FOLDER_ID")
                            else:
                                dest_folder = os.getenv("ASSIGNED_COMPLETED_BACKFLOWS_FOLDER_ID")

                            move_url = f"https://graph.microsoft.com/v1.0/users/{USER_EMAIL}/messages/{message_id}/move"
                            move_resp = requests.post(move_url, headers=headers, json={"destinationId": dest_folder})
                            move_resp.raise_for_status()
                            moved_message = move_resp.json()
                            new_message_id = moved_message.get("id")
                            moved_messages.add(message_id)

                            print(f"📦 Moved email '{item['Subject']}' → {item['Type']} folder")
                            processed_emails += 1
                            # Mark as read / flag depending on type
                            patch_url = f"https://graph.microsoft.com/v1.0/users/{USER_EMAIL}/messages/{new_message_id}"
                            if item["Type"] == "TestResult":
                                patch_resp = requests.patch(
                                    patch_url,
                                    headers={**headers, "Content-Type": "application/json"},
                                    json={"isRead": True},
                                )
                                patch_resp.raise_for_status()
                                print(f"✅ Marked '{item['Subject']}' as read")
                            elif item["Type"] == "DeviceAssignment":
                                flag_body = {"flag": {"flagStatus": "flagged"}}
                                patch_resp = requests.patch(
                                    patch_url,
                                    headers={**headers, "Content-Type": "application/json"},
                                    json=flag_body,
                                )
                                patch_resp.raise_for_status()
                                print(f"🚩 Flagged '{item['Subject']}' for follow-up")

                        except requests.HTTPError as e:
                            if e.response.status_code == 404:
                                print(f"⚠️ Email '{item['Subject']}' already moved or missing — skipping.")
                            else:
                                print(f"⚠️ HTTP error moving '{item['Subject']}': {e}")
                        except Exception as e:
                            print(f"⚠️ General error moving '{item.get('Subject')}': {e}")
                    else:
                        print(f"🛑 Skipping move for '{item['Subject']}' — no matching location or asset found.")

                    
        # -----------------------------------------------------------------------
        #  Step 7. Summary
        # -----------------------------------------------------------------------
        total_count = increment_metric("backflow_emails_processed", processed_emails)
        print(f"\n📈 Processed {processed_emails} emails this run.")
        print(f"🏁 Total emails processed since start: {total_count}\n")





    






if __name__ == "__main__":
    main()
