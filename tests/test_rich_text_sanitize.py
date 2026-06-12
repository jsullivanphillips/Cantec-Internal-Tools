from app.monthly.rich_text_sanitize import (
    RICH_TEXT_COLOR_CLASSES,
    sanitize_rich_text_comment,
    sanitize_rich_text_html,
)


def test_sanitize_preserves_plain_text():
    assert sanitize_rich_text_html("Check panel") == "Check panel"


def test_sanitize_allows_bold_and_color():
    raw = '<b>Warn</b> <span class="rt-red">Stop</span>'
    assert sanitize_rich_text_html(raw) == raw


def test_sanitize_strips_script_and_links():
    assert sanitize_rich_text_html('<script>alert(1)</script>Hi') == "alert(1)Hi"
    assert sanitize_rich_text_html('<a href="x">Link</a>') == "Link"


def test_sanitize_keeps_allowed_span_color_class():
    assert sanitize_rich_text_html('<span class="rt-red evil">X</span>') == '<span class="rt-red">X</span>'


def test_normalize_empty_to_none():
    assert sanitize_rich_text_comment("<b></b>") is None
    assert sanitize_rich_text_comment("   ") is None


def test_color_class_allowlist():
    assert "rt-red" in RICH_TEXT_COLOR_CLASSES
    assert "rt-evil" not in RICH_TEXT_COLOR_CLASSES
