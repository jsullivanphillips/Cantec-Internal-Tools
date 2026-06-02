"""Tests for monitoring notes parsing."""

from app.monthly.monitoring_notes_parse import parse_monitoring_notes, rebuild_monitoring_notes


def test_parse_colon_header_account():
    parsed = parse_monitoring_notes("COMPANY: Acme Monitoring\nACCT: 12345\nSignals on trouble")
    assert parsed.company == "Acme Monitoring"
    assert parsed.acct == "12345"
    assert "Signals" in (parsed.remainder_notes or "")


def test_parse_prose_account_hash():
    parsed = parse_monitoring_notes("Acme Fire\naccount # 9988")
    assert parsed.company == "Acme Fire"
    assert parsed.acct == "9988"


def test_rebuild_notes_omits_company_and_acct():
    parsed = parse_monitoring_notes("COMPANY: Acme\nACCT: 55\nPASS: boats")
    rebuilt = rebuild_monitoring_notes(parsed)
    assert rebuilt is not None
    assert "COMPANY" not in rebuilt
    assert "ACCT" not in rebuilt
    assert "PASS: boats" in rebuilt
