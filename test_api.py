import requests

session = requests.Session()

# Authenticate and persist the session
auth_url = "https://api.servicetrade.com/api/auth"
payload = {"username": "jsullivan-phillips", "password": "Cetnac123!"}
auth_response = session.post(auth_url, json=payload)

if auth_response.status_code == 200:
    print("Authenticated successfully!")
    print("Auth token received:", auth_response.json().get("authToken"))
else:
    print("Authentication failed:", auth_response.status_code, auth_response.json())


protected_url = "https://api.servicetrade.com/api/job/1866508457009921"  # Replace with a real endpoint
protected_response = session.get(protected_url)

if protected_response.status_code == 200:
    print("Protected resource data:", protected_response.json())
else:
    print("Failed to retrieve protected resource:", protected_response.status_code, protected_response.json())


