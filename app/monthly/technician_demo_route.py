"""Live training route (default R99) for technician portal demos with real sync."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from app.db_models import (
    MonthlyLocation,
    MonthlyLocationDeficiency,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteRun,
    MonthlyStopClockEvent,
    db,
)
from app.monthly.run_workflow import clear_field_ended, clear_office_completion
from app.monthly.worksheet_locations import (
    _next_sqlite_bigint_id,
    ensure_worksheet_stops_for_route_month,
)

DEMO_ROUTE_NUMBER_ENV = "TECHNICIAN_DEMO_ROUTE_NUMBER"
DEFAULT_DEMO_ROUTE_NUMBER = 99

# Whitelisted tables whose PK sequences may drift after manual imports.
_POSTGRES_SEQUENCE_TABLES = (
    "monthly_route",
    "monthly_location",
    "monthly_route_run",
    "monthly_location_month",
    "monthly_stop_clock_event",
)

TRAINING_STEPS: list[str] = [
    "Pick a stop from the left nav and review panel, key, and monitoring info.",
    "Clock in when you arrive on site, then record results or skip with a reason.",
    "Watch the sync badge — changes save to the server and appear on office paperwork.",
    "Try airplane mode: edits queue locally, then drain when you reconnect.",
    "When class is done, tap Reset training data to restore the starting scenario.",
]


@dataclass(frozen=True)
class _DemoStopSpec:
    route_stop_order: int
    address: str
    label: str
    display_address: str
    latitude: float | None
    longitude: float | None
    ring_detail: str | None
    keys: str | None
    annual_month: str | None
    door_code: str | None
    panel: str | None
    panel_location: str | None
    monitoring_company_name: str | None
    monitoring_notes: str | None
    testing_procedures: str | None
    inspection_tech_notes: str | None
    run_comments: str | None
    baseline: dict[str, Any]


def _is_postgresql() -> bool:
    return "postgresql" in (str(db.engine.url) or "").lower()


def _sync_postgres_sequences() -> None:
    """Align serial/identity sequences with MAX(id) before seed inserts."""
    if not _is_postgresql():
        return
    for table in _POSTGRES_SEQUENCE_TABLES:
        db.session.execute(
            text(
                f"""
                SELECT setval(
                    pg_get_serial_sequence('{table}', 'id'),
                    GREATEST(COALESCE((SELECT MAX(id) FROM {table}), 1), 1),
                    (SELECT MAX(id) IS NOT NULL FROM {table})
                )
                WHERE pg_get_serial_sequence('{table}', 'id') IS NOT NULL
                """
            )
        )


def technician_demo_route_number() -> int:
    raw = (os.environ.get(DEMO_ROUTE_NUMBER_ENV) or "").strip()
    if not raw:
        return DEFAULT_DEMO_ROUTE_NUMBER
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_DEMO_ROUTE_NUMBER


def _demo_address_normalized(address: str) -> str:
    return f"[demo] {address}".casefold()


def _demo_stop_specs() -> list[_DemoStopSpec]:
    pending_baseline: dict[str, Any] = {"result_status": None, "test_outcome": None}
    return [
        _DemoStopSpec(
            route_stop_order=0,
            address="[DEMO] 1045 Pandora Ave",
            label="FACP — East stair",
            display_address="1045 Pandora Ave",
            latitude=48.4284,
            longitude=-123.3656,
            ring_detail="R-12",
            keys="KEY-4421",
            annual_month=None,
            door_code="4821#",
            panel="Simplex 4100ES",
            panel_location="Electrical room, P2 east",
            monitoring_company_name="Paladin Security",
            monitoring_notes="Acct #88421 · Signals: Fire, Trouble",
            testing_procedures=(
                "1. Notify monitoring\n2. Test 10% devices per floor\n3. Reset and verify panel clear"
            ),
            inspection_tech_notes="Last month: one smoke low battery in stair 3.",
            run_comments=None,
            baseline=pending_baseline,
        ),
        _DemoStopSpec(
            route_stop_order=1,
            address="[DEMO] 1045 Pandora Ave — Roof",
            label="FACP — Roof mechanical",
            display_address="1045 Pandora Ave",
            latitude=48.4284,
            longitude=-123.3656,
            ring_detail="R-12B",
            keys="KEY-4421",
            annual_month="May",
            door_code=None,
            panel="PACPRO P24A",
            panel_location="Roof penthouse, north wall",
            monitoring_company_name="Paladin Security",
            monitoring_notes=None,
            testing_procedures=(
                "Annual: full device test per NFPA 72. Document all out-of-service devices."
            ),
            inspection_tech_notes="",
            run_comments=None,
            baseline=pending_baseline,
        ),
        _DemoStopSpec(
            route_stop_order=2,
            address="[DEMO] 2200 Douglas St — Units 4-9",
            label="2200 Douglas St — Units 4-9",
            display_address="2200 Douglas St — Units 4-9",
            latitude=48.4289,
            longitude=-123.3659,
            ring_detail="R-3",
            keys="KEY-1188",
            annual_month=None,
            door_code="Front desk",
            panel="Fire-Lite MS-5UD",
            panel_location="Main floor lobby closet",
            monitoring_company_name="Securitas",
            monitoring_notes="Call ahead — front desk holds keys after 6pm",
            testing_procedures="Monthly: horns/strobes + 2 smokes per floor.",
            inspection_tech_notes="",
            run_comments=None,
            baseline=pending_baseline,
        ),
        _DemoStopSpec(
            route_stop_order=3,
            address="[DEMO] 891 Johnson St",
            label="FACP only",
            display_address="891 Johnson St",
            latitude=48.4268,
            longitude=-123.3677,
            ring_detail="R-8",
            keys="KEY-9002",
            annual_month=None,
            door_code=None,
            panel="Simplex 4010",
            panel_location="P1 ramp entrance",
            monitoring_company_name="—",
            monitoring_notes=None,
            testing_procedures="Skip annual devices. Visual panel check only.",
            inspection_tech_notes="Gate arm broken — use side pedestrian door.",
            run_comments=None,
            baseline=pending_baseline,
        ),
        _DemoStopSpec(
            route_stop_order=4,
            address="[DEMO] 1450 Government St",
            label="1450 Government St",
            display_address="1450 Government St",
            latitude=48.4198,
            longitude=-123.3692,
            ring_detail="R-1",
            keys="KEY-2200",
            annual_month=None,
            door_code="2510",
            panel="Edwards EST3",
            panel_location="Basement B1, room 12",
            monitoring_company_name="ADT Commercial",
            monitoring_notes=None,
            testing_procedures=(
                "Standard monthly test. Elevator recall test with on-site staff."
            ),
            inspection_tech_notes="",
            run_comments=None,
            baseline=pending_baseline,
        ),
    ]


def get_technician_demo_route() -> MonthlyRoute | None:
    rn = technician_demo_route_number()
    return MonthlyRoute.query.filter_by(route_number=rn).one_or_none()


def is_technician_demo_route(route: MonthlyRoute | None) -> bool:
    if route is None:
        return False
    return int(route.route_number) == technician_demo_route_number()


def _current_pacific_month_first() -> date:
    from zoneinfo import ZoneInfo

    now = datetime.now(ZoneInfo("America/Vancouver"))
    return date(now.year, now.month, 1)


def _upsert_demo_location(route_id: int, spec: _DemoStopSpec) -> MonthlyLocation:
    addr_norm = _demo_address_normalized(spec.address)
    label_norm = spec.label.casefold()
    loc = (
        MonthlyLocation.query.filter_by(
            monthly_route_id=route_id,
            route_stop_order=spec.route_stop_order,
        ).one_or_none()
    )
    if loc is None:
        loc = MonthlyLocation.query.filter_by(
            address_normalized=addr_norm,
            label_normalized=label_norm,
        ).one_or_none()
    fields = {
        "address": spec.address,
        "address_normalized": addr_norm,
        "label": spec.label,
        "label_normalized": label_norm,
        "display_address": spec.display_address,
        "latitude": spec.latitude,
        "longitude": spec.longitude,
        "monthly_route_id": route_id,
        "route_stop_order": spec.route_stop_order,
        "ring_detail": spec.ring_detail,
        "keys": spec.keys,
        "annual_month": spec.annual_month,
        "door_code": spec.door_code,
        "panel": spec.panel,
        "panel_location": spec.panel_location,
        "monitoring_notes": spec.monitoring_notes,
        "testing_procedures": spec.testing_procedures,
        "inspection_tech_notes": spec.inspection_tech_notes or None,
        "status_normalized": "active",
        "status_raw": "Active",
        "property_management_company_normalized": "",
    }
    if loc is None:
        loc = MonthlyLocation(**fields, **_sqlite_id_kwargs(MonthlyLocation))
        db.session.add(loc)
    else:
        for key, value in fields.items():
            setattr(loc, key, value)
    db.session.flush()
    return loc


def _sqlite_id_kwargs(model) -> dict[str, int]:
    next_id = _next_sqlite_bigint_id(model)
    return {"id": next_id} if next_id is not None else {}


def _upsert_demo_route() -> MonthlyRoute:
    rn = technician_demo_route_number()
    route = MonthlyRoute.query.filter_by(route_number=rn).one_or_none()
    if route is None:
        route = MonthlyRoute(
            route_number=rn,
            weekday_iso=0,
            week_occurrence=1,
            display_name="Training demo",
            technician_note="Demo note: stop 3 has an annual — allow extra time at the FACP.",
            **_sqlite_id_kwargs(MonthlyRoute),
        )
        db.session.add(route)
    else:
        route.display_name = "Training demo"
        route.technician_note = (
            "Demo note: stop 3 has an annual — allow extra time at the FACP."
        )
    db.session.flush()
    return route


def _upsert_demo_run(route_id: int, month_first: date, *, now: datetime) -> MonthlyRouteRun:
    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    started = now - timedelta(minutes=45)
    if run is None:
        run = MonthlyRouteRun(
            monthly_route_id=route_id,
            month_date=month_first,
            status="open",
            source="technician_app",
            opened_at=started,
            started_at=started,
            prepared_at=started,
            prepared_by="training_demo_seed",
            **_sqlite_id_kwargs(MonthlyRouteRun),
        )
        db.session.add(run)
    else:
        run.status = "open"
        run.source = "technician_app"
        if run.opened_at is None:
            run.opened_at = started
        if run.prepared_at is None:
            run.prepared_at = started
            run.prepared_by = "training_demo_seed"
        if run.started_at is None:
            run.started_at = started
        clear_field_ended(run)
        clear_office_completion(run)
        run.completed_at = None
    db.session.flush()
    return run


def _clear_mlm_workflow_state(row: MonthlyLocationMonth) -> None:
    for ev in row.clock_events.all():
        db.session.delete(ev)
    row.result_status = None
    row.test_outcome = None
    row.skip_category = None
    row.skip_reason = None
    row.skip_note = None
    row.sheet_time_in_raw = None
    row.sheet_time_out_raw = None
    row.confirmed_no_deficiencies = False


def _apply_baseline_to_mlm(
    row: MonthlyLocationMonth,
    spec: _DemoStopSpec,
) -> None:
    _clear_mlm_workflow_state(row)
    baseline = spec.baseline
    row.result_status = baseline.get("result_status")
    row.test_outcome = baseline.get("test_outcome")
    row.skip_category = baseline.get("skip_category")
    row.skip_reason = baseline.get("skip_reason")
    row.skip_note = baseline.get("skip_note")
    row.sheet_time_in_raw = baseline.get("sheet_time_in_raw")
    row.sheet_time_out_raw = baseline.get("sheet_time_out_raw")
    row.monitoring_company_name = spec.monitoring_company_name
    row.run_comments = spec.run_comments
    clock_specs = baseline.get("clock_events") or []
    for idx, clock in enumerate(clock_specs):
        db.session.add(
            MonthlyStopClockEvent(
                monthly_location_month_id=int(row.id),
                sort_order=idx,
                time_in_raw=str(clock["time_in_raw"]),
                time_out_raw=clock.get("time_out_raw"),
                created_by_tech_name="Training demo seed",
                **_sqlite_id_kwargs(MonthlyStopClockEvent),
            )
        )
    row.updated_at = datetime.now(timezone.utc)
    db.session.flush()


def _apply_baseline_month_state(
    route_id: int,
    month_first: date,
    specs: list[_DemoStopSpec],
) -> None:
    loc_by_order = {
        int(loc.route_stop_order): loc
        for loc in MonthlyLocation.query.filter_by(monthly_route_id=route_id).all()
        if loc.route_stop_order is not None
    }
    for spec in specs:
        loc = loc_by_order.get(spec.route_stop_order)
        if loc is None:
            continue
        row = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=int(loc.id),
            month_date=month_first,
        ).one_or_none()
        if row is None:
            continue
        _apply_baseline_to_mlm(row, spec)


def _clear_demo_deficiencies(route_id: int) -> None:
    loc_ids = [
        int(loc.id)
        for loc in MonthlyLocation.query.filter_by(monthly_route_id=route_id).all()
    ]
    if not loc_ids:
        return
    (
        MonthlyLocationDeficiency.query.filter(
            MonthlyLocationDeficiency.monthly_location_id.in_(loc_ids)
        ).delete(synchronize_session=False)
    )


def ensure_technician_demo_route() -> MonthlyRoute:
    """Idempotently create/update the training route, stops, run, and baseline month state."""
    _sync_postgres_sequences()
    now = datetime.now(timezone.utc)
    month_first = _current_pacific_month_first()
    specs = _demo_stop_specs()

    route = _upsert_demo_route()
    route_id = int(route.id)
    for spec in specs:
        _upsert_demo_location(route_id, spec)

    run = _upsert_demo_run(route_id, month_first, now=now)
    ensure_worksheet_stops_for_route_month(route_id, month_first, run)
    _apply_baseline_month_state(route_id, month_first, specs)
    db.session.commit()
    return route


def reset_technician_demo_route_month() -> MonthlyRouteRun | None:
    """Restore the current Pacific month on the training route to the baseline scenario."""
    _sync_postgres_sequences()
    route = get_technician_demo_route()
    if route is None:
        return None
    month_first = _current_pacific_month_first()
    route_id = int(route.id)
    specs = _demo_stop_specs()

    run = _upsert_demo_run(route_id, month_first, now=datetime.now(timezone.utc))
    ensure_worksheet_stops_for_route_month(route_id, month_first, run)
    _clear_demo_deficiencies(route_id)
    _apply_baseline_month_state(route_id, month_first, specs)
    db.session.commit()
    return run


def demo_route_seeded() -> bool:
    route = get_technician_demo_route()
    if route is None:
        return False
    stop_count = MonthlyLocation.query.filter_by(monthly_route_id=int(route.id)).count()
    return stop_count >= len(_demo_stop_specs())


def serialize_technician_demo_portal_payload() -> dict[str, object]:
    rn = technician_demo_route_number()
    month_first = _current_pacific_month_first()
    route = get_technician_demo_route()
    seeded = demo_route_seeded()
    route_payload: dict[str, object] | None = None
    office_paperwork_path: str | None = None
    if route is not None and seeded:
        stop_count = MonthlyLocation.query.filter_by(monthly_route_id=int(route.id)).count()
        wd_names = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
        wd = (
            wd_names[route.weekday_iso]
            if isinstance(route.weekday_iso, int) and 0 <= route.weekday_iso <= 6
            else "?"
        )
        occ = int(route.week_occurrence) if route.week_occurrence is not None else 0
        nth_suffix = "th"
        if not (11 <= (occ % 100) <= 13):
            nth_suffix = {1: "st", 2: "nd", 3: "rd"}.get(occ % 10, "th")
        nth = f"{occ}{nth_suffix}" if occ >= 1 else str(occ)
        route_payload = {
            "id": int(route.id),
            "route_number": int(route.route_number),
            "display_name": (route.display_name or "").strip() or None,
            "weekday_iso": route.weekday_iso,
            "week_occurrence": route.week_occurrence,
            "label": f"R{route.route_number} · {nth} {wd}",
            "location_count": int(stop_count),
        }
        office_paperwork_path = (
            f"/monthlies/routes/{int(route.id)}/paperwork?month={month_first.isoformat()}"
        )
    return {
        "configured": True,
        "route_number": rn,
        "seeded": seeded,
        "route": route_payload,
        "current_month_first": month_first.isoformat(),
        "office_paperwork_path": office_paperwork_path,
        "training_steps": TRAINING_STEPS,
        "seed_hint": (
            None
            if seeded
            else "Training route is not seeded yet. Ask office to run: "
            "python -m app.scripts.seed_technician_demo_route"
        ),
    }
