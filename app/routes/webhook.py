import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request, session

from app.db_models import DeficiencyRecord
from app.routes.performance_summary import update_job_item_by_id
from app.scripts.update_deficiency_by_id import update_deficiency_by_id, update_deficiency_by_job_id

webhook_bp = Blueprint('webhook', __name__)

webhook_status = {
    "last_received": None,
    "last_entity_id": None,
}

# Cap concurrent ServiceTrade sync work so webhook bursts do not spawn unbounded threads.
_WEBHOOK_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="webhook")
_inflight_lock = threading.Lock()
_inflight_keys: set[str] = set()


def _defer_webhook_task(label: str, fn) -> None:
    """Run slow ServiceTrade sync off the Waitress request thread."""
    app = current_app._get_current_object()

    with _inflight_lock:
        if label in _inflight_keys:
            return
        _inflight_keys.add(label)

    def runner() -> None:
        from app import db

        try:
            with app.app_context():
                fn()
        except Exception:
            app.logger.exception("Deferred webhook task failed: %s", label)
        finally:
            with _inflight_lock:
                _inflight_keys.discard(label)
            db.session.remove()

    _WEBHOOK_EXECUTOR.submit(runner)


def _processing_session_credentials() -> tuple[str | None, str | None]:
    return os.environ.get("PROCESSING_USERNAME"), os.environ.get("PROCESSING_PASSWORD")


def _run_with_processing_session(fn) -> None:
    username, password = _processing_session_credentials()
    with current_app.test_request_context():
        session["username"] = username
        session["password"] = password
        fn()


def _job_has_tracked_deficiencies(job_id: str) -> bool:
    """Fast local check — most ServiceTrade job updates are unrelated to our tracker."""
    return (
        DeficiencyRecord.query.filter_by(job_id=job_id)
        .with_entities(DeficiencyRecord.id)
        .limit(1)
        .first()
        is not None
    )


@webhook_bp.route('/webhooks/deficiency', methods=['POST'])
def handle_deficiency_webhook():
    data = request.json
    print("Deficiency Webhook received.")

    webhook_status["last_received"] = datetime.now(timezone.utc)

    try:
        entity_info = data.get("data", [])[0].get("entity", {})
        entity_type = entity_info.get("type")
        entity_id = entity_info.get("id")
    except (IndexError, AttributeError):
        entity_type = None
        entity_id = None

    webhook_status["last_entity_id"] = entity_id

    if entity_type != "deficiency":
        print(f"⚠️ Ignoring webhook for non-deficiency entity type: {entity_type}")
        return jsonify({"message": "Ignored non-deficiency entity"}), 200

    if entity_id:
        deficiency_id = str(entity_id)
        _defer_webhook_task(
            f"deficiency-{deficiency_id}",
            lambda: _run_with_processing_session(
                lambda: update_deficiency_by_id(deficiency_id),
            ),
        )
    else:
        print("⚠️ No entity ID found in webhook.")

    return jsonify({"message": "Webhook received"}), 200


@webhook_bp.route('/webhooks/job_status_changed', methods=['POST'])
def handle_job_status_changed_webhook():
    """ServiceTrade notifies us when any job's status changes (entityType 3, updated).

    Previously this handler called ServiceTrade back synchronously (auth + multiple API
    calls per deficiency) inside the HTTP request, which blocked Waitress threads for
    30s+ and caused H12 timeouts when many jobs updated at once.
    """
    data = request.json

    webhook_status["last_received"] = datetime.now(timezone.utc)

    try:
        entity_info = data.get("data", [])[0].get("entity", {})
        entity_type = entity_info.get("type")
        entity_id = entity_info.get("id")
        changeset = data.get("data", [])[0].get("changeset", {})
        field = changeset.get("field")
    except (IndexError, AttributeError):
        entity_type = None
        entity_id = None
        field = None

    if field != "status":
        return jsonify({"message": "Ignored non-status change"}), 200

    webhook_status["last_entity_id"] = entity_id

    if entity_type != "job":
        return jsonify({"message": "Ignored non-job entity"}), 200

    if not entity_id:
        print("⚠️ No entity ID found in webhook.")
        return jsonify({"message": "Webhook received"}), 200

    job_id = str(entity_id)
    if not _job_has_tracked_deficiencies(job_id):
        return jsonify({"message": "Ignored job with no tracked deficiencies"}), 200

    print(f"Queueing deficiency sync for job status change (job_id={job_id})")
    _defer_webhook_task(
        f"job-status-{job_id}",
        lambda: _run_with_processing_session(
            lambda: update_deficiency_by_job_id(job_id),
        ),
    )

    return jsonify({"message": "Webhook accepted", "queued": True}), 200


@webhook_bp.route('/webhooks/job_item_added', methods=['POST'])
def handle_job_item_added_webhook():
    data = request.json
    print("JOB ITEM Webhook received!", data)

    webhook_status["last_received"] = datetime.now(timezone.utc)

    try:
        entity_info = data.get("data", [])[0].get("entity", {})
        entity_type = entity_info.get("type")
        entity_id = entity_info.get("id")
    except (IndexError, AttributeError):
        entity_type = None
        entity_id = None

    print(f"Entity Type: {entity_type}, Entity ID: {entity_id}")

    action = data.get("data", [])[0].get("action")
    job_item_id = entity_id
    user_id = data.get("data", [])[0].get("userId")

    if job_item_id is not None:
        _defer_webhook_task(
            f"job-item-{job_item_id}",
            lambda: _run_with_processing_session(
                lambda: update_job_item_by_id(action, job_item_id, user_id),
            ),
        )

    return jsonify({"message": "Webhook received"}), 200
