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
        session['authenticated'] = True
        session['username'] = username
        session['password'] = password
        return redirect(url_for('home.home'))
    return render_template('login.html')

@auth_bp.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('auth.login'))
