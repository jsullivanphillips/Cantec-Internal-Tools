import os
import requests
import argparse

# Create session object
api_session = requests.Session()

# ServiceTrade API base URL
SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"

# Your public webhook URL
PUBLIC_BASE_URL = "https://schedule-assist-1ff25977d0cf.herokuapp.com"
DEFICIENCY_WEBHOOK_ENDPOINT = f"{PUBLIC_BASE_URL}/webhooks/deficiency"
JOB_STATUS_WEBHOOK_ENDPOINT = f"{PUBLIC_BASE_URL}/webhooks/job_status_changed"
JOB_ITEM_WEBHOOK_ENDPOINT = f"{PUBLIC_BASE_URL}/webhooks/job_item_added"

def authenticate_service_trade():
    """Authenticate against ServiceTrade API."""
    username = os.environ.get("PROCESSING_USERNAME")
    password = os.environ.get("PROCESSING_PASSWORD")

    if not username or not password:
        raise Exception("❌ Missing PROCESSING_USERNAME or PROCESSING_PASSWORD environment variables!")

    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    payload = {"username": username, "password": password}

    print("🔐 Authenticating with ServiceTrade...")
    response = api_session.post(auth_url, json=payload)
    response.raise_for_status()
    print("✅ Authenticated successfully!")

def find_existing_deficiency_webhook():
    """Return existing webhook info if the URL is already registered."""
    print("🔎 Checking for existing webhooks...")
    response = api_session.get(f"{SERVICE_TRADE_API_BASE}/webhook")
    response.raise_for_status()

    webhooks = response.json().get("data", {}).get("webhooks", [])
    for webhook in webhooks:
        if webhook.get("hookUrl") == DEFICIENCY_WEBHOOK_ENDPOINT:
            return webhook
    return None

def find_existing_job_status_webhook():
    """Return existing webhook info if the URL is already registered."""
    print("🔎 Checking for existing webhooks...")
    response = api_session.get(f"{SERVICE_TRADE_API_BASE}/webhook")
    response.raise_for_status()

    webhooks = response.json().get("data", {}).get("webhooks", [])
    for webhook in webhooks:
        if webhook.get("hookUrl") == JOB_STATUS_WEBHOOK_ENDPOINT:
            return webhook
    return None


def find_existing_job_item_webhook():
    """Return existing webhook info if the URL is already registered."""
    print("🔎 Checking for existing job item webhooks...")
    response = api_session.get(f"{SERVICE_TRADE_API_BASE}/webhook")
    response.raise_for_status()

    webhooks = response.json().get("data", {}).get("webhooks", [])
    for webhook in webhooks:
        if webhook.get("hookUrl") == JOB_ITEM_WEBHOOK_ENDPOINT:
            return webhook
    return None


def create_deficiency_webhook():
    """Create a webhook for Deficiencies (entityType 10)."""
    webhook_payload = {
        "hookUrl": DEFICIENCY_WEBHOOK_ENDPOINT,
        "entityEvents": [
            {
                "entityType": 10,
                "actions": ["created", "updated", "deleted"]
            }
        ],
        "includeChangesets": False
    }

    print(f"📡 Creating new webhook to {DEFICIENCY_WEBHOOK_ENDPOINT}...")
    response = api_session.post(f"{SERVICE_TRADE_API_BASE}/webhook", json=webhook_payload)
    response.raise_for_status()

    webhook_data = response.json()["data"]
    print(f"✅ Webhook created successfully! Webhook ID: {webhook_data['id']}")
    print(f"Webhook URI: {webhook_data['uri']}")
    print(f"Enabled: {webhook_data['enabled']}")
    print(f"Confirmed: {webhook_data['confirmed']}")
    print()


def create_job_complete_webhook():
    webhook_payload = {
        "hookUrl": JOB_STATUS_WEBHOOK_ENDPOINT,
        "entityEvents": [
            {
                "entityType": 3,
                "actions": ["updated"]
            }
        ],
        "includeChangesets": True,
    }

    print(f"Creating new webhook to {JOB_STATUS_WEBHOOK_ENDPOINT}...")

    try:
        response = api_session.post(f"{SERVICE_TRADE_API_BASE}/webhook", json=webhook_payload)
        response.raise_for_status()
    except Exception as e:
        print(f"Failed to create webhook: {e}")

    webhook_data = response.json().get("data",{})
    print(f"webhook data:\n {webhook_data}")
    # print(f"✅ Webhook created successfully! Webhook ID: {webhook_data['id']}")
    # print(f"Webhook URI: {webhook_data['uri']}")
    # print(f"Enabled: {webhook_data['enabled']}")
    # print(f"Confirmed: {webhook_data['confirmed']}")
    # print()


def create_job_item_added_webhook():
    webhook_payload = {
        "hookUrl": JOB_ITEM_WEBHOOK_ENDPOINT,
        "entityEvents": [
            {
                "entityType": 23,
                "actions": ["created", "updated", "deleted"] 
            }
        ],
        "includeChangesets": True,
    }

    print(f"Creating new webhook to {JOB_ITEM_WEBHOOK_ENDPOINT}...")

    try:
        response = api_session.post(f"{SERVICE_TRADE_API_BASE}/webhook", json=webhook_payload)
        response.raise_for_status()
    except Exception as e:
        print(f"Failed to create webhook: {e}")

    webhook_data = response.json().get("data",{})
    print(f"webhook data:\n {webhook_data}")

    print(f"✅ Webhook created successfully! Webhook ID: {webhook_data['id']}")
    print(f"Webhook URI: {webhook_data['uri']}")
    print(f"Enabled: {webhook_data['enabled']}")
    print(f"Confirmed: {webhook_data['confirmed']}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Create ServiceTrade webhooks.")
    parser.add_argument("--deficiency", action="store_true", help="Create the deficiency webhook")
    parser.add_argument("--job_status", action="store_true", help="Create the job status webhook")
    parser.add_argument("--job_item", action="store_true", help="Create the job item webhook")
    parser.add_argument("--delete_job_item", action="store_true", help="Delete the job item webhook")
    args = parser.parse_args()

    if not args.deficiency and not args.job_status and not args.job_item and not args.delete_job_item:
        print("⚠️  Please specify at least one of --deficiency or --job_status or --job_item")
        return

    try:
        authenticate_service_trade()

        if args.deficiency:
            existing = find_existing_deficiency_webhook()
            if existing:
                print("⚠️ Deficiency webhook already exists!")
                print(f"Webhook ID: {existing['id']}")
                print(f"Webhook URI: {existing['uri']}")
                print(f"Enabled: {existing['enabled']}")
                print(f"Confirmed: {existing['confirmed']}")
                print("✅ Skipping creation.")
            else:
                create_deficiency_webhook()

        if args.job_status:
            existing = find_existing_job_status_webhook()
            if existing:
                print("⚠️ Job status webhook already exists!")
                print(f"Webhook ID: {existing['id']}")
                print(f"Webhook URI: {existing['uri']}")
                print(f"Enabled: {existing['enabled']}")
                print(f"Confirmed: {existing['confirmed']}")
                print("✅ Skipping creation.")
            else:
                create_job_complete_webhook()
        
        if args.job_item:
            existing = find_existing_job_item_webhook()
            if existing:
                print("⚠️ Job item webhook already exists!")
                print(f"Webhook ID: {existing['id']}")
                print(f"Webhook URI: {existing['uri']}")
                print(f"Enabled: {existing['enabled']}")
                print(f"Confirmed: {existing['confirmed']}")
                print("✅ Skipping creation.")
            else:
                create_job_item_added_webhook()
        
        if args.delete_job_item:
            existing = find_existing_job_item_webhook()
            if existing:
                webhook_id = existing['id']
                print(f"🗑️ Deleting job item webhook with ID: {webhook_id}...")
                delete_response = api_session.delete(f"{SERVICE_TRADE_API_BASE}/webhook/{webhook_id}")
                if delete_response.status_code == 204:
                    print("✅ Webhook deleted successfully.")
                else:
                    print(f"❌ Failed to delete webhook. Status code: {delete_response.status_code}")
            else:
                print("⚠️ No existing job item webhook found to delete.")

    except requests.RequestException as e:
        print(f"❌ HTTP error during webhook setup: {e}")
    except Exception as e:
        print(f"❌ General error: {e}")

if __name__ == "__main__":
    main()
