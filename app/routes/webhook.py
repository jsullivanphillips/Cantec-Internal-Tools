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
    webhook_status["last_entity_id"] = data.get("entityId")

    session['username'] = os.environ.get("PROCESSING_USERNAME")
    session['password'] = os.environ.get("PROCESSING_PASSWORD")

    entity_id = data.get("entityId")
    if entity_id:
        update_deficiency_by_id(str(entity_id))

    return jsonify({"message": "Webhook received"}), 200


@webhook_bp.route('/webhooks/status', methods=['GET'])
def webhook_status_page():
    from flask import render_template

    return render_template('webhook_status.html', status=webhook_status)
