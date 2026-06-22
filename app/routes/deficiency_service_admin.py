"""Admin API for non-quoteable deficiency phrase management."""

import threading
from zoneinfo import ZoneInfo

from flask import Blueprint, current_app, jsonify, request, session

from app.db_models import DeficiencyNonQuoteablePhrase, db, vancouver_now
from app.deficiency.service_eligibility import (
    classify_all_deficiencies,
    count_phrase_matches_in_window,
    normalize_phrase,
)
from app.routes.performance_summary import get_date_window

PACIFIC_TZ = ZoneInfo("America/Vancouver")

deficiency_service_admin_bp = Blueprint("deficiency_service_admin", __name__)


def _require_session():
    if not session.get("username") or not session.get("password"):
        return jsonify({"error": "unauthorized"}), 401
    return None


def _schedule_reclassify() -> None:
    """Run full deficiency reclassification off the request thread (can take minutes)."""
    app = current_app._get_current_object()

    def runner() -> None:
        try:
            with app.app_context():
                try:
                    classify_all_deficiencies()
                finally:
                    db.session.remove()
        except Exception:
            app.logger.exception("Deferred deficiency reclassification failed")

    threading.Thread(
        target=runner,
        daemon=True,
        name="deficiency-reclassify",
    ).start()


def _phrase_to_dict(row: DeficiencyNonQuoteablePhrase) -> dict:
    return {
        "id": row.id,
        "phrase": row.phrase,
        "label": row.label,
        "active": row.active,
        "notes": row.notes,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@deficiency_service_admin_bp.route(
    "/api/monday_meeting/service/non_quoteable_phrases", methods=["GET"]
)
def list_non_quoteable_phrases():
    auth = _require_session()
    if auth is not None:
        return auth
    window_start, window_end = get_date_window()
    match_counts = count_phrase_matches_in_window(window_start, window_end)
    rows = (
        DeficiencyNonQuoteablePhrase.query.order_by(
            DeficiencyNonQuoteablePhrase.phrase.asc()
        ).all()
    )
    phrases_out = []
    for row in rows:
        payload = _phrase_to_dict(row)
        payload["matches_in_range"] = match_counts.get(row.phrase, 0)
        phrases_out.append(payload)
    return jsonify(
        {
            "phrases": phrases_out,
            "window": {
                "start_date": window_start.astimezone(PACIFIC_TZ).date().isoformat(),
                "end_date": window_end.astimezone(PACIFIC_TZ).date().isoformat(),
            },
        }
    )


@deficiency_service_admin_bp.route(
    "/api/monday_meeting/service/non_quoteable_phrases", methods=["POST"]
)
def create_non_quoteable_phrase():
    auth = _require_session()
    if auth is not None:
        return auth
    payload = request.get_json(silent=True) or {}
    raw_phrase = (payload.get("phrase") or "").strip()
    phrase = normalize_phrase(raw_phrase)
    if not phrase:
        return jsonify({"error": "phrase is required"}), 400

    existing = DeficiencyNonQuoteablePhrase.query.filter_by(phrase=phrase).first()
    if existing is not None:
        return jsonify({"error": "phrase already exists", "phrase": _phrase_to_dict(existing)}), 409

    row = DeficiencyNonQuoteablePhrase(
        phrase=phrase,
        label=(payload.get("label") or raw_phrase).strip() or None,
        notes=(payload.get("notes") or "").strip() or None,
        active=bool(payload.get("active", True)),
    )
    db.session.add(row)
    db.session.commit()
    _schedule_reclassify()
    return jsonify({"phrase": _phrase_to_dict(row), "reclassify_scheduled": True}), 201


@deficiency_service_admin_bp.route(
    "/api/monday_meeting/service/non_quoteable_phrases/<int:phrase_id>", methods=["PATCH"]
)
def update_non_quoteable_phrase(phrase_id: int):
    auth = _require_session()
    if auth is not None:
        return auth
    row = DeficiencyNonQuoteablePhrase.query.get(phrase_id)
    if row is None:
        return jsonify({"error": "not found"}), 404

    payload = request.get_json(silent=True) or {}
    if "phrase" in payload:
        phrase = normalize_phrase((payload.get("phrase") or "").strip())
        if not phrase:
            return jsonify({"error": "phrase cannot be empty"}), 400
        conflict = (
            DeficiencyNonQuoteablePhrase.query.filter(
                DeficiencyNonQuoteablePhrase.phrase == phrase,
                DeficiencyNonQuoteablePhrase.id != phrase_id,
            ).first()
        )
        if conflict is not None:
            return jsonify({"error": "phrase already exists"}), 409
        row.phrase = phrase
    if "label" in payload:
        label = (payload.get("label") or "").strip()
        row.label = label or None
    if "notes" in payload:
        notes = (payload.get("notes") or "").strip()
        row.notes = notes or None
    if "active" in payload:
        row.active = bool(payload.get("active"))
    row.updated_at = vancouver_now()
    db.session.commit()
    _schedule_reclassify()
    return jsonify({"phrase": _phrase_to_dict(row), "reclassify_scheduled": True})


@deficiency_service_admin_bp.route(
    "/api/monday_meeting/service/non_quoteable_phrases/<int:phrase_id>", methods=["DELETE"]
)
def delete_non_quoteable_phrase(phrase_id: int):
    auth = _require_session()
    if auth is not None:
        return auth
    row = DeficiencyNonQuoteablePhrase.query.get(phrase_id)
    if row is None:
        return jsonify({"error": "not found"}), 404
    db.session.delete(row)
    db.session.commit()
    _schedule_reclassify()
    return jsonify({"deleted": phrase_id, "reclassify_scheduled": True})


@deficiency_service_admin_bp.route("/api/monday_meeting/service/reclassify", methods=["POST"])
def reclassify_deficiencies():
    auth = _require_session()
    if auth is not None:
        return auth
    summary = classify_all_deficiencies()
    return jsonify(summary)
