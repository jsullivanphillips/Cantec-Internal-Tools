# app/routes/auth.py
from flask import Blueprint, request, redirect, url_for, session
import requests

from app.spa import send_spa_index

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user_session = requests.Session()
        auth_url = "https://api.servicetrade.com/api/auth"
        payload = {"username": username, "password": password}
        try:
            auth_response = user_session.post(auth_url, json=payload)
            auth_response.raise_for_status()
        except Exception:
            return send_spa_index()

        account_url = "https://api.servicetrade.com/api/account"
        try:
            account_response = user_session.get(account_url)
            account_response.raise_for_status()
            account_data = account_response.json()
            account_timezone = account_data["data"]["accounts"][0]["timezone"]
        except Exception:
            return send_spa_index()

        session['authenticated'] = True
        session['username'] = username
        session['password'] = password
        session['account_timezone'] = account_timezone

        return redirect(url_for('home.home'))
    return send_spa_index()

@auth_bp.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('auth.login'))
