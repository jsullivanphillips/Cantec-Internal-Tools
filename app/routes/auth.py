# app/routes/auth.py
from flask import Blueprint, render_template, request, redirect, url_for, session
import requests

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
        except Exception as e:
            error = f"Authentication failed: {e}"
            return render_template('login.html', error=error)

        # Retrieve account info to get the timezone
        account_url = "https://api.servicetrade.com/api/account"
        try:
            account_response = user_session.get(account_url)
            account_response.raise_for_status()
            account_data = account_response.json()
            # Assuming you want the timezone from the first account in the list.
            account_timezone = account_data["data"]["accounts"][0]["timezone"]
        except Exception as e:
            error = f"Failed to retrieve account timezone: {e}"
            return render_template('login.html', error=error)

        # Store relevant info in the session
        session['authenticated'] = True
        session['username'] = username
        session['password'] = password
        session['account_timezone'] = account_timezone

        return redirect(url_for('home.home'))
    return render_template('login.html')

@auth_bp.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('auth.login'))
