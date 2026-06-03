"""Office run-details review: lean loads, review list, and per-stop change detail."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.db_models import (
    MonthlyRouteLocation,
    MonthlyRouteRun,
    MonthlyRouteTestHistory,
    MonthlyRouteWorksheetAuditEvent,
    db,
)
from app.monthly.worksheet_stops import (
    RUN_DETAILS_EXCLUDED_AUDIT_FIELDS,
    RUN_DETAILS_OFFICE_ONLY_AUDIT_FIELDS,
    RUN_DETAILS_OFFICE_PREP_AUDIT_SOURCES,
    _is_annual_for_month,
    _normalize_text,
    _run_details_counts_from_stops,
    _worksheet_stop_portal_outcome,
    worksheet_stops_for_route_month,
)

PACIFIC_TZ = ZoneInfo("America/Vancouver")

_WORKSHEET_AUDIT_FIELD_CANONICAL: dict[str, str] = {
    "facp": "facp",
    "panel": "facp",
    "monitoring": "monitoring_notes",
    "monitoring_notes": "monitoring_notes",
}

_AUDIT_FIELD_DISPLAY_LABEL: dict[str, str] = {
    "ring": "Ring",
    "key_number": "Key #",
    "door_code": "Door code",
    "annual_month": "Annual",
    "panel": "Panel",
    "facp": "Panel",
    "panel_location": "Panel location",
    "monitoring_company": "Company",
    "monitoring_notes": "Notes",
    "monitoring": "Notes",
    "building_name": "Building",
    "property_management_company": "PMC",
    "testing_procedures": "Testing procedures",
    "inspection_tech_notes": "Location comments",
    "run_comments": "Job comment",
}

_CHANGE_LABEL_ORDER: tuple[str, ...] = (
    "Building",
    "PMC",
    "Ring",
    "Key #",
    "Door code",
    "Annual",
    "Panel",
    "Panel location",
    "Company",
    "Notes",
    "Testing procedures",
    "Location comments",
    "Job comment",
    "Result",
)


def _run_details_excluded_audit_field_names() -> frozenset[str]:
    return RUN_DETAILS_EXCLUDED_AUDIT_FIELDS | RUN_DETAILS_OFFICE_ONLY_AUDIT_FIELDS


def _run_for_route_month(route_id: int, month_first: date) -> MonthlyRouteRun | None:
    return MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()


def _run_details_audit_events_query(
    route_id: int,
    month_first: date,
    *,
    run: MonthlyRouteRun | None = None,
    location_id: int | None = None,
):
    excluded_fields = _run_details_excluded_audit_field_names()
    q = MonthlyRouteWorksheetAuditEvent.query.filter(
        MonthlyRouteWorksheetAuditEvent.monthly_route_id == route_id,
        MonthlyRouteWorksheetAuditEvent.month_date == month_first,
        MonthlyRouteWorksheetAuditEvent.field_name.notin_(excluded_fields),
        MonthlyRouteWorksheetAuditEvent.source.notin_(RUN_DETAILS_OFFICE_PREP_AUDIT_SOURCES),
    )
    if location_id is not None:
        q = q.filter(MonthlyRouteWorksheetAuditEvent.location_id == int(location_id))
    if run is not None and run.started_at is not None:
        q = q.filter(MonthlyRouteWorksheetAuditEvent.changed_at >= run.started_at)
    return q


def run_details_audit_location_ids(
    route_id: int,
    month_first: date,
    *,
    run: MonthlyRouteRun | None = None,
) -> set[int]:
    if run is None:
        run = _run_for_route_month(route_id, month_first)
    rows = (
        _run_details_audit_events_query(route_id, month_first, run=run)
        .with_entities(MonthlyRouteWorksheetAuditEvent.location_id)
        .distinct()
        .all()
    )
    return {int(r[0]) for r in rows}


def _location_display_label(loc: MonthlyRouteLocation | None, location_id: int) -> str:
    if loc is None:
        return f"Location {location_id}"
    from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy
    from app.monthly.testing_site_display import location_row_display_labels

    ts_rows = sync_testing_sites_from_legacy(loc) if loc is not None else []
    title, _labels = location_row_display_labels(loc, ts_rows)
    return title or f"Location {location_id}"


def collapse_worksheet_audit_changes_for_display(
    changes: list[dict[str, object]],
) -> list[dict[str, object]]:
    if not changes:
        return []
    ordered = sorted(
        changes,
        key=lambda c: c.get("changed_at") or datetime.min.replace(tzinfo=PACIFIC_TZ),
    )
    merged: dict[str, dict[str, object]] = {}
    for change in ordered:
        raw_name = str(change["field_name"])
        key = _WORKSHEET_AUDIT_FIELD_CANONICAL.get(raw_name, raw_name)
        if key not in merged:
            merged[key] = {
                "field_name": raw_name,
                "old_value": change["old_value"],
                "new_value": change["new_value"],
            }
        else:
            merged[key]["new_value"] = change["new_value"]
    return list(merged.values())


def _field_changes_for_location(
    route_id: int,
    month_first: date,
    location_id: int,
    *,
    run: MonthlyRouteRun | None = None,
) -> list[dict[str, object]]:
    by_loc = _field_changes_by_location(
        route_id,
        month_first,
        [int(location_id)],
        run=run,
    )
    return by_loc.get(int(location_id), [])


def _field_changes_by_location(
    route_id: int,
    month_first: date,
    location_ids: list[int],
    *,
    run: MonthlyRouteRun | None = None,
) -> dict[int, list[dict[str, object]]]:
    if not location_ids:
        return {}
    if run is None:
        run = _run_for_route_month(route_id, month_first)
    rows = (
        _run_details_audit_events_query(route_id, month_first, run=run)
        .filter(MonthlyRouteWorksheetAuditEvent.location_id.in_([int(i) for i in location_ids]))
        .order_by(MonthlyRouteWorksheetAuditEvent.changed_at.desc())
        .all()
    )
    raw_by_loc: dict[int, list[dict[str, object]]] = {}
    for event in rows:
        lid = int(event.location_id)
        raw_by_loc.setdefault(lid, []).append(
            {
                "field_name": event.field_name,
                "old_value": event.old_value,
                "new_value": event.new_value,
                "changed_at": event.changed_at,
            }
        )
    return {
        lid: collapse_worksheet_audit_changes_for_display(raw)
        for lid, raw in raw_by_loc.items()
    }


def _format_audit_value(value: object) -> str:
    if value is None:
        return "—"
    if isinstance(value, str):
        s = value.strip()
        return s or "—"
    if isinstance(value, (int, float, bool)):
        return str(value)
    return str(value)


def _is_empty_display_value(value: str) -> bool:
    return value == "—" or not value.strip()


def _audit_field_display_label(field_name: str) -> str:
    return _AUDIT_FIELD_DISPLAY_LABEL.get(field_name, field_name.replace("_", " "))


def _change_sort_index(label: str) -> int:
    try:
        return _CHANGE_LABEL_ORDER.index(label)
    except ValueError:
        return len(_CHANGE_LABEL_ORDER)


def _office_stop_status(stop: dict[str, object], month_first: date) -> str:
    rs = (str(stop.get("result_status") or "")).strip().lower()
    if rs == "tested":
        return "tested"
    if rs == "skipped":
        skip_reason = (str(stop.get("skip_reason") or "")).strip().lower()
        if skip_reason in {"annual", "annual_booked"}:
            return "annual"
        if _is_annual_for_month(month_first, stop.get("annual_month")):
            return "annual"
        return "skipped"
    if _is_annual_for_month(month_first, stop.get("annual_month")):
        return "annual"
    return "pending"


def _office_stop_status_label(status: str) -> str:
    if status == "tested":
        return "Tested"
    if status == "skipped":
        return "Skipped"
    if status == "annual":
        return "Annual"
    return "Pending"


def _stop_has_run_comments(stop: dict[str, object]) -> bool:
    return _normalize_text(stop.get("run_comments")) is not None


def _stop_has_outcome_only_review(stop: dict[str, object], month_first: date) -> bool:
    outcome = _worksheet_stop_portal_outcome(stop)
    if outcome in {"all_good", "passed_with_problems", "failed"}:
        return True
    if not outcome and _office_stop_status(stop, month_first) == "tested":
        return True
    return False


def _is_notable_stop(
    stop: dict[str, object],
    month_first: date,
    audit_loc_ids: set[int],
) -> bool:
    lid = int(stop["location_id"])
    rs = (str(stop.get("result_status") or "")).strip().lower()
    has_run_comments = _stop_has_run_comments(stop)
    is_annual_month = _is_annual_for_month(month_first, stop.get("annual_month"))
    has_outcome = _normalize_text(stop.get("test_outcome")) is not None
    has_updates = lid in audit_loc_ids or rs == "skipped" or has_run_comments
    return bool(has_updates or rs == "tested" or is_annual_month or has_outcome)


def _lean_stops_for_route_month(route_id: int, month_first: date) -> list[dict[str, object]]:
    stops = worksheet_stops_for_route_month(
        route_id,
        month_first,
        include_portal_extras=False,
    )
    if stops:
        return stops
    from app.monthly.worksheet_stops import portal_worksheet_preview_stops

    return portal_worksheet_preview_stops(route_id, month_first)


def _notable_lean_stops(
    route_id: int,
    month_first: date,
    audit_loc_ids: set[int] | None = None,
) -> list[dict[str, object]]:
    if audit_loc_ids is None:
        audit_loc_ids = run_details_audit_location_ids(route_id, month_first)
    return [
        dict(stop)
        for stop in _lean_stops_for_route_month(route_id, month_first)
        if _is_notable_stop(stop, month_first, audit_loc_ids)
    ]


def _billing_locations_from_notable_stops(
    notable: list[dict[str, object]],
    month_first: date,
) -> list[dict[str, object]]:
    if not notable:
        return []
    loc_ids = sorted({int(s["location_id"]) for s in notable})
    loc_by_id = {
        int(loc.id): loc
        for loc in MonthlyRouteLocation.query.filter(MonthlyRouteLocation.id.in_(loc_ids)).all()
    }
    hist_by_loc = {
        int(h.location_id): h
        for h in MonthlyRouteTestHistory.query.filter(
            MonthlyRouteTestHistory.location_id.in_(loc_ids),
            MonthlyRouteTestHistory.month_date == month_first,
        ).all()
    }
    out: list[dict[str, object]] = []
    for lid in loc_ids:
        loc = loc_by_id.get(lid)
        hist = hist_by_loc.get(lid)
        billing = _normalize_text(hist.billing_status) if hist is not None else None
        out.append(
            {
                "location_id": lid,
                "location_label": _location_display_label(loc, lid),
                "billing_status": billing,
            }
        )
    out.sort(key=lambda row: (str(row["location_label"]).casefold(), int(row["location_id"])))
    return out


def run_details_base_payload_extras(
    route_id: int,
    month_first: date,
    *,
    run: MonthlyRouteRun | None = None,
) -> tuple[
    dict[str, int],
    list[dict[str, object]],
    dict[str, int],
    list[dict[str, object]],
    dict[str, int],
]:
    """Single lean stop load for counts, billing, locations, and review summary."""
    if run is None:
        run = _run_for_route_month(route_id, month_first)
    lean_stops = _lean_stops_for_route_month(route_id, month_first)
    counts = _run_details_counts_from_stops(lean_stops)
    locations, review_summary = run_details_locations_payload(
        route_id, month_first, all_stops=lean_stops, run=run
    )
    billing = [
        {
            "location_id": int(loc["location_id"]),
            "location_label": loc["location_label"],
            "billing_status": loc.get("billing_status"),
        }
        for loc in locations
    ]
    return (
        counts,
        billing,
        {"stop_count": int(review_summary.get("stop_count") or 0)},
        locations,
        review_summary,
    )


def run_details_counts_from_stop_months(route_id: int, month_first: date) -> dict[str, int]:
    counts, _billing, _meta, _locations, _summary = run_details_base_payload_extras(
        route_id, month_first
    )
    return counts


def run_details_review_meta(route_id: int, month_first: date) -> dict[str, int]:
    _counts, _billing, meta, _locations, _summary = run_details_base_payload_extras(
        route_id, month_first
    )
    return meta


def run_details_billing_locations(
    route_id: int,
    month_first: date,
) -> list[dict[str, object]]:
    _counts, billing, _meta, _locations, _summary = run_details_base_payload_extras(
        route_id, month_first
    )
    return billing


def _review_kind(
    stop: dict[str, object],
    month_first: date,
    audit_loc_ids: set[int],
) -> str:
    lid = int(stop["location_id"])
    has_field_edits = lid in audit_loc_ids
    has_status_or_comment = (
        _office_stop_status(stop, month_first) in {"skipped", "annual"}
        or _stop_has_run_comments(stop)
    )
    if not has_field_edits and not has_status_or_comment and _stop_has_outcome_only_review(stop, month_first):
        return "tested_only"
    return "with_changes"


def _serialize_review_stop_summary(
    stop: dict[str, object],
    month_first: date,
    audit_loc_ids: set[int],
) -> dict[str, object]:
    lid = int(stop["location_id"])
    return {
        "testing_site_id": int(stop["testing_site_id"]),
        "location_id": lid,
        "stop_number": int(stop["stop_number"]),
        "display_address": stop.get("display_address"),
        "label": stop.get("label"),
        "primary_label": stop.get("primary_label"),
        "billing_address_subline": stop.get("billing_address_subline"),
        "month_date": stop.get("month_date") or month_first.isoformat(),
        "result_status": stop.get("result_status"),
        "test_outcome": stop.get("test_outcome"),
        "skip_reason": stop.get("skip_reason"),
        "skip_category": stop.get("skip_category"),
        "skip_note": stop.get("skip_note"),
        "annual_month": stop.get("annual_month"),
        "run_comments": stop.get("run_comments"),
        "confirmed_no_deficiencies": bool(stop.get("confirmed_no_deficiencies"))
        and not _stop_has_any_open_deficiencies(int(stop["testing_site_id"])),
        "billing_status": stop.get("billing_status"),
        "has_field_edits": lid in audit_loc_ids,
        "review_kind": _review_kind(stop, month_first, audit_loc_ids),
    }


def _summarize_review_stops(
    summaries: list[dict[str, object]],
    month_first: date,
) -> dict[str, int]:
    outcome_only = 0
    all_good = 0
    passed_with_problems = 0
    failed = 0
    skipped = 0
    updated = 0
    for item in summaries:
        stop = item
        if item.get("review_kind") == "tested_only":
            outcome_only += 1
        if item.get("has_field_edits"):
            updated += 1
        outcome = _worksheet_stop_portal_outcome(stop)
        status = _office_stop_status(stop, month_first)
        if outcome == "all_good" or (not outcome and status == "tested"):
            all_good += 1
        elif outcome == "passed_with_problems":
            passed_with_problems += 1
        elif outcome == "failed":
            failed += 1
        elif outcome == "skipped" or status in {"skipped", "annual"}:
            skipped += 1
    return {
        "stop_count": len(summaries),
        "outcome_only_count": outcome_only,
        "all_good_count": all_good,
        "passed_with_problems_count": passed_with_problems,
        "failed_count": failed,
        "skipped_count": skipped,
        "updated_count": updated,
    }


def run_details_review_payload(route_id: int, month_first: date) -> dict[str, object]:
    run = _run_for_route_month(route_id, month_first)
    audit_loc_ids = run_details_audit_location_ids(route_id, month_first, run=run)
    notable = _notable_lean_stops(route_id, month_first, audit_loc_ids)
    notable.sort(
        key=lambda s: (
            int(s.get("stop_number") or 10**9),
            int(s["location_id"]),
            int(s["testing_site_id"]),
        )
    )
    stops = [_serialize_review_stop_summary(s, month_first, audit_loc_ids) for s in notable]
    return {
        "stops": stops,
        "summary": _summarize_review_stops(stops, month_first),
    }


def _worksheet_skip_reason_display_block(skip_reason: object) -> str | None:
    s = _normalize_text(skip_reason)
    return s


def _build_stop_change_items(
    stop: dict[str, object],
    month_first: date,
    field_changes: list[dict[str, object]],
) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    seen_labels: set[str] = set()
    for change in field_changes:
        label = _audit_field_display_label(str(change["field_name"]))
        if label in seen_labels:
            continue
        seen_labels.add(label)
        before = _format_audit_value(change.get("old_value"))
        after = _format_audit_value(change.get("new_value"))
        empty_before = _is_empty_display_value(before)
        empty_after = _is_empty_display_value(after)
        kind = "field"
        if not empty_before and empty_after:
            kind = "field_removed"
        elif empty_before and not empty_after:
            kind = "field_added"
        items.append(
            {
                "id": f"field:{label}",
                "kind": kind,
                "label": label,
                "before": before,
                "after": after,
            }
        )

    status = _office_stop_status(stop, month_first)
    if status in {"skipped", "annual"}:
        skip_block = _worksheet_skip_reason_display_block(stop.get("skip_reason"))
        after = _office_stop_status_label(status)
        if skip_block and skip_block != "—":
            after = f"{after} · {skip_block}"
        items.append(
            {
                "id": "status",
                "kind": "status",
                "label": "Result",
                "before": None,
                "after": after,
            }
        )

    has_run_comments_audit = any(c.get("field_name") == "run_comments" for c in field_changes)
    if not has_run_comments_audit and _stop_has_run_comments(stop):
        items.append(
            {
                "id": "comment-added",
                "kind": "comment_added",
                "label": "Job comment",
                "before": None,
                "after": _format_audit_value(stop.get("run_comments")),
            }
        )

    items.sort(key=lambda c: (_change_sort_index(str(c["label"])), str(c["label"])))
    return [c for c in items if c.get("id") != "status"]


_NEW_COMMENT_LABEL_TO_FIELD: dict[str, str] = {
    "Job comment": "run_comments",
    "Location comments": "inspection_tech_notes",
    "Testing procedures": "testing_procedures",
}


def _new_comment_fields_for_stop(
    stop: dict[str, object],
    month_first: date,
    route_id: int,
    *,
    run: MonthlyRouteRun | None = None,
    field_changes: list[dict[str, object]] | None = None,
) -> list[str]:
    """Comment fields newly added on this field run (for office review red highlight)."""
    if run is None or run.started_at is None:
        return []
    if field_changes is None:
        field_changes = _field_changes_for_location(
            route_id,
            month_first,
            int(stop["location_id"]),
            run=run,
        )
    return _new_comment_fields_from_changes(stop, month_first, field_changes)


def _new_comment_fields_from_changes(
    stop: dict[str, object],
    month_first: date,
    field_changes: list[dict[str, object]],
) -> list[str]:
    changes = _build_stop_change_items(stop, month_first, field_changes)
    fields: list[str] = []
    seen: set[str] = set()
    for item in changes:
        label = str(item.get("label") or "")
        field_key = _NEW_COMMENT_LABEL_TO_FIELD.get(label)
        if not field_key or field_key in seen:
            continue
        kind = str(item.get("kind") or "")
        if kind in {"comment_added", "field_added"}:
            seen.add(field_key)
            fields.append(field_key)
            continue
        if kind == "field":
            before = item.get("before")
            after = item.get("after")
            empty_before = before is None or _is_empty_display_value(str(before))
            empty_after = after is None or _is_empty_display_value(str(after))
            if empty_before and not empty_after:
                seen.add(field_key)
                fields.append(field_key)
    return fields


def _deficiency_summaries_for_stop(
    testing_site_id: int,
    *,
    run: MonthlyRouteRun | None = None,
) -> list[dict[str, object]]:
    from app.monthly.portal_workflow import (
        list_deficiencies_for_run_review,
        list_deficiencies_for_site,
    )

    if run is not None and run.started_at is not None:
        return list_deficiencies_for_run_review(int(testing_site_id), run)
    return list_deficiencies_for_site(int(testing_site_id))


def _stop_has_active_deficiencies(
    stop: dict[str, object],
    *,
    run: MonthlyRouteRun | None = None,
) -> bool:
    return len(_deficiency_summaries_for_stop(int(stop["testing_site_id"]), run=run)) > 0


def _stop_has_any_open_deficiencies(testing_site_id: int) -> bool:
    from app.monthly.portal_workflow import list_deficiencies_for_site

    return len(list_deficiencies_for_site(int(testing_site_id))) > 0


def _stop_needs_attention(
    stop: dict[str, object],
    month_first: date,
    *,
    billing_unset: bool,
    run: MonthlyRouteRun | None = None,
) -> bool:
    if billing_unset:
        return True
    if _stop_has_any_open_deficiencies(int(stop["testing_site_id"])):
        return True
    outcome = _worksheet_stop_portal_outcome(stop)
    if outcome in {"failed", "passed_with_problems"}:
        return True
    status = _office_stop_status(stop, month_first)
    if status == "skipped":
        return True
    return False


def _serialize_location_stop(
    stop: dict[str, object],
    month_first: date,
    audit_loc_ids: set[int],
    route_id: int,
    *,
    run: MonthlyRouteRun | None = None,
    deficiencies_by_site: dict[int, list[dict[str, object]]] | None = None,
    field_changes_by_loc: dict[int, list[dict[str, object]]] | None = None,
) -> dict[str, object]:
    lid = int(stop["location_id"])
    tid = int(stop["testing_site_id"])
    if deficiencies_by_site is not None:
        deficiencies = deficiencies_by_site.get(tid, [])
    else:
        deficiencies = _deficiency_summaries_for_stop(tid, run=run)
    if field_changes_by_loc is not None:
        new_comment_fields = _new_comment_fields_for_stop(
            stop,
            month_first,
            route_id,
            run=run,
            field_changes=field_changes_by_loc.get(lid, []),
        )
    else:
        new_comment_fields = _new_comment_fields_for_stop(
            stop, month_first, route_id, run=run
        )
    return {
        "testing_site_id": int(stop["testing_site_id"]),
        "location_id": lid,
        "stop_number": int(stop.get("stop_number") or 0),
        "display_address": stop.get("display_address"),
        "label": stop.get("label"),
        "primary_label": stop.get("primary_label"),
        "billing_address_subline": stop.get("billing_address_subline"),
        "month_date": stop.get("month_date") or month_first.isoformat(),
        "result_status": stop.get("result_status"),
        "test_outcome": stop.get("test_outcome"),
        "skip_reason": stop.get("skip_reason"),
        "skip_category": stop.get("skip_category"),
        "skip_note": stop.get("skip_note"),
        "annual_month": stop.get("annual_month"),
        "ring": stop.get("ring"),
        "key_number": stop.get("key_number"),
        "door_code": stop.get("door_code"),
        "monitoring_company": stop.get("monitoring_company"),
        "monitoring_company_id": stop.get("monitoring_company_id"),
        "monitoring_account_number": stop.get("monitoring_account_number"),
        "monitoring_notes": stop.get("monitoring_notes"),
        "monitoring_company_record": stop.get("monitoring_company_record"),
        "run_comments": stop.get("run_comments"),
        "office_job_comment": stop.get("office_job_comment"),
        "office_attention": bool(stop.get("office_attention")),
        "prior_month_out_of_order": bool(stop.get("prior_month_out_of_order")),
        "prior_month_tested_after_address": (
            str(stop["prior_month_tested_after_address"]).strip()
            if stop.get("prior_month_tested_after_address")
            else None
        ),
        "prior_month_field_edits": bool(stop.get("prior_month_field_edits")),
        "prior_month_new_to_route": bool(stop.get("prior_month_new_to_route")),
        "testing_procedures": stop.get("testing_procedures"),
        "inspection_tech_notes": stop.get("inspection_tech_notes"),
        "confirmed_no_deficiencies": bool(stop.get("confirmed_no_deficiencies"))
        and len(deficiencies) == 0,
        "billing_status": stop.get("billing_status"),
        "has_field_edits": lid in audit_loc_ids,
        "review_kind": _review_kind(stop, month_first, audit_loc_ids),
        "deficiency_summaries": deficiencies,
        "has_active_deficiencies": len(deficiencies) > 0,
        "new_comment_fields": new_comment_fields,
    }


def _billing_status_for_location(
    location_id: int,
    month_first: date,
    hist_by_loc: dict[int, MonthlyRouteTestHistory],
) -> str | None:
    hist = hist_by_loc.get(int(location_id))
    return _normalize_text(hist.billing_status) if hist is not None else None


def _location_attention_flags(
    raw_stops: list[dict[str, object]],
    stop_payloads: list[dict[str, object]],
    month_first: date,
    audit_loc_ids: set[int],
    billing_status: str | None,
    *,
    run: MonthlyRouteRun | None = None,
    site_open_deficiencies: dict[int, bool] | None = None,
    open_tickets_by_loc: dict[int, int] | None = None,
) -> dict[str, bool]:
    lid = int(raw_stops[0]["location_id"]) if raw_stops else 0
    billing_norm = (billing_status or "").strip().lower()
    billing_unset = billing_norm in {"", "unset"} or billing_status is None
    has_field_edits = lid in audit_loc_ids
    has_active_deficiencies = any(s.get("has_active_deficiencies") for s in stop_payloads)
    if site_open_deficiencies is not None:
        has_any_open_deficiencies = any(
            site_open_deficiencies.get(int(s["testing_site_id"]), False) for s in raw_stops
        )
    else:
        has_any_open_deficiencies = any(
            _stop_has_any_open_deficiencies(int(s["testing_site_id"])) for s in raw_stops
        )
    has_job_comment = any(_stop_has_run_comments(s) for s in raw_stops)
    has_office_job_comment = any(
        _normalize_text(s.get("office_job_comment")) is not None for s in raw_stops
    )
    if open_tickets_by_loc is not None:
        open_tickets = int(open_tickets_by_loc.get(lid, 0))
    else:
        from app.monthly.location_tickets import count_open_tickets_for_location

        open_tickets = count_open_tickets_for_location(lid)
    needs_attention = billing_unset or has_any_open_deficiencies or open_tickets > 0
    if not needs_attention:
        needs_attention = any(
            _stop_needs_attention(s, month_first, billing_unset=False, run=run) for s in raw_stops
        )
    return {
        "billing_unset": billing_unset,
        "has_field_edits": has_field_edits,
        "has_active_deficiencies": has_active_deficiencies,
        "has_job_comment": has_job_comment,
        "has_office_job_comment": has_office_job_comment,
        "open_tickets": open_tickets,
        "needs_attention": needs_attention,
    }


def run_details_locations_payload(
    route_id: int,
    month_first: date,
    *,
    all_stops: list[dict[str, object]] | None = None,
    run: MonthlyRouteRun | None = None,
) -> tuple[list[dict[str, object]], dict[str, int]]:
    """All worksheet stops grouped by location for unified run-details UI."""
    if run is None:
        run = _run_for_route_month(route_id, month_first)
    audit_loc_ids = run_details_audit_location_ids(route_id, month_first, run=run)
    if all_stops is None:
        all_stops = _lean_stops_for_route_month(route_id, month_first)
    if not all_stops:
        empty_summary = _summarize_review_stops([], month_first)
        return [], empty_summary

    from app.monthly.prep_insights import prior_month_field_edit_count_by_location
    from app.monthly.run_workflow import run_in_office_prep_phase

    prior_edit_locs: set[int] = set()
    if run_in_office_prep_phase(run):
        prior_edit_locs = set(
            prior_month_field_edit_count_by_location(route_id, month_first).keys()
        )

    if prior_edit_locs:
        enriched_stops: list[dict[str, object]] = []
        for stop in all_stops:
            s = dict(stop)
            lid = int(s["location_id"])
            s["prior_month_field_edits"] = lid in prior_edit_locs
            enriched_stops.append(s)
        all_stops = enriched_stops

    loc_ids = sorted({int(s["location_id"]) for s in all_stops})
    ts_ids = [int(s["testing_site_id"]) for s in all_stops]

    from app.monthly.location_tickets import count_open_tickets_by_location
    from app.monthly.portal_workflow import (
        batch_deficiency_summaries_for_testing_sites,
        batch_site_has_open_deficiencies,
    )

    deficiencies_by_site = batch_deficiency_summaries_for_testing_sites(ts_ids, run=run)
    site_open_deficiencies = batch_site_has_open_deficiencies(ts_ids)
    open_tickets_by_loc = count_open_tickets_by_location(loc_ids)
    field_changes_by_loc: dict[int, list[dict[str, object]]] = {}
    if run is not None and run.started_at is not None:
        field_changes_by_loc = _field_changes_by_location(
            route_id,
            month_first,
            loc_ids,
            run=run,
        )
    loc_by_id = {
        int(loc.id): loc
        for loc in MonthlyRouteLocation.query.filter(MonthlyRouteLocation.id.in_(loc_ids)).all()
    }
    hist_by_loc = {
        int(h.location_id): h
        for h in MonthlyRouteTestHistory.query.filter(
            MonthlyRouteTestHistory.location_id.in_(loc_ids),
            MonthlyRouteTestHistory.month_date == month_first,
        ).all()
    }

    by_location: dict[int, list[dict[str, object]]] = {}
    for stop in all_stops:
        lid = int(stop["location_id"])
        by_location.setdefault(lid, []).append(dict(stop))

    locations: list[dict[str, object]] = []
    all_summaries: list[dict[str, object]] = []

    for lid in loc_ids:
        raw_stops = by_location.get(lid, [])
        raw_stops.sort(
            key=lambda s: (
                int(s.get("stop_number") or 10**9),
                int(s["testing_site_id"]),
            )
        )
        stop_payloads = [
            _serialize_location_stop(
                s,
                month_first,
                audit_loc_ids,
                route_id,
                run=run,
                deficiencies_by_site=deficiencies_by_site,
                field_changes_by_loc=field_changes_by_loc,
            )
            for s in raw_stops
        ]
        all_summaries.extend(stop_payloads)
        stop_numbers = [int(s["stop_number"]) for s in stop_payloads if s.get("stop_number")]
        first_stop = min(stop_numbers) if stop_numbers else 0
        last_stop = max(stop_numbers) if stop_numbers else 0
        billing = _billing_status_for_location(lid, month_first, hist_by_loc)
        locations.append(
            {
                "location_id": lid,
                "location_label": _location_display_label(loc_by_id.get(lid), lid),
                "billing_status": billing,
                "first_stop_number": first_stop,
                "last_stop_number": last_stop,
                "attention_flags": _location_attention_flags(
                    raw_stops,
                    stop_payloads,
                    month_first,
                    audit_loc_ids,
                    billing,
                    run=run,
                    site_open_deficiencies=site_open_deficiencies,
                    open_tickets_by_loc=open_tickets_by_loc,
                ),
                "stops": stop_payloads,
            }
        )

    locations.sort(
        key=lambda row: (
            int(row.get("first_stop_number") or 10**9),
            str(row["location_label"]).casefold(),
            int(row["location_id"]),
        )
    )
    return locations, _summarize_review_stops(all_summaries, month_first)


def run_details_stop_review_detail(
    route_id: int,
    month_first: date,
    testing_site_id: int,
) -> dict[str, object] | None:
    run = _run_for_route_month(route_id, month_first)
    all_stops = _lean_stops_for_route_month(route_id, month_first)
    stop = next((s for s in all_stops if int(s["testing_site_id"]) == int(testing_site_id)), None)
    if stop is None:
        return None
    lid = int(stop["location_id"])
    field_changes = _field_changes_for_location(route_id, month_first, lid, run=run)
    changes = _build_stop_change_items(stop, month_first, field_changes)
    return {
        "testing_site_id": int(testing_site_id),
        "location_id": lid,
        "changes": changes,
    }


def run_details_worksheet_stop(
    route_id: int,
    month_first: date,
    testing_site_id: int,
) -> dict[str, object] | None:
    """Full worksheet stop payload for the run-details site modal (one stop, portal extras)."""
    from app.db_models import MonthlyRouteRun
    from app.monthly.worksheet_stops import (
        load_stop_for_patch,
        serialize_worksheet_stop,
        worksheet_stop_number_for_site,
        _testing_sites_for_location,
    )
    from app.monthly.testing_site_display import testing_site_index_and_count

    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    mtsm, ts, loc = load_stop_for_patch(route_id, testing_site_id, month_first)
    if ts is None or loc is None:
        return None
    stop_number = worksheet_stop_number_for_site(route_id, month_first, testing_site_id)
    ts_rows = _testing_sites_for_location(loc)
    site_index, site_count = testing_site_index_and_count(ts_rows, ts)
    return serialize_worksheet_stop(
        ts,
        loc,
        mtsm,
        route_id=route_id,
        month_first=month_first,
        stop_number=stop_number,
        run=run,
        include_portal_extras=True,
        site_count=site_count,
        site_index=site_index,
    )
