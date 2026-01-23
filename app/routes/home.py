# app/routes/homes.py
from flask import Blueprint, render_template, redirect, url_for, jsonify, session
from app.routes.processing_attack import get_jobs_processed_today, get_jobs_to_be_invoiced, get_num_jobs_to_be_marked_complete, get_pink_folder_data
from app.routes.scheduling_attack import get_forward_schedule_coverage_pct, get_percent_confirmed_next_two_weeks
from app.routes.limbo_job_tracker import get_limbo_jobs
from app.routes.keys import get_keys_older_than

import requests

home_bp = Blueprint("home", __name__)
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"

# Landing with authentication
@home_bp.route("/home")
def home():
    """
    Home page (HTML + JS).
    For now: just render home.html.
    (Auth check left in place to match previous behavior.)
    """
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {
        "username": session.get("username"),
        "password": session.get("password"),
    }

    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception:
        return redirect(url_for("auth.login"))

    return render_template("home.html")

# Routes
@home_bp.route("/home/kpi/jobs_to_process")
def home_jobs_to_process():
    num_jobs_to_process = get_num_jobs_to_be_marked_complete()
    response_data =  {
        "jobs_to_process": num_jobs_to_process
    }
    return jsonify(response_data), 200

@home_bp.route("/home/kpi/jobs_to_invoice")
def home_jobs_to_invoice():
    jobs_to_be_invoiced = get_jobs_to_be_invoiced()
    response_data =  {
        "jobs_to_be_invoiced": jobs_to_be_invoiced
    }
    return jsonify(response_data), 200

@home_bp.route("/home/kpi/forward_schedule_coverage")
def home_forward_schedule_coverage():
    forward_schedule_coverage_pct = get_percent_confirmed_next_two_weeks()
    response_data =  {
        "forward_schedule_coverage":  forward_schedule_coverage_pct
    }
    return jsonify(response_data), 200

@home_bp.route("/home/kpi/jobs_completed_today")
def home_jobs_completed_today():
    jobs_completed_today = get_jobs_processed_today()
    response_data =  {
        "jobs_completed_today": jobs_completed_today
    }
    return jsonify(response_data), 200

from flask import jsonify, url_for, current_app

@home_bp.route("/home/needs_attention")
def home_needs_attention():
    items = []

    def add_item(severity: str, title: str, subtitle: str, href: str, badge: str | None = None):
        payload = {
            "severity": severity,
            "title": title,
            "subtitle": subtitle,
            "href": href,
        }
        if badge is not None:
            payload["badge"] = str(badge)
        items.append(payload)

    def safe_count(x) -> int:
        """Accept int, list, tuple, None. Return an int count."""
        if x is None:
            return 0
        if isinstance(x, int):
            return x
        try:
            return len(x)
        except TypeError:
            return 0

    # --- Processing: Jobs to process ---
    try:
        count = get_num_jobs_to_be_marked_complete()

        if count >= 50:
            add_item(
                "bad",
                "Processing backlog is high",
                f"{count} jobs waiting to be marked complete",
                url_for("processing_attack.processing_attack"),
                badge=count,
            )
        elif count >= 40:
            add_item(
                "warn",
                "Processing backlog needs attention",
                f"{count} jobs waiting to be marked complete",
                url_for("processing_attack.processing_attack"),
                badge=count,
            )
    except Exception:
        current_app.logger.exception("home_needs_attention: jobs_to_process failed")

    # --- Processing: Jobs to invoice ---
    try:
        jobs_to_be_invoiced = get_jobs_to_be_invoiced()
        count = safe_count(jobs_to_be_invoiced)

        if count > 30:
            add_item(
                "bad",
                "Invoicing queue is high",
                f"{count} completed jobs ready to invoice",
                url_for("processing_attack.processing_attack"),
                badge=count,
            )
        elif count > 20:
            add_item(
                "warn",
                "Invoicing queue needs attention",
                f"{count} completed jobs ready to invoice",
                url_for("processing_attack.processing_attack"),
                badge=count,
            )
    except Exception:
        current_app.logger.exception("home_needs_attention: jobs_to_invoice failed")

    # --- Scheduling: Forward coverage ---
    try:
        forward_num_weeks = float(get_forward_schedule_coverage_pct())
        if forward_num_weeks < 5:
            add_item(
                "bad",
                "Forward schedule coverage is low",
                f"{forward_num_weeks} weeks are booked",
                url_for("scheduling_attack.scheduling_attack"),
                badge=f"{forward_num_weeks}",
            )
        elif forward_num_weeks < 7:
            add_item(
                "warn",
                "Forward schedule coverage is trending low",
                f"{forward_num_weeks} weeks are booked",
                url_for("scheduling_attack.scheduling_attack"),
                badge=f"{forward_num_weeks}",
            )
    except Exception:
        current_app.logger.exception("home_needs_attention: forward_schedule_coverage failed")

    # --- Scheduling: Percent confirmed ---
    try:
        confirmed_pct = float(get_percent_confirmed_next_two_weeks())
        if confirmed_pct < 80:
            add_item(
                "bad",
                "Schedule confirmation is low",
                f"{confirmed_pct:.0f}% confirmed over next 2 weeks",
                url_for("scheduling_attack.scheduling_attack"),
                badge=f"{confirmed_pct:.0f}%",
            )
        elif confirmed_pct < 90:
            add_item(
                "warn",
                "Schedule confirmation is trending low",
                f"{confirmed_pct:.0f}% confirmed over next 2 weeks",
                url_for("scheduling_attack.scheduling_attack"),
                badge=f"{confirmed_pct:.0f}%",
            )
    except Exception:
        current_app.logger.exception("home_needs_attention: percent_confirmed failed")

    # --- Service: Number of Limbo Jobs ---
    try:
        limbo_jobs = get_limbo_jobs()
        num_limbo_jobs = safe_count(limbo_jobs)

        if num_limbo_jobs > 20:
            add_item(
                "bad",
                "High number of Limbo Jobs",
                f"{num_limbo_jobs} Limbo Jobs",
                url_for("limbo_job_tracker.limbo_job_tracker"),
                badge=num_limbo_jobs,  # ✅ fixed badge
            )
        elif num_limbo_jobs > 10:
            add_item(
                "warn",
                "Number of Limbo Jobs is trending up",
                f"{num_limbo_jobs} Limbo Jobs",
                url_for("limbo_job_tracker.limbo_job_tracker"),
                badge=num_limbo_jobs,  # ✅ fixed badge
            )
    except Exception:
        current_app.logger.exception("home_needs_attention: limbo_jobs failed")

    # --- Processing: Pink Folder Jobs ---
    try:
        number_of_pink_folder_jobs, _, _ = get_pink_folder_data()

        if number_of_pink_folder_jobs > 20:
            add_item(
                "bad",
                "High number of Pink Folder Jobs",
                f"{number_of_pink_folder_jobs} Pink Folder Jobs",
                url_for("pink_folder.pink_folder"),
                badge=number_of_pink_folder_jobs, 
            )
        elif number_of_pink_folder_jobs > 10:
            add_item(
                "warn",
                "Number of Pink Folder Jobs is trending up",
                f"{number_of_pink_folder_jobs} Pink Folder Jobs",
                url_for("pink_folder.pink_folder"),
                badge=number_of_pink_folder_jobs, 
            )
    except Exception:
        current_app.logger.exception("home_needs_attention: pink_folder_jobs failed")

    # --- Service: Keys signed out longer than X days ---
    try:
        keys_older_than_3 = get_keys_older_than(3)     # list[(Key, KeyStatus)]
        keys_older_than_5 = get_keys_older_than(5)   # list[(Key, KeyStatus)]

        # Extract key IDs for set math
        ids_3 = {k.id for k, _ in keys_older_than_3}
        ids_5 = {k.id for k, _ in keys_older_than_5}

        # Mutually exclusive buckets
        ids_3_to_4 = ids_3 - ids_5

        count_5_plus = len(ids_5)
        count_3_to_4 = len(ids_3_to_4)

        if count_5_plus > 0:
            add_item(
                "bad",
                "Keys signed out for over 5 days",
                f"{count_5_plus} keys signed out for 5+ days",
                url_for("keys.keys_home"),
                badge=count_5_plus,
            )
        elif count_3_to_4 > 0:
            add_item(
                "warn",
                "Keys signed out for over 3 days",
                f"{count_3_to_4} keys signed out for 3–4 days",
                url_for("keys.keys_home"),
                badge=count_3_to_4,
            )

    except Exception:
        current_app.logger.exception("home_needs_attention: keys_signed_out_too_long failed")


    # Sort: bad first, then warn, then good
    order = {"bad": 0, "warn": 1, "good": 2}
    items.sort(key=lambda x: order.get(x["severity"], 9))

    return jsonify({"items": items[:8]}), 200



