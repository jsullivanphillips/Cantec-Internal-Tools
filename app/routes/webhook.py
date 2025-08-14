from flask import Blueprint, request, jsonify, session
from app.scripts.update_deficiency_by_id import update_deficiency_by_id, update_deficiency_by_job_id
from app.routes.performance_summary import update_job_item_by_id
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
    print("Deficiency Webhook received.")

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


@webhook_bp.route('/webhooks/job_status_changed', methods=['POST'])
def handle_job_status_changed_webhook():
    data = request.json
    print("Job Status Changed Webhook Received")

    webhook_status["last_received"] = datetime.now(timezone.utc)

    # Safely extract entity ID
    try:
        entity_info = data.get("data", [])[0].get("entity", {})
        entity_type = entity_info.get("type")
        entity_id = entity_info.get("id")
        changeset = data.get("data", [])[0].get("changeset", {})
        field = changeset.get("field")
    except (IndexError, AttributeError):
        entity_info = {}
        entity_type = None
        entity_id = None
        changeset = {}
        field = None
    
    # only update our deficiency_record table if the status of a job has changed.
    if field != "status":
        return jsonify({"message": "Webhook received"}), 200

    webhook_status["last_entity_id"] = entity_id

    if entity_type != "job":
        print(f"Ignoring webhook for non-job entity type: {entity_type}")
        return jsonify({"message": "Ignored non-deficiency entity"}), 200

    # Setup session credentials
    session['username'] = os.environ.get("PROCESSING_USERNAME")
    session['password'] = os.environ.get("PROCESSING_PASSWORD")

    if entity_id:
        update_deficiency_by_job_id(str(entity_id))
    else:
        print("⚠️ No entity ID found in webhook.")

    return jsonify({"message": "Webhook received"}), 200


@webhook_bp.route('/webhooks/job_item_added', methods=['POST'])
def handle_job_item_added_webhook():
    # This only gets called on Create. Would be smart to also handle Update, and Delete.
    data = request.json
    print("JOB ITEM Webhook received!", data)

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

    print(f"Entity Type: {entity_type}, Entity ID: {entity_id}")

    action = data.get("data", [])[0].get("action")
    job_item_id = entity_id
    user_id = data.get("data", [])[0].get("userId")

    # Setup session credentials
    session['username'] = os.environ.get("PROCESSING_USERNAME")
    session['password'] = os.environ.get("PROCESSING_PASSWORD")

    update_job_item_by_id(action, job_item_id, user_id)
    
    return jsonify({"message": "Webhook received"}), 200



@webhook_bp.route('/webhooks/status', methods=['GET'])
def webhook_status_page():
    from flask import render_template

    return render_template('webhook_status.html', status=webhook_status)
