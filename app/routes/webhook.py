from flask import Blueprint, request, jsonify
from app.scripts.update_deficiency_by_id import update_deficiency_by_id

webhook_bp = Blueprint('webhook', __name__)

@webhook_bp.route('/webhooks/deficiency', methods=['POST'])
def handle_deficiency_webhook():
    data = request.json
    print("📡 Webhook received!", data)

    entity_id = data.get("entityId")
    if entity_id:
        update_deficiency_by_id(str(entity_id))

    return jsonify({"message": "Webhook received"}), 200