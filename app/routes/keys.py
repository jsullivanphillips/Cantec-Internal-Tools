# meadow_backend/routes/keys.py
from flask import Blueprint, render_template, abort
from app.db_models import db, Key  # adjust import path to your Key model

keys_bp = Blueprint("keys", __name__, template_folder="templates")


@keys_bp.get("/keys/by-barcode/<barcode>")
def key_by_barcode_page(barcode: str):
    # barcode is stored as BigInteger, but scanner provides text
    try:
        barcode_int = int(barcode)
    except ValueError:
        abort(400, description="Invalid barcode")

    key = Key.query.filter_by(barcode=barcode_int).first()
    if not key:
        abort(404, description="Key not found")

    return render_template("key_detail.html", key=key)


