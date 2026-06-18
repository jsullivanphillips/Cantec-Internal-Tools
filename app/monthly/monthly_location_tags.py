"""Free-form tags on monthly library locations."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Query

from app.db_models import MonthlyLocation, db

MAX_MONTHLY_LOCATION_TAGS = 32
MAX_MONTHLY_LOCATION_TAG_LENGTH = 32


def normalize_monthly_location_tags(raw_tags: object) -> list[str]:
    if raw_tags is None:
        return []
    if not isinstance(raw_tags, list):
        raise ValueError("invalid_tags")
    seen: set[str] = set()
    out: list[str] = []
    for item in raw_tags:
        if not isinstance(item, str):
            raise ValueError("invalid_tags")
        tag = item.strip()
        if not tag:
            continue
        if len(tag) > MAX_MONTHLY_LOCATION_TAG_LENGTH:
            raise ValueError("tag_too_long")
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(tag)
        if len(out) > MAX_MONTHLY_LOCATION_TAGS:
            raise ValueError("too_many_tags")
    return out


def tags_from_location(loc: MonthlyLocation) -> list[str]:
    raw = loc.tags_json
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item) for item in raw if str(item).strip()]
    return []


def set_location_tags(loc: MonthlyLocation, tags: list[str]) -> None:
    loc.tags_json = tags if tags else None


def parse_library_tag_filter(raw: object) -> str | None:
    if raw is None:
        return None
    tag = str(raw).strip()
    return tag or None


def parse_library_tag_filter_list(values: object) -> list[str]:
    """Normalize repeated tag query params (case-insensitive dedupe, stable sort)."""
    if values is None:
        return []
    raw_items = values if isinstance(values, list) else [values]
    seen: dict[str, str] = {}
    for raw in raw_items:
        tag = parse_library_tag_filter(raw)
        if not tag:
            continue
        seen.setdefault(tag.casefold(), tag)
    return sorted(seen.values(), key=str.casefold)


def location_has_tag(loc: MonthlyLocation, tag: str) -> bool:
    needle = tag.strip().casefold()
    if not needle:
        return False
    return any(item.strip().casefold() == needle for item in tags_from_location(loc))


def _postgres_tags_array_sql() -> str:
    """Coerce tags_json to a JSON array (scalars/objects become empty)."""
    return (
        "CASE jsonb_typeof(COALESCE(monthly_location.tags_json::jsonb, '[]'::jsonb))"
        " WHEN 'array' THEN COALESCE(monthly_location.tags_json::jsonb, '[]'::jsonb)"
        " ELSE '[]'::jsonb"
        " END"
    )


def _sqlite_tags_array_sql() -> str:
    return (
        "CASE json_type(COALESCE(monthly_location.tags_json, '[]'))"
        " WHEN 'array' THEN COALESCE(monthly_location.tags_json, '[]')"
        " ELSE '[]'"
        " END"
    )


def _tag_exists_sql(*, negate: bool, param_name: str) -> text:
    dialect = db.session.get_bind().dialect.name
    keyword = "NOT EXISTS" if negate else "EXISTS"
    if dialect == "postgresql":
        tags_array = _postgres_tags_array_sql()
        return text(
            f"{keyword} ("
            " SELECT 1"
            f" FROM jsonb_array_elements_text({tags_array}) AS tag_row(tag)"
            f" WHERE lower(tag_row.tag) = lower(:{param_name})"
            ")"
        )
    tags_array = _sqlite_tags_array_sql()
    return text(
        f"{keyword} ("
        " SELECT 1"
        f" FROM json_each({tags_array}) AS tag_row"
        f" WHERE lower(tag_row.value) = lower(:{param_name})"
        ")"
    )


def apply_library_tag_filters(
    query: Query,
    *,
    include_tags: list[str] | None = None,
    exclude_tags: list[str] | None = None,
) -> Query:
    includes = include_tags or []
    excludes = exclude_tags or []
    if includes:
        from sqlalchemy import or_

        include_clauses = []
        for index, tag in enumerate(includes):
            param_name = f"include_tag_value_{index}"
            include_clauses.append(
                _tag_exists_sql(negate=False, param_name=param_name).bindparams(
                    **{param_name: tag}
                )
            )
        query = query.filter(or_(*include_clauses))
    for index, tag in enumerate(excludes):
        param_name = f"exclude_tag_value_{index}"
        query = query.filter(
            _tag_exists_sql(negate=True, param_name=param_name).bindparams(**{param_name: tag})
        )
    return query


def distinct_location_tags() -> list[str]:
    """Sorted unique tags across all library locations (preserves first-seen casing)."""
    rows = (
        MonthlyLocation.query.with_entities(MonthlyLocation.tags_json)
        .filter(MonthlyLocation.tags_json.isnot(None))
        .all()
    )
    seen: dict[str, str] = {}
    for (raw,) in rows:
        if not isinstance(raw, list):
            continue
        for item in raw:
            tag = str(item).strip()
            if not tag:
                continue
            key = tag.casefold()
            seen.setdefault(key, tag)
    return sorted(seen.values(), key=str.casefold)
