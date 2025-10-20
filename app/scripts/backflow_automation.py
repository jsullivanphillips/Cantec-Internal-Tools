import os
import msal
import requests
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Azure app credentials
CLIENT_ID = os.getenv("CLIENT_ID")
TENANT_ID = os.getenv("TENANT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
SECRET_ID = os.getenv("SECRET_ID")

# Mail folder IDs
CRD_BACKFLOWS_FOLDER_ID = os.getenv("CRD_BACKFLOWS_FOLDER_ID")
INCOMING_BACKFLOWS_FOLDER_ID = os.getenv("INCOMING_BACKFLOWS_FOLDER_ID")
ASSIGNED_COMPLETED_BACKFLOWS_FOLDER_ID = os.getenv("ASSIGNED_COMPLETED_BACKFLOWS_FOLDER_ID")
OUTSTANDING_BACKFLOWS_FOLDER_ID = os.getenv("OUTSTANDING_BACKFLOWS_FOLDER_ID")

# Graph API setup
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPE = ["https://graph.microsoft.com/.default"]

# Initialize MSAL confidential client
app = msal.ConfidentialClientApplication(
    CLIENT_ID,
    authority=AUTHORITY,
    client_credential=CLIENT_SECRET
)

# Acquire access token
result = app.acquire_token_for_client(scopes=SCOPE)

if "access_token" in result:
    print("✅ Authenticated successfully!")

    user_email = "service@cantec.ca"
    headers = {"Authorization": f"Bearer {result['access_token']}"}

    url = f"https://graph.microsoft.com/v1.0/users/{user_email}/mailFolders/{INCOMING_BACKFLOWS_FOLDER_ID}/messages?$top=10"
    resp = requests.get(url, headers=headers)
    resp.raise_for_status()

    for msg in resp.json().get("value", []):
        print(f"From: {msg['from']['emailAddress']['address']}")
        print(f"Subject: {msg['subject']}")
        print(f"Received: {msg['receivedDateTime']}")
        print("-" * 40)

else:
    print("❌ Authentication failed:", result.get("error_description"))
