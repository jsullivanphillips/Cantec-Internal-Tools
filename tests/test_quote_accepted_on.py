from datetime import datetime, timezone

from app.routes.performance_summary import extract_quote_accepted_on


def test_extract_quote_accepted_on_returns_none_when_not_accepted():
    assert extract_quote_accepted_on({"status": "submitted", "accepted": 1710000000}) is None


def test_extract_quote_accepted_on_reads_latest_accepted():
    ts = 1710000002
    result = extract_quote_accepted_on({"status": "accepted", "latestAccepted": ts, "updated": 1710000099})
    assert result == datetime.fromtimestamp(ts, tz=timezone.utc)


def test_extract_quote_accepted_on_reads_accepted_timestamp():
    ts = 1710000000
    result = extract_quote_accepted_on({"status": "accepted", "accepted": ts})
    assert result == datetime.fromtimestamp(ts, tz=timezone.utc)


def test_extract_quote_accepted_on_falls_back_to_status_changed():
    ts = 1710000001
    result = extract_quote_accepted_on({"status": "accepted", "statusChanged": ts})
    assert result == datetime.fromtimestamp(ts, tz=timezone.utc)
