# meadow_backend/routes/keys.py
from flask import Blueprint, render_template, request, jsonify, abort
from sqlalchemy import or_
from app.db_models import db, Key, KeyAddress, KeyStatus  # adjust import path to your Key model

keys_bp = Blueprint("keys", __name__, template_folder="templates")



@keys_bp.get("/keys")
def keys_home():
    return render_template("keys_home.html")

@keys_bp.get("/keys/<int:key_id>")
def key_detail(key_id: int):
    key = Key.query.get(key_id)
    if not key:
        abort(404, description="Key not found")
    return render_template("key_detail.html", key=key)


@keys_bp.get("/api/keys/search")
def api_keys_search():
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify({"data": []})

    like = f"%{q}%"

    # Join addresses so we can search by address too
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
            "addresses": [a.address for a in getattr(key, "addresses", [])][:3],
        })

    return jsonify({"data": results})

