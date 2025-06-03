# service_trade_asset_modifier.py
import os
from flask import jsonify, session
import requests
from tqdm import tqdm
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from app import create_app
from collections import defaultdict

MAX_WORKERS = 12  # You can tune this based on performance

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"

# Load environment variables from .env using python-dotenv.
from dotenv import load_dotenv
load_dotenv()

api_session = requests.Session()

app = create_app()

def authenticate():
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        return jsonify({"error": "Authentication failed"}), 401


def main():
    with app.app_context():
        with app.test_request_context():
            from flask import session
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")
            authenticate()

            locations = get_all_locations()

            do_stuff_to_assets(locations)


def delete_asset(asset_id, asset_info):
    delete_asset_endpoint = f"{SERVICE_TRADE_API_BASE}/asset/{asset_id}"
    try:
        response = api_session.delete(delete_asset_endpoint)
        response.raise_for_status()
        return (asset_id, True, None)
    except requests.RequestException as e:
        return (asset_id, False, str(e))


def fetch_assets_for_location(location_id, asset_types_to_delete):
    asset_endpoint = f"{SERVICE_TRADE_API_BASE}/asset"
    asset_params = {"locationId": location_id}
    matching_assets = {}

    try:
        response = api_session.get(asset_endpoint, params=asset_params)
        response.raise_for_status()
        data = response.json().get("data")
        assets = data.get("assets", [])
        for asset in assets:
            asset_type = asset.get("type")
            asset_id = asset.get("id")
            asset_name = asset.get("name")
            if asset_type in asset_types_to_delete:
                matching_assets[asset_id] = {"asset_type": asset_type, "asset_name": asset_name}
    except requests.RequestException as e:
        tqdm.write(f"[ERROR] Fetching assets for location {location_id}: {e}")

    return matching_assets


def do_stuff_to_assets(locations):
    asset_types_to_delete = ['extinguisher', 'elight', 'alarm_device', 'fire_hose']
    asset_ids_to_delete = {}

    tqdm.write("Fetching assets for each location...")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(fetch_assets_for_location, loc_id, asset_types_to_delete): loc_id
            for loc_id in locations
        }

        pbar = tqdm(total=len(futures), desc="Filtering Assets in Locations...")
        for future in as_completed(futures):
            result = future.result()
            if result:
                asset_ids_to_delete.update(result)
            pbar.update(1)
        pbar.close()

    tqdm.write(f"{len(asset_ids_to_delete)} assets to delete.")

    # Multi-threaded deletion
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(delete_asset, aid, info): aid
            for aid, info in asset_ids_to_delete.items()
        }

        pbar = tqdm(total=len(asset_ids_to_delete), desc="Deleting Unwanted Assets...")

        for future in as_completed(futures):
            asset_id = futures[future]
            asset_info = asset_ids_to_delete[asset_id]
            try:
                aid, success, error_msg = future.result()
                if not success:
                    tqdm.write(f"[ERROR] Failed to delete asset {aid} | Asset type {asset_info['asset_type']} | Asset Name {asset_info['asset_name']}: {error_msg}")
                elif asset_info['asset_type'] not in asset_types_to_delete:
                    tqdm.write(f"[CRITICAL ERROR]: Deleted asset not in delete list! [id] {aid} : [type] {asset_info['asset_type']} | [name] {asset_info['asset_name']}")
            except Exception as e:
                tqdm.write(f"[EXCEPTION] Deletion error for {asset_id}: {e}")
            pbar.update(1)

        pbar.close()




def get_all_locations():
    locations = {}  # key = id, value = address
    locations_endpoint = f"{SERVICE_TRADE_API_BASE}/location"
    current_page = 1
    page_limit_override = 0

    # First call to get total pages
    location_params = {
        "limit": 100,
        "page": current_page
    }

    try:
        response = api_session.get(locations_endpoint, params=location_params)
        response.raise_for_status()
    except requests.RequestException as e:
        tqdm.write("[ERROR]: ", e)
        return {}

    data = response.json().get("data")
    total_pages = data.get("totalPages")
    tqdm.write(f"total pages in location data at endpoint: {total_pages}")

    # Initialize progress bar
    pbar = tqdm(total=total_pages, desc="Fetching Locations")

    while True:
        for location in data.get("locations", []):
            location_id = location.get("id")
            location_address = "Unknown"

            address = location.get("address")
            if not address or not address.get("street"):
                tqdm.write("[WARNING]: Location with no address")
            else:
                location_address = address.get("street")

            if location_id in locations:
                tqdm.write(f"[WARNING] Key:{location_id} already exists in locations")
            else:
                locations[location_id] = location_address

        pbar.update(1)

        if page_limit_override != 0 and current_page >= page_limit_override:
            tqdm.write(f"\nPage limit override set. Current page: {current_page} = override: {page_limit_override}. Breaking")
            break

        

        if current_page >= total_pages:
            tqdm.write(f"current_page:{current_page} reached total_pages:{total_pages}. Breaking")
            pbar.update(1)
            break

        current_page += 1
            
        # Request next page
        location_params["page"] = current_page
        try:
            response = api_session.get(locations_endpoint, params=location_params)
            response.raise_for_status()
            data = response.json().get("data")
        except requests.RequestException as e:
            tqdm.write("[ERROR]: ", e)
            break

    pbar.close()
    return locations

            
        



if __name__ == '__main__':
    main()