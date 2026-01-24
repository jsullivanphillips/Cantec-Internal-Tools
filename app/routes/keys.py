# app/routes/keys.py
from flask import Blueprint, render_template, request, jsonify, abort, redirect, url_for
from sqlalchemy import or_, func
from sqlalchemy.sql import over
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import selectinload, aliased
from .scheduling_attack import get_active_techs
import re

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

_ROUTE_BAG_RE = re.compile(r"^R\d+$", re.IGNORECASE)

def is_route_bag_keycode(keycode: str) -> bool:
    if not keycode:
        return False
    return bool(_ROUTE_BAG_RE.match(str(keycode).strip()))


def get_keys_older_than(number_of_days: int):
    if not isinstance(number_of_days, int) or number_of_days < 0:
        raise ValueError("number_of_days must be a non-negative int")

    KS = KeyStatus
    cutoff = datetime.now(timezone.utc) - timedelta(days=number_of_days)

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
        .filter((ks_latest.is_on_monthly.is_(False)) | (ks_latest.is_on_monthly.is_(None)))
        .filter(ks_latest.inserted_at <= cutoff)
        .order_by(ks_latest.inserted_at.asc())  # oldest first (usually what you want)
        .limit(100)
        .all()
    )

    return rows


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
    return render_template("key_detail.html", key=key, is_key_bag=is_route_bag_keycode(key.keycode))


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
    return render_template("key_detail.html", key=key, is_key_bag=is_route_bag_keycode(key.keycode))


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

    bag_code = (key.keycode or "").strip()
    is_bag = is_route_bag_keycode(bag_code)

    # 1) Always sign out the bag (or normal key) itself (NOT monthly)
    db.session.add(KeyStatus(
        key_id=key.id,
        status="Signed Out",
        key_location=signed_out_to,
        air_tag=air_tag,
        is_on_monthly=False,
    ))

    # 2) If it's a route bag, bulk sign-out all keys on that route that are NOT already out
    if is_bag:
        KS = KeyStatus

        latest = (
            db.session.query(
                KS.key_id.label("key_id"),
                func.max(KS.inserted_at).label("max_inserted_at"),
            )
            .group_by(KS.key_id)
            .subquery()
        )

        ks_latest = aliased(KS)

        # Keys on this route, with either:
        # - no status history yet, OR
        # - latest status is not "Signed Out"
        keys_to_sign_out = (
            db.session.query(Key.id)
            .outerjoin(latest, latest.c.key_id == Key.id)
            .outerjoin(
                ks_latest,
                (ks_latest.key_id == latest.c.key_id)
                & (ks_latest.inserted_at == latest.c.max_inserted_at),
            )
            .filter(Key.route == bag_code)
            .filter(
                (ks_latest.id.is_(None)) |
                (func.lower(ks_latest.status) != "signed out")
            )
            .all()
        )

        bulk = []
        for (kid,) in keys_to_sign_out:
            bulk.append(KeyStatus(
                key_id=kid,
                status="Signed Out",
                key_location=signed_out_to,
                air_tag=None,              # don’t copy bag airtag to every key
                is_on_monthly=True,
            ))

        if bulk:
            db.session.bulk_save_objects(bulk)

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

    returned_by = (request.form.get("returned_by") or "").strip()

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
                "returned_by": cs.returned_by if cs else None,
                "inserted_at": cs.inserted_at.isoformat() if cs and cs.inserted_at else None,
            }
        })

    if not returned_by:
        if request.accept_mimetypes.accept_html and not request.is_json:
            return redirect(url_for("keys.key_detail", key_id=key.id))

        return jsonify({
            "ok": False,
            "error": "Please enter who is returning the key.",
            "code": "missing_returned_by",
        }), 400

    returned_to = (key.home_location or "").strip() or "Office"

    bag_code = (key.keycode or "").strip()
    is_bag = is_route_bag_keycode(bag_code)

    # 1) Return the bag (or normal key) itself (NOT monthly)
    db.session.add(KeyStatus(
        key_id=key.id,
        status="Returned",
        key_location=returned_to,
        returned_by=returned_by,
        is_on_monthly=False,
    ))

    # 2) If bag, return all keys on this route that are currently out AND were out via monthly (is_on_monthly=True)
    if is_bag:
        KS = KeyStatus

        latest = (
            db.session.query(
                KS.key_id.label("key_id"),
                func.max(KS.inserted_at).label("max_inserted_at"),
            )
            .group_by(KS.key_id)
            .subquery()
        )

        ks_latest = aliased(KS)

        keys_to_return = (
            db.session.query(Key.id)
            .join(latest, latest.c.key_id == Key.id)
            .join(
                ks_latest,
                (ks_latest.key_id == latest.c.key_id)
                & (ks_latest.inserted_at == latest.c.max_inserted_at),
            )
            .filter(Key.route == bag_code)
            .filter(func.lower(ks_latest.status) == "signed out")
            .filter(ks_latest.is_on_monthly.is_(True))
            .all()
        )

        bulk = []
        for (kid,) in keys_to_return:
            bulk.append(KeyStatus(
                key_id=kid,
                status="Returned",
                key_location="Office",     # route keys return to office
                returned_by=returned_by,
                is_on_monthly=False,       # they are no longer “on monthly” once returned
            ))

        if bulk:
            db.session.bulk_save_objects(bulk)

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
            "returned_by": cs.returned_by if cs else None,
            "inserted_at": cs.inserted_at.isoformat() if cs and cs.inserted_at else None,
        }
    })





@keys_bp.get("/api/keys/signed-out")
def api_keys_signed_out():
    """
    Returns keys whose LATEST KeyStatus row is 'Signed Out'
    Includes key addresses (KeyAddress table).
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
        .filter((ks_latest.is_on_monthly.is_(False)) | (ks_latest.is_on_monthly.is_(None)))
        .order_by(ks_latest.inserted_at.asc())
        .limit(100)
        .all()
    )

    data = []
    for key, ks in rows:
        addresses = [a.address for a in (key.addresses or []) if a.address]

        data.append({
            "id": key.id,
            "keycode": key.keycode,
            "barcode": key.barcode,
            "area": key.area,
            "route": key.route,
            "addresses": addresses,  # ✅ added
            "key_location": ks.key_location,
            "status": ks.status,
            "inserted_at": ks.inserted_at.isoformat() if ks.inserted_at else None,
            "is_key_bag": is_route_bag_keycode(key.keycode),
        })

    return jsonify({"data": data})


@keys_bp.get("/api/keys/bag-signed-out")
def api_bag_signed_out():
    """
    For a given route bag code (e.g., R12), return keys on that route whose LATEST status is Signed Out
    (excluding monthly bulk signouts), so the UI can warn before a bag bulk signout.
    """
    bag_code = (request.args.get("bag_code") or "").strip()
    exclude_key_id_raw = (request.args.get("exclude_key_id") or "").strip()

    if not bag_code or not is_route_bag_keycode(bag_code):
        return jsonify({"ok": True, "data": []})

    exclude_key_id = None
    if exclude_key_id_raw:
        try:
            exclude_key_id = int(exclude_key_id_raw)
        except ValueError:
            exclude_key_id = None

    KS = KeyStatus

    latest = (
        db.session.query(
            KS.key_id.label("key_id"),
            func.max(KS.inserted_at).label("max_inserted_at"),
        )
        .group_by(KS.key_id)
        .subquery()
    )

    ks_latest = aliased(KS)

    q = (
        db.session.query(Key, ks_latest)
        .options(selectinload(Key.addresses))
        .join(latest, latest.c.key_id == Key.id)
        .join(
            ks_latest,
            (ks_latest.key_id == latest.c.key_id)
            & (ks_latest.inserted_at == latest.c.max_inserted_at),
        )
        .filter(Key.route == bag_code)
        .filter(func.lower(func.trim(ks_latest.status)) == "signed out")
        # Exclude "monthly bag" signouts (those are bookkeeping, not an actual separate signout)
        .filter((ks_latest.is_on_monthly.is_(False)) | (ks_latest.is_on_monthly.is_(None)))
    )

    # Exclude the bag key itself (its keycode is the bag code), and optionally exclude by id too
    q = q.filter(func.lower(func.trim(Key.keycode)) != bag_code.lower())

    if exclude_key_id is not None:
        q = q.filter(Key.id != exclude_key_id)

    rows = q.order_by(ks_latest.inserted_at.desc()).limit(50).all()

    data = []
    for key, ks in rows:
        address = None
        if getattr(key, "addresses", None):
            address = key.addresses[0].address if key.addresses else None

        data.append({
            "key_id": key.id,
            "keycode": key.keycode,
            "address": address,
            "signed_out_to": ks.key_location,
            "inserted_at": ks.inserted_at.isoformat() if ks.inserted_at else None,
        })
    print(data)
    return jsonify({"ok": True, "data": data})

@keys_bp.get("/api/keys/airtag-conflict")
def api_airtag_conflict():
    """
    Checks whether an AirTag is currently in-use on a different key whose latest status is Signed Out.
    Returns keycode + address + signed_out_to (key_location) for warning modal.
    """
    air_tag = (request.args.get("air_tag") or "").strip()
    exclude_key_id_raw = (request.args.get("exclude_key_id") or "").strip()

    if not air_tag:
        return jsonify({"conflict": False})

    exclude_key_id = None
    if exclude_key_id_raw:
        try:
            exclude_key_id = int(exclude_key_id_raw)
        except ValueError:
            exclude_key_id = None

    KS = KeyStatus

    latest = (
        db.session.query(
            KS.key_id.label("key_id"),
            func.max(KS.inserted_at).label("max_inserted_at"),
        )
        .group_by(KS.key_id)
        .subquery()
    )

    ks_latest = aliased(KS)

    q = (
        db.session.query(Key, ks_latest)
        .options(selectinload(Key.addresses))
        .join(latest, latest.c.key_id == Key.id)
        .join(
            ks_latest,
            (ks_latest.key_id == latest.c.key_id)
            & (ks_latest.inserted_at == latest.c.max_inserted_at),
        )
        .filter(func.lower(ks_latest.status) == "signed out")
        .filter(func.lower(ks_latest.air_tag) == air_tag.lower())
    )

    if exclude_key_id is not None:
        q = q.filter(Key.id != exclude_key_id)

    row = q.order_by(ks_latest.inserted_at.desc()).first()
    if not row:
        return jsonify({"conflict": False})

    key, ks = row
    address = None
    if getattr(key, "addresses", None):
        address = key.addresses[0].address if key.addresses else None

    return jsonify({
        "conflict": True,
        "data": {
            "key_id": key.id,
            "keycode": key.keycode,
            "address": address,
            "signed_out_to": ks.key_location,
            "air_tag": ks.air_tag,
        }
    })



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
            "returned_by": r.returned_by,
            "inserted_at": r.inserted_at.isoformat() if r.inserted_at else None,
        })

    return jsonify({"data": data})


@keys_bp.get("/keys/metrics")
def key_metrics_page():
    return render_template("key_metrics.html")

@keys_bp.get("/api/keys/metrics")
def api_key_metrics():
    """
    Metrics implemented:
      1) Signed-outs per day
      2) Unique users signing out per week (distinct key_location on signout rows)
      4) % of returns with returned_by
      5) % of signouts with air_tag
      6) Avg duration a key is out (signout -> next return)
      9) Double sign-outs (signout when previous status was already out)
    """
    # -----------------------------
    # Date range parsing
    # -----------------------------
    def parse_ymd(s: str):
        if not s:
            return None
        try:
            return datetime.strptime(s, "%Y-%m-%d")
        except ValueError:
            return None

    start = parse_ymd(request.args.get("start"))
    end = parse_ymd(request.args.get("end"))

    # Default: last 30 days (inclusive)
    if not end:
        end = datetime.now()
    if not start:
        start = end - timedelta(days=30)

    # Clamp end >= start
    if end < start:
        start, end = end, start

    # Make end exclusive by adding 1 day (so "2026-01-12" includes that date)
    end_excl = end + timedelta(days=1)

    SIGNOUT_STATUSES = ("signed out", "out")
    RETURN_STATUSES = ("returned", "in", "available")

    non_monthly = func.coalesce(KeyStatus.is_on_monthly, False).is_(False)

    # Normalize status in SQL
    status_norm = func.lower(func.trim(KeyStatus.status))

    # -----------------------------
    # Metric 1: signouts per day
    # -----------------------------
    signouts_by_day_rows = (
        db.session.query(
            func.date_trunc("day", KeyStatus.inserted_at).label("day"),
            func.count().label("count"),
        )
        .filter(KeyStatus.inserted_at >= start, KeyStatus.inserted_at < end_excl)
        .filter(non_monthly)
        .filter(status_norm.in_(SIGNOUT_STATUSES))
        .group_by(func.date_trunc("day", KeyStatus.inserted_at))
        .order_by(func.date_trunc("day", KeyStatus.inserted_at).asc())
        .all()
    )

    signouts_by_day = [
        {"day": r.day.date().isoformat(), "count": int(r.count)}
        for r in signouts_by_day_rows
    ]

    total_signouts = sum(x["count"] for x in signouts_by_day)

    # -----------------------------
    # Metric 2: unique users signing out per week
    # (distinct key_location on signout rows)
    # -----------------------------
    # Treat blank key_location as NULL so it doesn't inflate distinct counts
    key_location_norm = func.nullif(func.trim(KeyStatus.key_location), "")

    unique_users_by_week_rows = (
        db.session.query(
            func.date_trunc("week", KeyStatus.inserted_at).label("week"),
            func.count(func.distinct(key_location_norm)).label("count"),
        )
        .filter(KeyStatus.inserted_at >= start, KeyStatus.inserted_at < end_excl)
        .filter(non_monthly)
        .filter(status_norm.in_(SIGNOUT_STATUSES))
        .group_by(func.date_trunc("week", KeyStatus.inserted_at))
        .order_by(func.date_trunc("week", KeyStatus.inserted_at).asc())
        .all()
    )

    unique_users_by_week = [
        {"week": r.week.date().isoformat(), "count": int(r.count)}
        for r in unique_users_by_week_rows
    ]

    # -----------------------------
    # Metric 4: % returns with returned_by
    # -----------------------------
    returned_by_norm = func.nullif(func.trim(KeyStatus.returned_by), "")

    returns_tot = (
        db.session.query(func.count())
        .filter(KeyStatus.inserted_at >= start, KeyStatus.inserted_at < end_excl)
        .filter(non_monthly)
        .filter(status_norm.in_(RETURN_STATUSES))
        .scalar()
    ) or 0

    returns_with_returned_by = (
        db.session.query(func.count())
        .filter(KeyStatus.inserted_at >= start, KeyStatus.inserted_at < end_excl)
        .filter(non_monthly)
        .filter(status_norm.in_(RETURN_STATUSES))
        .filter(returned_by_norm.isnot(None))
        .scalar()
    ) or 0

    returned_by_rate = (returns_with_returned_by / returns_tot) if returns_tot else None

    # -----------------------------
    # Metric 5: % signouts with air_tag
    # -----------------------------
    air_tag_norm = func.nullif(func.trim(KeyStatus.air_tag), "")

    signouts_tot = (
        db.session.query(func.count())
        .filter(KeyStatus.inserted_at >= start, KeyStatus.inserted_at < end_excl)
        .filter(non_monthly)
        .filter(status_norm.in_(SIGNOUT_STATUSES))
        .scalar()
    ) or 0

    signouts_with_airtag = (
        db.session.query(func.count())
        .filter(KeyStatus.inserted_at >= start, KeyStatus.inserted_at < end_excl)
        .filter(non_monthly)
        .filter(status_norm.in_(SIGNOUT_STATUSES))
        .filter(air_tag_norm.isnot(None))
        .scalar()
    ) or 0

    airtag_rate = (signouts_with_airtag / signouts_tot) if signouts_tot else None

    # -----------------------------
    # Metric 6: average duration out (signout -> next return)
    # Compute LEAD() in a subquery, then filter outer query
    # -----------------------------
    next_status = func.lead(status_norm).over(
        partition_by=KeyStatus.key_id,
        order_by=KeyStatus.inserted_at.asc(),
    )
    next_time = func.lead(KeyStatus.inserted_at).over(
        partition_by=KeyStatus.key_id,
        order_by=KeyStatus.inserted_at.asc(),
    )

    dur_base = (
        db.session.query(
            KeyStatus.key_id.label("key_id"),
            KeyStatus.inserted_at.label("signed_out_at"),
            status_norm.label("status_norm"),
            next_status.label("next_status"),
            next_time.label("next_time"),
        )
        # include enough rows to find "next" events for signouts in-range
        .filter(KeyStatus.inserted_at < end_excl)
        .filter(non_monthly)
        .subquery()
    )

    duration_seconds_expr = func.extract("epoch", dur_base.c.next_time - dur_base.c.signed_out_at)

    avg_out_duration_seconds = (
        db.session.query(func.avg(duration_seconds_expr))
        .filter(dur_base.c.signed_out_at >= start, dur_base.c.signed_out_at < end_excl)
        .filter(dur_base.c.status_norm.in_(SIGNOUT_STATUSES))  # originating row is a signout
        .filter(dur_base.c.next_status.in_(RETURN_STATUSES))   # next row is a return
        .filter(dur_base.c.next_time.isnot(None))
        .scalar()
    )

    # ensure it's a plain float for JSON
    avg_out_duration_seconds = float(avg_out_duration_seconds) if avg_out_duration_seconds is not None else None


    # -----------------------------
    # Metric 9: double signouts (signout where previous status was already out)
    # Must compute LAG in a subquery (Postgres forbids window funcs in WHERE)
    # -----------------------------
    prev_status = func.lag(status_norm).over(
        partition_by=KeyStatus.key_id,
        order_by=KeyStatus.inserted_at.asc(),
    )

    double_base = (
        db.session.query(
            KeyStatus.inserted_at.label("inserted_at"),
            status_norm.label("status_norm"),
            prev_status.label("prev_status"),
        )
        .filter(KeyStatus.inserted_at >= start, KeyStatus.inserted_at < end_excl)
        .filter(non_monthly)
        .subquery()
    )

    double_signouts_by_day_rows = (
        db.session.query(
            func.date_trunc("day", double_base.c.inserted_at).label("day"),
            func.count().label("count"),
        )
        .filter(double_base.c.status_norm.in_(SIGNOUT_STATUSES))
        .filter(double_base.c.prev_status.in_(SIGNOUT_STATUSES))
        .group_by(func.date_trunc("day", double_base.c.inserted_at))
        .order_by(func.date_trunc("day", double_base.c.inserted_at).asc())
        .all()
    )

    double_signouts_by_day = [
        {"day": r.day.date().isoformat(), "count": int(r.count)}
        for r in double_signouts_by_day_rows
    ]

    double_signouts_total = sum(x["count"] for x in double_signouts_by_day)


    return jsonify({
        "ok": True,
        "range": {"start": start.date().isoformat(), "end": end.date().isoformat()},
        "kpis": {
            "total_signouts": int(signouts_tot),
            "total_returns": int(returns_tot),
            "returns_with_returned_by": int(returns_with_returned_by),
            "signouts_with_airtag": int(signouts_with_airtag),
            "returned_by_rate": returned_by_rate,  # float 0..1 or None
            "airtag_rate": airtag_rate,            # float 0..1 or None
            "avg_out_duration_seconds": avg_out_duration_seconds,  # float or None
            "double_signouts_total": int(double_signouts_total),
        },
        "series": {
            "signouts_by_day": signouts_by_day,
            "unique_users_by_week": unique_users_by_week,
            "double_signouts_by_day": double_signouts_by_day,
        }
    })
