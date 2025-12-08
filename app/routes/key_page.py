from flask import render_template, Blueprint

key_page_bp = Blueprint("key_page", __name__, template_folder='templates')

# Replace these with your actual ServiceTrade API credentials and endpoint details.
SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
API_KEY = "YOUR_API_KEY"

@key_page_bp.route("/key_page", methods=["GET", "POST"])

@key_page_bp.route("/key_page", methods=['GET'])
def key_page():
    return render_template("key_page.html")
