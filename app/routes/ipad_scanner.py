from flask import render_template, Blueprint

ipad_scanner_bp = Blueprint("ipad_scanner", __name__, template_folder='templates')

# Replace these with your actual ServiceTrade API credentials and endpoint details.
SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
API_KEY = "YOUR_API_KEY"

@ipad_scanner_bp.route("/ipad_scanner", methods=["GET", "POST"])

@ipad_scanner_bp.route("/ipad_scanner", methods=['GET'])
def ipad_scanner():
    return render_template("ipad_scanner.html")
