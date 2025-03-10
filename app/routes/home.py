# app/routes/home.py
from flask import Blueprint, render_template, session, redirect, url_for

home_bp = Blueprint('home', __name__)

@home_bp.route('/home')
def home():
    if not session.get('authenticated'):
        return redirect(url_for('auth.login'))
    return render_template('home.html')
