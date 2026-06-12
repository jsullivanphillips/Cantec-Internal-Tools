"""Sanitize inline rich text for stop comment fields (bold + color only)."""

from __future__ import annotations

import re

RICH_TEXT_COMMENT_FIELDS = frozenset(
    {
        "office_job_comment",
        "testing_procedures",
        "inspection_tech_notes",
        "run_comments",
    }
)

RICH_TEXT_COLOR_CLASSES = frozenset(
    {
        "rt-black",
        "rt-red",
        "rt-green",
        "rt-blue",
        "rt-orange",
    }
)

_ALLOWED_TAGS = {"b", "strong", "span", "br"}
_TAG_RE = re.compile(r"<(/?)([a-zA-Z0-9]+)([^>]*)>", re.DOTALL)
_CLASS_ATTR_RE = re.compile(
    r"""class\s*=\s*(?:"([^"]*)"|'([^']*)')""",
    re.IGNORECASE,
)


def _strip_tags(value: str) -> str:
    return re.sub(r"<[^>]+>", "", value)


def _filter_span_classes(raw_attrs: str) -> str:
    match = _CLASS_ATTR_RE.search(raw_attrs)
    if not match:
        return raw_attrs
    classes = (match.group(1) or match.group(2) or "").split()
    allowed = [name for name in classes if name in RICH_TEXT_COLOR_CLASSES]
    if not allowed:
        return _CLASS_ATTR_RE.sub("", raw_attrs, count=1)
    replacement = f'class="{" ".join(allowed)}"'
    return _CLASS_ATTR_RE.sub(replacement, raw_attrs, count=1)


def sanitize_rich_text_html(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""

    try:
        import bleach
    except ImportError:
        bleach = None  # type: ignore[assignment]

    if bleach is not None:
        cleaned = bleach.clean(
            text,
            tags=list(_ALLOWED_TAGS),
            attributes={"span": ["class"]},
            strip=True,
        )
        return _postprocess_span_classes(cleaned).strip()

    return _sanitize_without_bleach(text)


def _postprocess_span_classes(html: str) -> str:
    def repl(match: re.Match[str]) -> str:
        closing, tag, attrs = match.group(1), match.group(2).lower(), match.group(3)
        if closing or tag != "span":
            return match.group(0)
        return f"<span{_filter_span_classes(attrs)}>"

    return _TAG_RE.sub(repl, html)


def _sanitize_without_bleach(text: str) -> str:
    if "<" not in text:
        return text

    def repl(match: re.Match[str]) -> str:
        closing, tag, attrs = match.group(1), match.group(2).lower(), match.group(3)
        if tag not in _ALLOWED_TAGS:
            return ""
        if closing:
            return f"</{tag}>"
        if tag == "span":
            return f"<span{_filter_span_classes(attrs)}>"
        return f"<{tag}>"

    cleaned = _TAG_RE.sub(repl, text)
    return cleaned.strip()


def sanitize_rich_text_comment(value: object) -> str | None:
    cleaned = sanitize_rich_text_html(value)
    if not _strip_tags(cleaned).strip():
        return None
    return cleaned or None


def is_rich_text_comment_field(field_name: str) -> bool:
    return field_name in RICH_TEXT_COMMENT_FIELDS
