# meadow_backend/routes/keys.py
from flask import Blueprint, render_template, request, jsonify, abort, redirect, url_for
from sqlalchemy import or_, func
from sqlalchemy.orm import selectinload, aliased
from .scheduling_attack import get_active_techs

from app.db_models import db, Key, KeyAddress, KeyStatus

keys_bp = Blueprint("keys", __name__, template_folder="templates")


# -----------------------------
# Helpers
# -----------------------------
def _get_key_or_404(key_id: int) -> Key:
    key = (
        db.session.query(Key)
        .options(
            selectinload(Key.addresses),
            selectinload(Key.statuses),
        )
        .filter(Key.id == key_id)
        .first()
    )
    if key is None:
        abort(404, description="Key not found")
    return key


def _commit_or_500():
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        abort(500, description="Database error")


def _payload():
    # Supports both form posts and JSON posts
    return request.get_json(silent=True) or request.form or {}


# -----------------------------
# Page routes (unchanged except eager-load if desired)
# -----------------------------
@keys_bp.get("/keys")
def keys_home():
    return render_template("keys_home.html")


@keys_bp.get("/keys/active_techs")
def get_active_techs_route():
    techs = get_active_techs()  # currently returns big dicts

    slim = []
    for t in techs or []:
        # Keep only what we need
        tech_id = t.get("id")
        name = (t.get("name") or "").strip()
        if tech_id and name:
            slim.append({"id": tech_id, "name": name})

    # Optional: sort alphabetically
    slim.sort(key=lambda x: x["name"].lower())

    return jsonify({"data": slim})


@keys_bp.get("/keys/<int:key_id>")
def key_detail(key_id: int):
    key = _get_key_or_404(key_id)
    return render_template("key_detail.html", key=key)


@keys_bp.get("/keys/by-barcode/<int:barcode>")
def key_detail_by_barcode(barcode: int):
    key = (
        db.session.query(Key)
        .options(selectinload(Key.addresses))
        .filter(Key.barcode == barcode)
        .first()
    )
    if key is None:
        abort(404, description="Key not found")
    return render_template("key_detail.html", key=key)


@keys_bp.get("/api/keys/search")
def api_keys_search():
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify({"data": []})

    like = f"%{q}%"

    query = (
        db.session.query(Key)
        .outerjoin(KeyAddress, KeyAddress.key_id == Key.id)
        .filter(or_(Key.keycode.ilike(like), KeyAddress.address.ilike(like)))
        .distinct()
        .limit(20)
    )

    results = []
    for key in query.all():
        results.append({
            "id": key.id,
            "keycode": key.keycode,
            "barcode": key.barcode,
            "area": key.area,
            "route": key.route,
            "home_location": getattr(key, "home_location", None),
            "annual_month": getattr(key, "annual_month", None),
            "site_status": getattr(key, "site_status", None),
            "key_status": getattr(key, "key_status", None),
            "key_location": getattr(key, "key_location", None),
            "addresses": [a.address for a in getattr(key, "addresses", [])][:3],
        })

    return jsonify({"data": results})


@keys_bp.post("/keys/<int:key_id>/sign-out")
def sign_out_key(key_id: int):
    key = _get_key_or_404(key_id)
    data = _payload()

    signed_out_to = (data.get("signed_out_to") or "").strip()
    if not signed_out_to:
        abort(400, description="signed_out_to is required.")

    air_tag = (data.get("air_tag") or "").strip() or None

    db.session.add(KeyStatus(
        key_id=key.id,
        status="Signed Out",
        key_location=signed_out_to,
        air_tag=air_tag,
    ))
    _commit_or_500()

    db.session.refresh(key)

    if request.accept_mimetypes.accept_html and not request.is_json:
        return redirect(url_for("keys.key_detail", key_id=key.id))

    cs = key.current_status
    return jsonify({
        "ok": True,
        "data": {
            "id": key.id,
            "status": cs.status if cs else None,
            "key_location": cs.key_location if cs else None,
            "air_tag": getattr(cs, "air_tag", None) if cs else None,
            "inserted_at": cs.inserted_at.isoformat() if cs and cs.inserted_at else None,
        }
    })





@keys_bp.post("/keys/<int:key_id>/return")
def return_key(key_id: int):
    key = _get_key_or_404(key_id)

    cs = key.current_status
    current_status = (cs.status or "").lower() if cs else ""

    # If already returned / in, do nothing (idempotent)
    if current_status in ["returned", "in", "available"]:
        if request.accept_mimetypes.accept_html and not request.is_json:
            return redirect(url_for("keys.key_detail", key_id=key.id))

        return jsonify({
            "ok": True,
            "noop": True,
            "data": {
                "id": key.id,
                "status": cs.status if cs else None,
                "key_location": cs.key_location if cs else None,
                "inserted_at": cs.inserted_at.isoformat() if cs and cs.inserted_at else None,
            }
        })

    # Otherwise, perform the return
    returned_to = (key.home_location or "").strip() or "Office"

    db.session.add(KeyStatus(
        key_id=key.id,
        status="Returned",
        key_location=returned_to,
    ))
    _commit_or_500()
    db.session.refresh(key)

    cs = key.current_status

    if request.accept_mimetypes.accept_html and not request.is_json:
        return redirect(url_for("keys.key_detail", key_id=key.id))

    return jsonify({
        "ok": True,
        "data": {
            "id": key.id,
            "status": cs.status if cs else None,
            "key_location": cs.key_location if cs else None,
            "inserted_at": cs.inserted_at.isoformat() if cs and cs.inserted_at else None,
        }
    })




@keys_bp.get("/api/keys/signed-out")
def api_keys_signed_out():
    """
    Returns keys whose LATEST KeyStatus row is 'Signed Out'
    """
    KS = KeyStatus

    # subquery: latest inserted_at per key_id
    latest = (
        db.session.query(
            KS.key_id.label("key_id"),
            func.max(KS.inserted_at).label("max_inserted_at"),
        )
        .group_by(KS.key_id)
        .subquery()
    )

    ks_latest = aliased(KS)

    # join keys -> latest -> key_status row matching latest timestamp
    rows = (
        db.session.query(Key, ks_latest)
        .join(latest, latest.c.key_id == Key.id)
        .join(
            ks_latest,
            (ks_latest.key_id == latest.c.key_id)
            & (ks_latest.inserted_at == latest.c.max_inserted_at),
        )
        .filter(func.lower(ks_latest.status) == "signed out")
        .order_by(ks_latest.inserted_at.desc())
        .limit(100)
        .all()
    )

    data = []
    for key, ks in rows:
        data.append({
            "id": key.id,
            "keycode": key.keycode,
            "barcode": key.barcode,
            "area": key.area,
            "route": key.route,
            "key_location": ks.key_location,
            "status": ks.status,
            "inserted_at": ks.inserted_at.isoformat() if ks.inserted_at else None,
        })

    return jsonify({"data": data})


@keys_bp.get("/api/keys/<int:key_id>/history")
def api_key_history(key_id: int):
    """
    Returns recent KeyStatus events for a key (newest first).
    Default behavior: exclude events where key_location == home_location (case-insensitive),
    because the UI says "excluding Home".
    """
    key = db.session.query(Key).filter(Key.id == key_id).first()
    if key is None:
        abort(404, description="Key not found")

    limit_raw = request.args.get("limit", "50")
    try:
        limit = int(limit_raw)
    except ValueError:
        limit = 50
    limit = max(1, min(limit, 200))  # clamp 1..200

    include_home = (request.args.get("include_home") or "").lower() in ("1", "true", "yes")

    q = (
        db.session.query(KeyStatus)
        .filter(KeyStatus.key_id == key_id)
        .order_by(KeyStatus.inserted_at.desc())
    )


    rows = q.limit(limit).all()

    data = []
    for r in rows:
        data.append({
            "id": r.id,
            "status": r.status,
            "key_location": r.key_location,
            "inserted_at": r.inserted_at.isoformat() if r.inserted_at else None,
        })

    return jsonify({"data": data})