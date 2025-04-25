from flask import Blueprint, request, jsonify, session
from app.scripts.update_deficiency_by_id import update_deficiency_by_id
import os
from datetime import datetime, timezone

webhook_bp = Blueprint('webhook', __name__)

webhook_status = {
    "last_received": None,
    "last_entity_id": None
}

@webhook_bp.route('/webhooks/deficiency', methods=['POST'])
def handle_deficiency_webhook():
    data = request.json
    print("📡 Webhook received!", data)

    # 🛠️ Save the webhook event
    webhook_status["last_received"] = datetime.now(timezone.utc)

    # Safely extract entity ID
    try:
        entity_info = data.get("data", [])[0].get("entity", {})
        entity_type = entity_info.get("type")
        entity_id = entity_info.get("id")
    except (IndexError, AttributeError):
        entity_info = {}
        entity_type = None
        entity_id = None

    webhook_status["last_entity_id"] = entity_id

    if entity_type != "deficiency":
        print(f"⚠️ Ignoring webhook for non-deficiency entity type: {entity_type}")
        return jsonify({"message": "Ignored non-deficiency entity"}), 200

    # Setup session credentials
    session['username'] = os.environ.get("PROCESSING_USERNAME")
    session['password'] = os.environ.get("PROCESSING_PASSWORD")

    if entity_id:
        update_deficiency_by_id(str(entity_id))
    else:
        print("⚠️ No entity ID found in webhook.")

    return jsonify({"message": "Webhook received"}), 200


@webhook_bp.route('/webhooks/status', methods=['GET'])
def webhook_status_page():
    from flask import render_template

    return render_template('webhook_status.html', status=webhook_status)
