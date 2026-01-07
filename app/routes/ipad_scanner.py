from flask import render_template, Blueprint

ipad_scanner_bp = Blueprint("ipad_scanner", __name__, template_folder="templates")

@ipad_scanner_bp.get("/ipad_scanner")
def ipad_scanner():
    return render_template("ipad_scanner.html")
