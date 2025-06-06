from flask import Blueprint, render_template

performance_summary_bp = Blueprint('performance_summary', __name__, template_folder='templates')

# Main Route
@performance_summary_bp.route('/performance_summary', methods=['GET'])
def performance_summary():
    """
    Render the main performance_summary page (HTML).
    """
    return render_template("performance_summary.html")