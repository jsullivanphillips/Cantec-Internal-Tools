from flask import Blueprint, render_template, session, redirect, url_for, request, jsonify, send_from_directory
from datetime import datetime
from app.db_models import db, MeetingMinute

home_bp = Blueprint('home', __name__)


@home_bp.route('/home')
def home():
    if not session.get('authenticated'):
        return redirect(url_for('auth.login'))
    
    return send_from_directory('../static/react_home_page', 'index.html')

@home_bp.route('/home/assets/<path:filename>')
def home_assets(filename):
    return send_from_directory('../static/react_home_page/assets', filename)


@home_bp.route('/api/meeting_minutes/list', methods=['GET'])
def get_meeting_minutes_list():
    try:
        offset = int(request.args.get('offset', 0))
        limit = int(request.args.get('limit', 4))
    except ValueError:
        return jsonify({'error': 'Invalid offset or limit'}), 400

    minutes = (
        MeetingMinute.query
        .order_by(MeetingMinute.week_of.desc(), MeetingMinute.updated_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return jsonify([
        {
            'id': m.id,
            'content': m.content,
            'week_of': m.week_of.isoformat(),
            'updated_at': m.updated_at.isoformat(),
            'modified_by': m.modified_by or "Unknown"
        }
        for m in minutes
    ])


@home_bp.route('/api/meeting_minutes', methods=['POST'])
def create_meeting_minute():
    data = request.get_json()
    week_of_str = data.get('week_of')
    content = data.get('content', '')  # Allow blank content

    if not week_of_str:
        return jsonify({'error': 'Missing week_of'}), 400

    try:
        week_of = datetime.strptime(week_of_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD.'}), 400

    username = session.get('username', 'unknown')

    minute = MeetingMinute(
        week_of=week_of,
        content=content,
        modified_by=username
    )

    db.session.add(minute)
    db.session.commit()

    return jsonify({
        'message': 'Meeting minute created.',
        'id': minute.id,
        'week_of': minute.week_of.isoformat(),
        'updated_at': minute.updated_at.isoformat(),
        'modified_by': minute.modified_by
    })


@home_bp.route('/api/meeting_minutes/<int:minute_id>', methods=['PATCH'])
def update_meeting_minute(minute_id):
    data = request.get_json()
    minute = MeetingMinute.query.get_or_404(minute_id)

    username = session.get('username', 'unknown')

    if 'week_of' in data:
        try:
            new_date = datetime.strptime(data['week_of'], "%Y-%m-%d").date()
            minute.week_of = new_date
        except ValueError:
            return jsonify({'error': 'Invalid date format'}), 400

    if 'content' in data:
        minute.content = data['content']

    minute.modified_by = username
    db.session.commit()

    return jsonify({'message': 'Meeting minute updated successfully.'})


@home_bp.route('/api/meeting_minutes/history', methods=['GET'])
def get_meeting_minutes_history():
    week_of_str = request.args.get('week_of')
    if not week_of_str:
        return jsonify({'error': 'Missing week_of'}), 400

    try:
        week_of = datetime.strptime(week_of_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400

    history = (
        MeetingMinute.query
        .filter_by(week_of=week_of)
        .order_by(MeetingMinute.updated_at.desc())
        .all()
    )

    return jsonify([
        {
            'id': m.id,
            'content': m.content,
            'updated_at': m.updated_at.isoformat(),
            'modified_by': m.modified_by or "Unknown"
        }
        for m in history
    ])


@home_bp.route('/api/meeting_minutes/<int:minute_id>', methods=['DELETE'])
def delete_meeting_minute(minute_id):
    minute = MeetingMinute.query.get(minute_id)
    if not minute:
        return jsonify({'error': 'Meeting minute not found'}), 404

    db.session.delete(minute)
    db.session.commit()

    return jsonify({'message': 'Meeting minute deleted successfully'})