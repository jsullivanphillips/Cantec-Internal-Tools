import os
import requests

# Create session object
api_session = requests.Session()

# ServiceTrade API base URL
SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"

# Your public webhook URL
PUBLIC_BASE_URL = "https://schedule-assist-1ff25977d0cf.herokuapp.com"
WEBHOOK_ENDPOINT = f"{PUBLIC_BASE_URL}/webhooks/deficiency"

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

def find_existing_webhook():
    """Return existing webhook info if the URL is already registered."""
    print("🔎 Checking for existing webhooks...")
    response = api_session.get(f"{SERVICE_TRADE_API_BASE}/webhook")
    response.raise_for_status()

    webhooks = response.json().get("data", {}).get("webhooks", [])
    for webhook in webhooks:
        if webhook.get("hookUrl") == WEBHOOK_ENDPOINT:
            return webhook
    return None

def create_deficiency_webhook():
    """Create a webhook for Deficiencies (entityType 10)."""
    webhook_payload = {
        "hookUrl": WEBHOOK_ENDPOINT,
        "entityEvents": [
            {
                "entityType": 10,
                "actions": ["created", "updated", "deleted"]
            }
        ],
        "includeChangesets": False
    }

    print(f"📡 Creating new webhook to {WEBHOOK_ENDPOINT}...")
    response = api_session.post(f"{SERVICE_TRADE_API_BASE}/webhook", json=webhook_payload)
    response.raise_for_status()

    webhook_data = response.json()["data"]
    print(f"✅ Webhook created successfully! Webhook ID: {webhook_data['id']}")
    print(f"Webhook URI: {webhook_data['uri']}")
    print(f"Enabled: {webhook_data['enabled']}")
    print(f"Confirmed: {webhook_data['confirmed']}")
    print()

def main():
    try: 
        authenticate_service_trade()

        existing_webhook = find_existing_webhook()
        if existing_webhook:
            print("⚠️ Webhook already exists!")
            print(f"Webhook ID: {existing_webhook['id']}")
            print(f"Webhook URI: {existing_webhook['uri']}")
            print(f"Enabled: {existing_webhook['enabled']}")
            print(f"Confirmed: {existing_webhook['confirmed']}")
            print("✅ Skipping creation.")
        else:
            create_deficiency_webhook()

    except requests.RequestException as e:
        print(f"❌ HTTP error during webhook setup: {e}")
    except Exception as e:
        print(f"❌ General error: {e}")

if __name__ == "__main__":
    main()
