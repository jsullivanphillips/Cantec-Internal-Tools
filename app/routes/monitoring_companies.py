"""REST API for the monitoring company directory."""

from __future__ import annotations

from flask import Blueprint, jsonify, request, session

from app.db_models import MonitoringCompany, MonthlyLocation, MonthlyLocationMonth, db
from app.monthly.monitoring_companies import (
    create_monitoring_company,
    normalize_monitoring_company_name,
    serialize_monitoring_company,
)

monitoring_companies_bp = Blueprint("monitoring_companies", __name__)


def _parse_bool_query(name: str, default: bool | None = None) -> bool | None:
    raw = (request.args.get(name) or "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes"}:
        return True
    if raw in {"0", "false", "no"}:
        return False
    return default


@monitoring_companies_bp.get("/api/monitoring_companies")
def list_monitoring_companies():
    q = (request.args.get("q") or "").strip()
    active_only = _parse_bool_query("active", True)
    limit = min(max(int(request.args.get("limit") or 500), 1), 1000)

    query = MonitoringCompany.query
    if active_only is True:
        query = query.filter(MonitoringCompany.active.is_(True))
    elif active_only is False:
        query = query.filter(MonitoringCompany.active.is_(False))
    if q:
        folded = q.casefold()
        query = query.filter(MonitoringCompany.name_normalized.contains(folded))
    rows = query.order_by(MonitoringCompany.name.asc()).limit(limit).all()
    return jsonify({"companies": [serialize_monitoring_company(row) for row in rows]})


@monitoring_companies_bp.get("/api/monitoring_companies/<int:company_id>")
def get_monitoring_company(company_id: int):
    mc = db.session.get(MonitoringCompany, company_id)
    if mc is None:
        return jsonify({"error": "Monitoring company not found"}), 404
    return jsonify({"company": serialize_monitoring_company(mc)})


@monitoring_companies_bp.post("/api/monitoring_companies")
def create_monitoring_company_route():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    try:
        mc, reused = create_monitoring_company(
            name=name,
            primary_phone=(payload.get("primary_phone") or "").strip() or None,
            secondary_phone=(payload.get("secondary_phone") or "").strip() or None,
            active=True,
        )
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 400
    body = {
        "company": serialize_monitoring_company(mc),
        "reused_existing": reused,
    }
    return jsonify(body), 200 if reused else 201


@monitoring_companies_bp.patch("/api/monitoring_companies/<int:company_id>")
def patch_monitoring_company(company_id: int):
    mc = db.session.get(MonitoringCompany, company_id)
    if mc is None:
        return jsonify({"error": "Monitoring company not found"}), 404
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name cannot be empty"}), 400
        folded = normalize_monitoring_company_name(name)
        conflict = (
            MonitoringCompany.query.filter(
                MonitoringCompany.id != company_id,
                MonitoringCompany.name_normalized == folded,
                MonitoringCompany.active.is_(True),
            ).first()
        )
        if conflict is not None:
            return jsonify({"error": "An active monitoring company with this name already exists"}), 409
        mc.name = name
        mc.name_normalized = folded
    if "primary_phone" in payload:
        raw = payload.get("primary_phone")
        mc.primary_phone = (str(raw).strip() or None) if raw is not None else None
    if "secondary_phone" in payload:
        raw = payload.get("secondary_phone")
        mc.secondary_phone = (str(raw).strip() or None) if raw is not None else None
    if "active" in payload:
        mc.active = bool(payload.get("active"))

    db.session.commit()
    return jsonify({"company": serialize_monitoring_company(mc)})


@monitoring_companies_bp.post("/api/monitoring_companies/<int:company_id>/merge")
def merge_monitoring_company(company_id: int):
    """Re-point testing sites from duplicate company to canonical row; deactivate duplicate."""
    canonical = db.session.get(MonitoringCompany, company_id)
    if canonical is None:
        return jsonify({"error": "Monitoring company not found"}), 404
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400
    try:
        source_id = int(payload.get("source_company_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "source_company_id is required"}), 400
    if source_id == company_id:
        return jsonify({"error": "source_company_id must differ from target"}), 400
    source = db.session.get(MonitoringCompany, source_id)
    if source is None:
        return jsonify({"error": "Source monitoring company not found"}), 404

    moved = (
        MonthlyLocation.query.filter_by(monitoring_company_id=source_id)
        .update({MonthlyLocation.monitoring_company_id: company_id}, synchronize_session=False)
    )
    moved_months = (
        MonthlyLocationMonth.query.filter_by(monitoring_company_id=source_id)
        .update({MonthlyLocationMonth.monitoring_company_id: company_id}, synchronize_session=False)
    )
    source.active = False
    db.session.commit()
    return jsonify(
        {
            "ok": True,
            "canonical_company_id": company_id,
            "moved_testing_sites": int(moved or 0),
            "moved_stop_months": int(moved_months or 0),
        }
    )
