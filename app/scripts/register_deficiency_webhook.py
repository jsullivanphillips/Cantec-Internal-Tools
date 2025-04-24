import os
import requests
import json


from app import create_app

api_session = requests.Session()

app = create_app()
with app.app_context():
        # Create a test request context so Flask's session is available.
        with app.test_request_context():
            from flask import session
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")

            auth_url = "https://api.servicetrade.com/api/auth"
            payload = {"username": session.get('username'), "password": session.get('password')}
            try:
                auth_response = api_session.post(auth_url, json=payload)
                auth_response.raise_for_status()
            except Exception as e:
                pass

            endpoint="https://api.servicetrade.com/api/webhook"
            params={
                    "hookUrl": "https://spotty-corners-mate.loca.lt/webhooks/deficiency",
                    "entityEvents": [
                        {
                            "entityType": 10,
                            "events": ["created", "updated", "deleted"]
                        }
                    ]
                }
            # Register webhook
            try:
                response = api_session.get(endpoint)
                response.raise_for_status()
            except requests.RequestException as e:
                print(f"[ServiceTrade API Error] Endpoint: {endpoint} | Params: {params} | Error: {str(e)}")


            print(json.dumps(response.json().get("data", {}), indent=4))
