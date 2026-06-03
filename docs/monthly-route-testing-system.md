# Monthly Route Testing System — Reference

> **Purpose of this document:** Single reference for how Schedule Assist models, schedules, and records monthly fire-alarm bell testing. Last researched: May 2026.

---

## 1. Business context

Schedule Assist supports Cantec’s **monthly fire-alarm bell testing** operation. The domain mirrors legacy Excel workflows:

| Concept | Meaning |
|--------|---------|
| **Route** | Calendar slot for a run (e.g. route **7** = first **Wednesday** of the month) |
| **Location / site** | Real property: address + PMC + building, assigned to a route with stop order |
| **Run** | One route’s execution in a calendar month — the “run file” technicians complete |
| **Worksheet row** | Per-site outcome for that month: tested, skipped, times, FACP/ring/key snapshots, monitoring notes |
| **TEST DAY** | Excel token (e.g. `W1-R7`) encoding weekday, week-in-month, and route number |
| **Keys** | Barcode/keycode cells linked to canonical `keys` table |

**Users:**

- **Field technicians** — PIN-gated portal at `/tech` (no staff login). See `README.md` → Technician portal.
- **Office staff** — React SPA: library, route detail, map, specialists, worksheet management.

**External integration:** ServiceTrade — route-level pseudo-locations for clock-ins/specialists; site-level building locations when maintained.

---

## 2. Mental model

```
Excel TEST DAY + master sheet
        ↓
MonthlyRoute (calendar shell) ←── MonthlyRouteLocation (site library)
        ↓                                    ↓
MonthlyRouteRun (per month)          MonthlyRouteTestHistory (worksheet cell)
        ↓                                    ↓
Technician portal / staff worksheet APIs

V2 (in progress):
MonthlyRouteLocation ──1:1── MonthlySite ──1:N── MonthlyTestingSite (multi-stop, canonical keys)
MonthlyKeyBridge — survives location wipes
```

**Critical invariant:** `MonthlyRouteLocation.monthly_route_id` is the **current** route assignment. `MonthlyRouteTestHistory.test_monthly_route_id` is **historical truth** for that month (survives reassignment).

---

## 3. Data model

### 3.1 Legacy stack (production worksheet path)

| Model | Table | Role |
|--------|--------|------|
| `MonthlyRoute` | `monthly_route` | Route shell: `route_number`, `weekday_iso`, `week_occurrence`, optional ST route pseudo-location |
| `MonthlyRouteLocation` | `monthly_route_location` | Site library; unique normalized address/PMC/building; `test_day`, route FK, stop order, keys, `billing_comments` (office billing notes), inspection/monitoring fields |
| `MonthlyRouteRun` | `monthly_route_run` | One run per `(monthly_route_id, month_date)`; opened/started/completed timestamps, `status`, `source` |
| `MonthlyRouteTestHistory` | `monthly_route_test_history` | **One row per `(location_id, month_date)`** — worksheet grain; run-scoped snapshots |
| `MonthlyRouteWorksheetAuditEvent` | `monthly_route_worksheet_audit_event` | Append-only field audit for worksheet PATCH |
| `MonthlyRouteLocationInspectionRevision` | `monthly_route_location_inspection_revision` | Append-only inspection-field audit |
| `MonthlyRouteComment` / `MonthlyRouteLocationComment` | comment tables | Staff notes on routes / locations |
| `MonthlyRouteSpecialistMonth` | `monthly_route_specialist_month` | Per-route per-month top techs from ST jobs |
| `MonthlyRouteSnapshot` | `monthly_route_snapshot` | Cached specialist stats keyed by ST **route** location id |
| `MonitoringCompany` / `MonitoringCompanyProposal` | monitoring tables | Vendor directory + tech proposals |

ORM definitions: `app/db_models.py` (search `class Monthly`).

### 3.2 V2 dual schema (library / multi-stop / billing)

| Model | Table | Role |
|--------|--------|------|
| `MonthlySite` | `monthly_site` | Billing anchor; **1:1** with legacy location via `legacy_monthly_route_location_id` |
| `MonthlyTestingSite` | `monthly_testing_site` | Per-stop master fields: ring, key (`keys`/`key_id`), annual month, PMC, building name, panel + panel location, door code, monitoring company FK, procedures/notes, price |
| `MonthlyTestingSiteMonth` | `monthly_testing_site_month` | Run-scoped snapshots of the same display fields (plus time in/out, result) — **table extended; worksheet still uses location history until portal UI cutover** |
| `MonthlyKeyBridge` | `monthly_key_bridge` | Archive of key↔site links before wipes; **no FK** to wiped location rows; **RESTRICT** FK to `keys` |

### 3.3 Keys

| Model | Role |
|--------|------|
| `Key` | Canonical keycodes + barcodes |
| Legacy `MonthlyRouteLocation.key_id` | Still used by worksheet |
| V2 `MonthlyTestingSite.key_id` | Canonical target after migration `z2` |

---

## 4. TEST DAY parsing

**Module:** `app/monthly/test_day.py`

- Format: `{weekday}{occurrence}-R{route}` e.g. `W1-R7`, `TH2-R15`
- Weekday: longest-prefix match (`TH` = Thursday, not Tuesday)
- `weekday_iso`: `datetime.weekday()` (Monday=0 … Sunday=6)
- **Cancelled:** `-` (or unicode dashes) → not a route token; clears route FK via `route_sync`
- **Sync:** `app/monthly/route_sync.py` → `sync_monthly_route_fk_for_location` finds/creates `MonthlyRoute` by `route_number`

---

## 5. API surface

Blueprints in `app/routes/__init__.py`: `monthly_routes_bp`, `monthly_sites_bp`, `monthly_specialist_bp`, `technician_portal_bp`.

### 5.1 `monthly_routes` — `app/routes/monthly_routes.py`

Primary API for library, routes, worksheet, CSV import, comments.

| Area | Key endpoints |
|------|----------------|
| Library | `GET/POST/PATCH/DELETE /api/monthly_routes/library[...]` — filters: `q`, `route`, `skipped_any`, `annual_tested_conflict`, month range |
| Routes | `GET /api/monthly_routes/routes`, `GET .../routes/<id>` |
| Worksheet | `GET .../worksheet`, `GET .../worksheet/stream` (SSE), `PATCH .../worksheet/rows/<location_id>`, `PATCH .../worksheet/stops/<testing_site_id>` (portal v2), `POST .../worksheet/reset_run` |
| Runs | `GET .../run_details?month=` (office run summary), `GET .../run_details/review?month=` (lazy run review), `GET .../run_details/review/stops/<testing_site_id>?month=` (per-stop change detail), `POST .../runs/import_csv`, `POST .../runs/complete`, `POST .../runs/reopen` |
| Other | `PUT .../location_order`, comments, `POST .../library/<id>/geocode`, `POST .../routes/<id>/geocode_missing_coordinates`, placement, `GET .../testing_session` |

Location create/update also runs: `sync_monthly_route_fk_for_location`, `sync_key_fk_for_location`, v2 `sync_testing_sites_from_legacy`, `push_legacy_keys_to_primary_testing_site`.

### 5.2 `monthly_sites` — `app/routes/monthly_sites.py` (v2 wrapper)

Delegates most mutations to `monthly_routes`, then augments with v2:

| Endpoint | Notes |
|----------|--------|
| `GET /api/monthly_sites/library` | Lightweight list: slim month cells, batched v2 key rollup (no sync-on-read); detail GET includes `testing_sites[]` and `route_options[]` for assignment dropdowns |
| `PATCH /api/monthly_sites/library/<id>` | Update library fields including `test_day` (empty clears route assignment) |
| `PATCH /api/monthly_sites/testing_sites/<id>` | Edit stop; dual-writes keys to legacy |
| `POST .../library/<id>/testing_sites` | Add stop |
| `DELETE .../testing_sites/<id>` | Delete stop (not last) |

**Frontend split:** Library/map pages use **`/api/monthly_sites/...`**; route detail, run details, and worksheet use **`/api/monthly_routes/...`**.

**Office run navigation:** Route detail → **Paperwork** button → **Paperwork** page (`/monthlies/routes/:routeId/paperwork`, optional `?month=YYYY-MM-01`). Defaults to the current Pacific calendar month. The month selector lists every month that has a run file (`runs_by_month`), plus the current month and the next calendar month. Legacy `/runs/:monthIso` URLs redirect to Paperwork with the same month query.

**Paperwork locked views** (one view at a time; hero badge shows which):

| Condition | View |
|-----------|------|
| Run office-completed (`completed_at` / completed status) | **Exact history** — frozen field submission |
| Past month with no run header loaded | **Exact history** |
| Draft / prepared (no `started_at`) | **Run preparation** |
| Field started, not office-completed (including after **Reopen job**) | **Run review** |

**Future-month prep gate:** Office cannot **Mark prepared**, edit prep stops, or edit the pre-run message for a calendar month after the Pacific current month until the **current month run is closed** (`completed_at` / `completed` status). API returns `409` with `code: current_month_not_closed`.

**Paperwork loading:**

- **Month switching (client cache):** The Paperwork page keeps an in-memory cache per route/month for `run_details` and exact-history field submission. Revisiting a month shows the cached payload immediately (no full-page skeleton) and revalidates in the background with a subtle “Refreshing…” indicator beside the month selector. First visit to a month still shows the skeleton until `run_details` returns. Lifecycle actions (mark prepared, reset run) invalidate that month’s cache; workflow transitions (complete, reopen, review complete) invalidate secondary caches and patch run header in place. Library master edits invalidate paperwork cache for the route. `fetchPaperworkRunDetails` in `paperworkRoutePrefetch.ts` dedupes in-flight `GET …/run_details` per route/month (page load, prefetch, and master-sync refresh share one request). A monotonic fetch sequence drops stale responses (e.g. **Reopen job** before cache revalidation finishes).
- **Adjacent prefetch:** While viewing a month, the SPA prefetches the previous and next selectable months in the background (plus any month hovered in the dropdown). Exact-history months also prefetch field submission.
- **Exact history:** After `run_details` loads, `GET .../run_details/field_submission` loads frozen stops (cached the same way on repeat visits).

1. **Base** — ``GET .../run_details?month=`` returns route header, run lifecycle, KPI ``counts``, ``locations[]`` (all worksheet stops grouped by billing location with ``attention_flags`` and per-stop ``deficiency_summaries`` — same fields as portal worksheet deficiencies, for office review cards/modal), ``review_summary``, plus legacy ``billing_locations`` / ``review_meta`` for compatibility. Enrichment (deficiencies, open tickets, audit field changes) is loaded in batched queries per route-month, not per stop.
2. **Stop detail** — ``GET .../run_details/review/stops/<testing_site_id>?month=`` loads when a stop row’s field changes are expanded; returns pre-built ``changes[]``. **Site modal** — ``GET .../run_details/stops/<testing_site_id>?month=`` loads one full worksheet stop (panel fields, clock events, deficiencies) when office staff open site details from a location card.
3. **Legacy review list** — ``GET .../run_details/review?month=`` remains for older clients (notable stops only); the SPA uses the unified ``locations`` payload.

Run details **KPI counts** are derived from worksheet stops for that month. Run review includes every stop that was **tested**, **skipped**, is due as an **annual** that month, or had property audit edits or run comments. Test workflow, ``reset_run``, and per-stop ``stop_reset`` audit rows are omitted from field-change detail and ``has_field_edits`` flags.

**Run details UI (prep vs review):** When the run is **Draft** or **Prepared** (no ``started_at``), the SPA shows a **prep table** inside a card surface — one row per testing site with sticky stop # and address columns. Columns: stop #, address, access (ring / key # / door code / annual month), monitoring (company / account # / notes), deficiencies (new + verified, compact cards with modal detail), job comments, testing procedures, and location comments. Fields use click-to-edit with explicit **Save** and **Cancel**; ``PATCH …/worksheet/stops/<testing_site_id>`` persists changes; the backend materializes ``MonthlyTestingSiteMonth`` rows on first office save or on ``POST …/runs/prepare``. A prep summary bar (stop count, locations, open deficiencies) replaces outcome KPIs during prep. After technicians **start the run**, the UI switches to the **review card** layout (billing, deficiencies, outcomes, follow-ups). Opening **site details** from a location card uses the same click-to-edit field rows as the technician portal worksheet (snapshot fields, monitoring, deficiencies, and comments). After **field end**, the site modal header status pill becomes a dropdown (Pending, All good, Passed with problems, Failed, Skip) backed by ``PUT …/worksheet/stops/<id>/test_outcome`` (office browser, no ``tech_portal``); ``{ "clear": true }`` clears the outcome back to pending. Skip and deficiency-verify flows reuse the portal modals.

**Run lock (office completes the job):** A run is editable in the technician portal until office staff press **Complete job** on the **Paperwork** page (`POST .../runs/complete` sets `status=completed` and `completed_at`). That sets `is_historical` on the worksheet payload and blocks all portal PATCHes (`run_completed_locked`). **Reopen job** on Paperwork (`POST .../runs/reopen`) clears completion. Technicians no longer use Start/Complete run in the portal — opening the current month's worksheet materializes the run file automatically.

### 5.3 `technician_portal` — `app/routes/technician_portal.py`

| Endpoint | Purpose |
|----------|---------|
| `POST /api/technician_portal/auth` | PIN gate (`TECHNICIAN_PORTAL_PIN`) |
| `GET /api/technician_portal/routes_today` | Routes matching today’s weekday/occurrence |
| `POST /api/technician_portal/routes/<id>/runs` | Start run + materialize history rows and v2 stop months |
| `POST .../runs/complete`, `.../runs/reopen` | Portal run lifecycle |

Auth exemptions: `app/api_auth_gate.py` — all `/api/technician_portal/*` and `/api/monthly_routes/routes/:id/*` when `tech_portal_unlocked` (16h permanent session after PIN). SPA auth failures on `/tech/*` redirect to `/tech`, not staff `/login`.

### 5.4 `monthly_specialist` — `app/routes/monthly_specialists.py`

- `GET /api/monthly_specialists` — cached `MonthlyRouteSnapshot` list
- SPA page at `/monthly_specialist`

---

## 6. Sync and import flows

### 6.1 Legacy ↔ v2 — `app/monthly/monthly_sites_sync.py`

| Function | Behavior |
|----------|----------|
| `ensure_monthly_site_for_location` | Idempotent `MonthlySite` |
| `sync_testing_sites_from_legacy` | Primary testing stop (`sort_order` 0) from legacy fields |
| `refresh_primary_testing_site_from_legacy` | Overwrite primary stop (sheet upload) |
| `push_testing_site_keys_to_legacy` / `push_legacy_keys_to_primary_testing_site` | **Dual-write** keys |
| `rollup_price_per_month` | Sum testing-site prices for library display |

### 6.2 Keys — `app/monthly/key_resolve.py`, `app/monthly/monthly_keys_keycode.py`

Normalize `KEYS` text → match `keys.keycode` or unique barcode → set `key_id`.

### 6.3 Sheet import

| Path | Module |
|------|--------|
| Route inspection CSV | `app/monthly/route_inspection_csv_import.py` → `POST .../runs/import_csv` (location match first; route-scoped testing-site label fallback; CSV ``#`` always drives run-month ``session_route_stop_order`` / run review order; optional ``sync_stop_order=1`` also updates library ``route_stop_order``) |
| Master sheet bulk | `app/scripts/upload_monthly_sheet.py` |

Import flow:

```
Excel/CSV
  → match/create MonthlyRouteLocation
  → get_or_create MonthlyRouteRun (app/monthly/runs.py)
  → upsert MonthlyRouteTestHistory per location/month
  → refresh_primary_testing_site_from_legacy (v2)
```

### 6.4 Run lifecycle — `app/monthly/runs.py`

`get_or_create_monthly_route_run` — shared by worksheet and CSV import. `started_at` set only when explicitly requested (portal start).

---

## 7. Migrations (v2 chain)

| Revision | File | Change |
|----------|------|--------|
| `z1b2c3d4e5f6` | `migrations/versions/z1b2c3d4e5f6_add_monthly_site_v2_tables.py` | `monthly_site`, `monthly_testing_site`, `monthly_testing_site_month` |
| `z2b2c3d4e5f7` | `migrations/versions/z2b2c3d4e5f7_monthly_testing_site_key_fk.py` | Key columns + FK on testing sites; SQL backfill from legacy |
| `z3c4d5e6f8a0` | `migrations/versions/z3c4d5e6f8a0_monthly_key_bridge.py` | `monthly_key_bridge` archive table |

Many earlier migrations scaffolded routes, runs, history, inspection fields, coordinates, comments, specialists — see `migrations/versions/*monthly*`.

---

## 8. Maintenance scripts

| Script | Purpose |
|--------|---------|
| `app/scripts/backfill_monthly_v2_sites.py` | Scaffold `MonthlySite` + primary `MonthlyTestingSite` (`--execute`) |
| `app/scripts/backfill_monthly_key_bridge.py` | Populate `monthly_key_bridge`; optional CSV (`--execute`, `--csv`) |
| `app/scripts/wipe_monthly_locations_data.py` | Delete locations, history, runs, v2, comments, snapshots; **keep** `monthly_route` shells and `monthly_key_bridge` |
| `app/scripts/upload_monthly_sheet.py` | Bulk master sheet → library + history + v2 refresh (`--locations-only` skips month columns/history; `--history-only` skips location upserts) |
| `app/scripts/backfill_monthly_route_entities.py` | Route entities from TEST DAY classification |
| `app/scripts/backfill_monthly_location_key_id.py` | Key FK backfill on locations |
| `app/scripts/backfill_monthly_route_coordinates.py` | Bulk geocode all library rows missing lat/lng (`--commit`) |

### Map coordinates (office UX)

Stops need `latitude`/`longitude` on `monthly_route_location` before the route map can draw pins or Mapbox driving directions.

1. **Identify** — Route detail → **Route map**: **Missing coords** count; expand the list for each stop (address + **Set pin** / **Edit address**). **Sites on this route** shows a **No map pin** badge linking to the map section.
2. **Fix in bulk** — **Geocode missing** on the route map (calls `POST /api/monthly_routes/routes/<id>/geocode_missing_coordinates`; requires backend `MAPBOX_ACCESS_TOKEN`).
3. **Fix one stop** — **Set pin** → **Try automatic geocode**, or search Greater Victoria and pick a Mapbox candidate (`PATCH .../placement`).
4. **Correct address first** when auto-geocode fails (typo/incomplete street); then geocode again.
5. **Refresh route** recalculates drive distance/time only — it does not geocode.
6. **Monthlies → Map** still auto-geocodes on load (`include_coordinates=true`) for the full library; use the route map panel when working one route (e.g. R10).

Script fallback for many routes: `python -m app.scripts.backfill_monthly_route_coordinates --commit`.
| `app/scripts/audit_keys_multiple_monthly_routes.py` | Audit keys spanning multiple routes |

**Safe wipe order:** `backfill_monthly_key_bridge --execute` → then `wipe_monthly_locations_data --execute`.

**Fresh library from master sheet (no historical test cells):**

1. `python -m app.scripts.backfill_monthly_key_bridge --execute` (optional archive before wipe)
2. `python -m app.scripts.wipe_monthly_locations_data --execute`
3. `python -m app.scripts.upload_monthly_sheet --locations-only --commit --csv-path <master.csv>`
4. `python -m app.scripts.backfill_monthly_route_entities --execute` (assign routes from TEST DAY)
5. Import per-month run CSVs via the office UI (or route inspection CSV import API) for test history only

---

## 9. Frontend

| File | Role |
|------|------|
| `frontend/src/pages/MonthlyRoutesOverviewPage.tsx` | Routes overview — Pacific **current-month** calendar; routes placed on **effective** test dates (BC stat holidays bump to next same-weekday occurrence) |
| `frontend/src/pages/MonthlyRoutesPage.tsx` | Library (v2 API) |
| `frontend/src/pages/MonthlyRouteDetailPage.tsx` | Route detail; Paperwork entry button |
| `frontend/src/pages/MonthlyRoutePaperworkPage.tsx` | Office Paperwork (prep / review / exact history) |
| `frontend/src/pages/MonthlyRoutesMapPage.tsx` | Map view |
| `frontend/src/pages/MonthlyLocationDetailPage.tsx` | Location detail (edit status, route assignment, testing sites) |
| `frontend/src/pages/TechnicianWorksheetPage.tsx` | Office/staff worksheet table + SSE |
| `frontend/src/pages/TechnicianPortalWorksheetPage.tsx` | Portal worksheet (one stop at a time, v2 `stops[]`) |
| `frontend/src/features/monthlyRoutes/usePortalWorksheet.ts` | Portal load/sync/SSE/run lifecycle hook |
| `app/monthly/worksheet_stops.py` | Materialize/serialize/PATCH helpers for portal stops; **run-month snapshots** on read; new months seed from **office master** (+ prior-month fallback); latest-month PATCH mirrors to master |
| `app/monthly/site_field_template.py` | Master template + prior-month merge for seeding new ``MonthlyTestingSiteMonth`` rows |
| `frontend/src/features/monthlyRoutes/monthlyRoutesShared.ts` | Shared types/helpers; ``effectiveRouteTestDayIso``, ``scheduledRouteTestDayIso``, calendar grid builders |
| `frontend/src/features/monthlyRoutes/bcStatHolidays.ts` | BC richer stat holiday set (mirrors ``app/monthly/bc_stat_holidays.py``) |
| `frontend/src/features/monthlyRoutes/worksheetOfflineStore.ts` | Offline worksheet support |

Technician flow: `/tech` → `/tech/start` → `/tech/route/:routeId/worksheet/:monthIso`.

**Routes overview calendar:** Uses ``monthFirstIsoPacificToday()`` for the displayed month. Each route's cell date comes from ``effectiveRouteTestDayIso`` — nominal ``week_occurrence`` + ``weekday_iso``, bumped to the next same-weekday occurrence when that day is a BC richer stat holiday (e.g. 3rd Monday → 4th Monday when Victoria Day falls on the 3rd). ``scheduledRouteTestDayIso`` delegates to the same logic for portal/worksheet "route today" checks.

---

## 10. Test coverage

| Test file | Validates |
|-----------|-----------|
| `tests/test_monthly_worksheet_api.py` | Worksheet GET/PATCH, audit, reset, run complete/lock, portal lazy vs staff auto-run, SSE, hybrid `tech_portal=1` |
| `tests/test_monthly_run_details_api.py` | Office `GET .../run_details` counts, run comments, field-change aggregation |
| `tests/test_worksheet_stops_api.py` | Portal `stops[]`, materialize on start run, PATCH stop, clock-in conflict, skip→clock-in |
| `tests/test_monthly_sites_v2.py` | v2 sync, dual-write keys, testing-site CRUD API |
| `tests/test_monthly_key_bridge_wipe.py` | Bridge backfill; wipe keeps routes; post-wipe API smoke |
| `tests/test_monthly_route_sync.py` | TEST DAY → route FK |
| `tests/test_monthly_test_day.py` | Parser edge cases, cancelled `-` |
| `tests/test_monthly_key_resolve.py` | Barcode/keycode resolution |
| `tests/test_monthly_keys_keycode.py` | Keycode normalization |
| `tests/test_route_run_csv_import.py` | CSV import API |

Tests often use minimal SQLite table subsets with explicit BIGINT id assignment.

---

## 11. Run workflow state machine

Each ``MonthlyRouteRun`` moves through explicit office and field phases. The API exposes ``workflow_stage`` / ``workflow_stage_label`` on every serialized run header.

| Stage | Timestamps | Who advances |
|-------|------------|--------------|
| Draft | (run file may exist via ``opened_at``) | — |
| Prepared | ``prepared_at`` | Office ``POST …/runs/prepare`` |
| (back to draft/prep) | ``prepared_at`` cleared | Office ``POST …/runs/unprepare`` (only before ``started_at``) |
| Field in progress | ``started_at`` | Portal ``POST …/runs`` (requires prepared) |
| Awaiting office review | ``field_ended_at`` | Portal ``POST …/runs/end`` |
| Ready to close | ``office_review_completed_at`` | Office ``POST …/runs/review_complete`` |
| Completed | ``completed_at`` | Office ``POST …/runs/complete`` (requires review complete) |

**Technician reopen field:** ``POST …/runs/reopen_field`` clears ``field_ended_at`` and office review-complete so techs can edit stops again.

**Edit gates**

| Surface | Allowed when |
|---------|----------------|
| Portal stop / clock / deficiencies | ``started_at`` set, ``field_ended_at`` null, run not office-completed |
| Office tested/skipped outcomes | ``field_ended_at`` set, not office-completed |
| Office billing (run details) | Same as outcomes |
| CSV import replace month | Run not office-completed; import sets ``prepared_at``. Months **before** the Pacific current month are auto-closed after import (``completed_at``, office review complete, field submission snapshot). Re-upload requires ``POST …/runs/reopen`` first. |
| Pre-run message (``PATCH …/runs``) | ``run_in_office_prep_phase`` (before ``started_at``) |
| Site highlight flag (``office_attention`` on stop PATCH) | Same as pre-run message; portal cannot set |

**Prep messaging (office → field):**

- ``MonthlyRouteRun.pre_run_message`` — shown on the technician route hub below **Open run**; cleared on run reset.
- ``MonthlyTestingSiteMonth.office_attention`` — purple stop styling on the portal worksheet until any ``test_outcome`` is recorded; pair with **Job comment** (`run_comments`) when needed.

Logic: ``app/monthly/run_workflow.py``. UI stepper: ``RunWorkflowStepper.tsx``.

---

## 12. Technician field run (current month)

```
/tech PIN → session[tech_portal_unlocked]
  → GET /api/technician_portal/routes_today
  → Office: POST /api/monthly_routes/routes/:id/runs/prepare  (release route)
  → POST /api/technician_portal/routes/:id/runs
       → MonthlyRouteRun (started_at set)
       → materialize MonthlyRouteTestHistory rows + MonthlyTestingSiteMonth stops
  → GET /api/monthly_routes/routes/:id/worksheet?month=...&tech_portal=1
       → ``stops[]`` (v2 testing-site grain); ``rows[]`` still returned for compatibility
  → PATCH .../worksheet/stops/:testing_site_id
       → MonthlyTestingSiteMonth + dual-write primary location history (audit FK)
  → POST /api/technician_portal/routes/:id/runs/end   (field handoff)
  → Office: review billing / outcomes on run details
  → POST …/runs/review_complete → POST …/runs/complete
```

**Portal vs office worksheet:** Field technicians use `TechnicianPortalWorksheetPage` at `/tech/route/:routeId/worksheet/:monthIso` (stop-by-stop UI). Office staff keep `TechnicianWorksheetPage` (location-grain table) until a later office cutover.

**Dual-write (transition):** Primary testing site PATCH outcomes sync to `MonthlyRouteTestHistory` for that location so worksheet audit events keep `history_row_id` and office `rows[]` stay roughly aligned for single-panel sites.

### Historical worksheet fidelity (non-current months)

- **Pacific current month only:** `GET .../worksheet` may auto-create a `MonthlyRouteRun` and placeholder history rows for the route’s **current** roster (`_ensure_worksheet_rows_for_route_month`).
- **Past or future months:** GET is **read-only**. No run or history is created from today’s roster. Response uses `_testing_history_rows_attributed_to_route_month` only (stamped `test_monthly_route_id` wins; legacy NULL-stamp rows count only for sites still on the route).
- **Empty non-current month:** If there is no run and no attributed history → `{ run: null, rows: [] }` (no phantom worksheet).
- **Portal preview** (current roster before Start Run) applies only to the **current** Pacific month; non-current months never use `_portal_worksheet_preview_payload`.

### Run-month snapshots vs library “newest edition”

- **Portal `stops[]` and office `rows[]` (historical month):** All site fields for that visit come from the **run month** (`MonthlyTestingSiteMonth`, or `MonthlyRouteTestHistory` when no MTSM row). Older months are not overwritten when a later month or the library master changes.
- **New run materialize:** `seed_stop_month_fields` copies display fields from **office master** (`MonthlyTestingSite` / `master_template_fields`), with gaps filled from the **most recent prior** `MonthlyTestingSiteMonth`, then from the **current or prior** `MonthlyRouteTestHistory` row when no prior stop-month row exists (so an April CSV import carries procedures into May even when no April portal stop rows exist). Outcomes (tested/skipped/times) start empty. **`run_comments` always starts empty** for a new month (never copied from prior month or master).
- **Office prep / library sync:** Snapshot fields stay aligned during open prep: prep worksheet PATCH mirrors to library master (latest month), and library testing-site PATCH mirrors back into open prep ``MonthlyTestingSiteMonth`` rows. Prep-only fields (`run_comments`, `office_job_comment`, `office_attention`) stay on the stop-month row only. Paperwork **Preparation** view exposes **Regenerate from library** (`POST …/runs/regenerate_prep_stops`), which re-seeds stop-month snapshot fields from the library master and prior run month while preserving office attention flags (blocked after field work starts or when the run is completed).
- **Portal refresh paperwork:** Opening the current-month portal worksheet (`GET …/worksheet?tech_portal=1&refresh_paperwork=1`) re-runs stop-month seeding from the latest office/prior-run data when the run is not completed (automatic on each worksheet open; prior months and background SSE refreshes skip this). Snapshot fields are overwritten; times, tested/skipped outcomes, and run comments are preserved. `POST /api/technician_portal/routes/<id>/regenerate_paperwork` performs the same refresh explicitly if needed. **`POST …/worksheet/reset_run`** clears the full run for that route-month: deletes worksheet audit events, clears attributed ``monthly_route_test_history`` outcomes and run snapshots (including master-sheet legacy rows), clears per-location ``billing_status`` (``bill`` / ``do_not_bill`` / ``unset``; **legacy** billing is preserved), re-seeds every ``MonthlyTestingSiteMonth`` from library master (testing outcomes, run comments, and field edits such as annual month / panel / PMC), clears ``MonthlyRouteRun.started_at``, and mirrors primary stops to library when this month is the location's latest. Run-details KPIs count only rows with ``result_status`` ``tested`` or ``skipped``.
- **Library location display:** Each `MonthlyTestingSite` master row is the **newest edition** for that testing stop (office edits + mirror from the latest run month when techs PATCH snapshot fields). Primary testing-site values also dual-write to the legacy route location for sheet/detail parity.
- **Portal stop PATCH (latest month only):** Snapshot field edits on the current/latest run mirror to that stop's `MonthlyTestingSite` master via `mirror_mtsm_snapshot_to_primary_master` (`monthly_sites_sync.py`). Primary stops also mirror to the legacy location. Older months never mirror.
- **Office testing-site PATCH:** Updates master directly; open prep ``MonthlyTestingSiteMonth`` rows for that route/month (draft/prepared, before ``started_at``) are refreshed from master in the same transaction. The next run seeds from that master when no prep row exists yet.
- **Route CSV import:** Writes snapshot fields to `MonthlyRouteTestHistory` for **library location matches** (canonical street on `MonthlyRouteLocation.address`, then PMC/building narrowing). When no library row exists at that street, the importer falls back to **route-scoped** testing sites: it matches the CSV street line against `MonthlyTestingSite.label` and `building_name` on locations assigned to the importing route only (same canonical street normalization as civic addresses). **Primary / location path:** history upsert + primary testing-site master fields (unchanged). **Secondary testing-site fallback:** updates the matched `MonthlyTestingSite` master and upserts `MonthlyTestingSiteMonth` with CSV snapshots, sheet times, and tested/skipped outcome — **no** location history upsert (avoids clobbering the single per-location history row). If the fallback hits the **primary** stop (label differs from library address), history is still upserted. Example: billing location `2471 Sidney Ave` with a secondary stop labeled `9838 Second Street` — row 2471 writes history; row 9838 writes MTSM only. API response counters: `testing_site_matches`, `stop_month_upserts`. Issue kinds: `testing_site_ambiguous`, `testing_site_duplicate`. Every import stores CSV ``#`` on history ``session_route_stop_order`` and post-import syncs that onto worksheet rows so **run review / worksheet order matches the sheet** without changing library ``route_stop_order``. Optional ``sync_stop_order=1`` additionally updates library ``route_stop_order`` for locations already on the route. Post-import `ensure_worksheet_stops_for_route_month` materializes any untouched stops; existing MTSM rows from office prep pick up history outcomes when still empty. Legacy location library columns still use `is_latest_history_month_for_location` (`history_sheet_notes.py`).

### Per-testing-site display fields (2026-05)

**Stop titles in worksheets, paperwork, maps, and billing:** API stop payloads include ``primary_label`` (testing site ``label``, or billing address when there is only one site and ``label`` is empty) and optional ``billing_address_subline`` when the billing address differs from that title. **Multi-site billing locations:** each stop shows its testing site label as the main line, with subline ``testing site X/N of <billing location>`` (e.g. ``testing site 1/2 of 2471 Sidney Avenue`` under ``9838 Second Street``). Billing-board location rows use ``location_label`` plus ``testing_site_labels[]`` when a library location has multiple testing sites. Helpers: ``app/monthly/testing_site_display.py``, ``frontend/src/features/monthlyRoutes/testingSiteDisplay.tsx``.

Master data lives on **`MonthlyTestingSite`** (migration `z4a5b6c7d8e9`):

| Label | Column(s) |
|-------|-----------|
| Ring | `ring_detail` |
| Key | `keys`, `key_id`, `barcode` |
| Annual | `annual_month` |
| Property management company | `property_management_company` |
| Building name (if any) | `building_name` |
| Panel | `panel` (legacy `facp_detail` kept in sync) |
| Panel location | `panel_location` |
| Door code (if any) | `door_code` |
| Monitoring company | `monitoring_company_id` → `monitoring_company` (directory phones on `MonitoringCompany`) |
| Monitoring account # | `monitoring_account_number` (site-specific; not on directory row) |
| Monitoring notes | `monitoring_notes` (signals, passwords, free notes — not account #) |

Run-month copies: **`MonthlyTestingSiteMonth`** (`panel`, `panel_location`, `door_code`, `building_name`, `property_management_company`, `testing_procedures`, `inspection_tech_notes`, `monitoring_company_id`, `monitoring_account_number`, `monitoring_notes`, plus existing ring/key/annual).

### Monitoring company directory (2026-05)

Office maintains vendors at **`/monthlies/monitoring-companies`**. Technicians pick from the directory on portal worksheets and can add a new company inline (deduped by normalized name, immediate use).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/monitoring_companies` | List/search (`q`, `active`, `limit`) |
| GET | `/api/monitoring_companies/:id` | Detail |
| POST | `/api/monitoring_companies` | Create (office + portal); returns `reused_existing` when name matches |
| PATCH | `/api/monitoring_companies/:id` | Update name/phones/active |
| POST | `/api/monitoring_companies/:id/merge` | Merge duplicate into canonical row |

Backfill structured monitoring fields from legacy `monitoring_notes` paste shapes:

- `python -m app.scripts.backfill_monitoring_account_numbers` (dry-run)
- `python -m app.scripts.backfill_monitoring_account_numbers --execute`

Legacy `monitoring_company_name` on run-month rows remains for historical fidelity; new worksheet PATCHes use `monitoring_company_id` + `monitoring_account_number`.

### Comments (portal worksheet — 2026-05)

| UI label | Column | Propagation |
|----------|--------|-------------|
| Testing procedures | `testing_procedures` | Master seed + prior-month gap fill; mirrors to library on latest-month PATCH |
| Location comments | `inspection_tech_notes` | Same as testing procedures (persistent site notes) |
| Run comments | `run_comments` (MTSM only) | Empty on new month; **not** prior-filled, **not** mirrored to master; cleared on **Reset run** |

API field names stay `inspection_tech_notes` and `run_comments` for CSV/import compatibility.

- API: `PATCH /api/monthly_sites/testing_sites/<id>` accepts the fields above (`ring` / `key` accepted as aliases for `ring_detail` / `keys`).
- Backfill: `python -m app.scripts.backfill_testing_site_display_fields`
- Field map for future CSV: `app/monthly/testing_site_fields.py`

Backfill portal stop months from attributed history:

- `python -m app.scripts.backfill_worksheet_stop_months`
- `python -m app.scripts.backfill_worksheet_stop_months --execute`

**Planned next:** office worksheet on `stops[]`; route CSV column mapping into `MonthlyTestingSiteMonth` fields; audit FK on `monthly_testing_site_month_id` (drop dual-write).

### Portal workflow foundation (2026-05, Phase 1)

Migration `z5a6b7c8d9e0` adds:

| Table / column | Purpose |
|----------------|---------|
| `monthly_stop_clock_event` | Multiple clock-in/out pairs per `MonthlyTestingSiteMonth` |
| `monthly_testing_site_month.test_outcome` | `all_good`, `passed_with_problems`, `failed`, `skipped` |
| `monthly_testing_site_month.skip_category` / `skip_note` | Structured skip (replaces free-text-only `skip_reason` for new work) |
| `monthly_testing_site_month.confirmed_no_deficiencies` | Processor flag when Passed with problems has zero deficiencies; cleared when a deficiency is logged on a later visit |
| `monthly_route_test_history.billing_status` | Per **location** per month: `bill`, `do_not_bill`, `unset`, `legacy` |
| `monthly_testing_site_deficiency` | App-only deficiencies per testing site (persist across runs; `created_run_id`) |

**Domain:** `app/monthly/portal_workflow.py` — clock events, outcomes, billing defaults, deficiencies, per-stop reset.

**Technician portal session:** After PIN, `POST /api/technician_portal/session/technician` stores `portal_tech_id` / `portal_tech_name`. `GET /api/technician_portal/technicians` returns cached ServiceTrade active techs (fallback **Shop Tech**).

**Stop sub-resources** (all require `?month=YYYY-MM-01` and portal auth):

| Method | Path |
|--------|------|
| GET | `.../worksheet/stops/<testing_site_id>/clock_events` |
| POST | `.../clock_events/clock_in`, `.../clock_events/clock_out`, `.../clock_events/cancel_clock_in` |
| POST | `.../worksheet/transition_clock` (body: `from_testing_site_id`, `to_testing_site_id`, optional `time_out` / `time_in`) |
| PUT | `.../test_outcome` |
| GET/POST | `.../deficiencies` |
| PATCH | `.../deficiencies/<id>` |
| POST | `.../deficiencies/<id>/verify` |
| POST | `.../reset` (per-stop; audit `stop_reset`) |

Worksheet `stops[]` payload adds: `clock_events`, `test_outcome`, `skip_category`, `skip_note`, `deficiencies`, `has_run_changes`, `billing_status`, `is_legacy_outcome`, `portal_read_only`, `is_legacy_run`.

**Billing defaults:** Non-skip outcome on any stop at a location → `bill`; all stops skipped → `unset`; any billable stop on location → `bill` (E1). Office sets final Bill / Do not bill on **Run details** (see Phase 4 below).

**Read-only runs:** `MonthlyRouteRun.source = csv_import` → `portal_read_only` (technician portal PATCH/workflow blocked). Office Paperwork **run review** may still edit billing and test outcomes when the run is reopened and field work has ended.

Legacy `result_status` / `sheet_time_in_raw` / `sheet_time_out_raw` remain for CSV and transition; primary-stop dual-write continues via `sync_primary_history_from_stop`.

### Portal UI core (2026-05, Phase 2)

**Routes:** PIN unlock → `/tech/technician` (tech picker) → `/tech/start` → route → worksheet. Layout redirects to the picker when `GET /api/technician_portal/session/technician` returns 404.

**Worksheet dock bands** (`portalWorkflowShared.portalStopDockBand`):

| Band | When | Actions |
|------|------|---------|
| A | Not clocked in here; visit incomplete | Clock in, Skip |
| B | Open clock on this stop | Record results, Clock out, Add deficiency, Skip, Reset* |
| C | `test_outcome` set and no open clock | Clock in again, Reset* |

\*Reset when `has_run_changes` or an open clock is on this stop (visible immediately after clock-in via optimistic projection); confirm dialog.

**APIs used by the portal UI (not legacy PATCH `time_in`/`time_out` on the dock):**

- `POST .../clock_events/clock_in` / `clock_out` / `cancel_clock_in` (API remains for sync/undo paths). **Reset** in the dock (`POST .../reset`) clears clock events, results, and deficiencies logged this run when `has_run_changes`.
- `PUT .../test_outcome` (four outcomes + structured skip)
- Deficiency CRUD + `POST .../verify`
- `POST .../reset` per stop (clears `test_outcome`, legacy `result_status` / sheet times, clock events, and run-scoped deficiencies)

Field edits (procedures, panel, comments, etc.) still use `PATCH .../worksheet/stops/:id`. Workflow mutations queue in `localStorage` key `portalWorkflowSyncQueue` (separate from field PATCH queue).

### Portal business rules (2026-05, Phase 3)

**Server validation** (`validate_test_outcome` in `app/monthly/portal_workflow.py`, enforced on `PUT .../test_outcome`):

| Outcome | Rule |
|---------|------|
| `all_good` | Rejected if any deficiency on the testing site is **New** or **Verified** (`code: deficiencies_block_all_good`) |
| `passed_with_problems` | If no New/Verified deficiencies: requires `confirmed_no_deficiencies: true` (`confirmed_no_deficiencies_required`). If deficiencies exist: all **New** deficiencies from **before this run** (or with no `created_run_id`) must be **Verified** (`unverified_deficiencies`). New deficiencies logged on the active run are exempt. |
| `failed` | Rejected while any **New** deficiency from before this run remains (`unverified_deficiencies`) |
| `skipped` | Unchanged |

Creating a deficiency while the stop is `all_good` auto-downgrades to `passed_with_problems` (API + UI).

**Record Results wizard** (`PortalRecordResultsModal`): choose outcome → optional **verify** step (each pre-existing **New** deficiency must be verified inline; deficiencies logged on the active run are skipped) → optional **confirm none** for Passed with problems with zero active deficiencies → save outcome. Open clock stays until **Clock out** unless the modal was opened from **Clock out** (no outcome yet)—that path saves the result and then clocks out. **Record results** alone does not clock out. **Skip** while clocked in still auto clock-outs before saving the skip.

**Offline queue:** Invalid `test_outcome` payloads are dropped on sync with an alert (not retried indefinitely).

### Portal sync & projected state (2026-05)

Technician workflow actions are **optimistic**: the UI updates immediately, then a **serial** `portalWorkflowSyncQueue` drains one server mutation at a time per route/month.

| Layer | Module | Role |
|-------|--------|------|
| Intent | `usePortalWorkflowActions` + `worksheetOfflineStore` | Optimistic patch + enqueue |
| Projection | `portalRouteProjection.ts` | `projectStopsWithWorkflowQueue` — apply pending queue in `enqueuedAt` order for gating and refresh merge |
| Drain | `portalWorkflowQueueRunner.ts` | Strict FIFO; merges each server `stop` (or `from_stop` / `to_stop` for transition) into cached payload |

**Open-clock gating** uses **projected** state (`projectedOpenClockSiteId`, `projectedClockInBlockedForStop`), not raw server snapshots, so clock-out → clock-in on the next stop is allowed while sync is pending.

**Refresh:** `mergeWorkflowQueueIntoPayload` overlays the workflow queue on GET/SSE merges so stale server data cannot reopen a site the technician already clocked out of. Remote refresh is suppressed while the workflow queue is non-empty.

**End field run:** On the portal worksheet, **End field run** runs client preflight (`portalEndRunPreflight.ts`, `PortalEndRunModals.tsx`) after sync drain:

1. **Open clock** — If any stop still has an open clock-in (projected queue state), a modal blocks ending the run and offers **Go to clocked-in stop** or **Cancel**.
2. **Untested stops** — Non-annual stops without `test_outcome` trigger a warning listing affected stops. The technician may **Cancel** (return to testing) or **Skip remaining & end run**, which enqueues `test_outcome: skipped` with `skip_category: lack_of_time` for each listed stop, waits for sync again, then `POST …/runs/end`.

Annual-month sites (for the run’s calendar month) are excluded from the untested check. The route hub **End field run** button does not run this preflight (worksheet only).

`POST …/runs/end` still waits for the portal field PATCH queue and `portalWorkflowSyncQueue` to drain before the server call, so a pending clock-out is not rejected with `field_ended_locked` after the run is marked ended.

**Errors:** `open_clock_in_conflict` on `clock_in` retries with backoff when the queue shows an earlier `clock_out` or `transition_clock` for another site (transient lag). `no_open_clock` on `clock_out` retries when the client still shows an open clock on that stop; otherwise idempotent drop. `cancel_clock_in` **supersedes** a pending queued `clock_in` that has not run yet (drops the clock-in item instead of calling the server); when `clock_in` is already at the head of the queue, cancel is chained after it completes. `no_open_clock` on `cancel_clock_in` retries briefly so cancel is not dropped while the preceding clock-in commit is still visible. Real conflicts (second device, wrong site) still alert after retry cap.

**Atomic move:** `POST .../worksheet/transition_clock` (`transition_clock_between_stops` in `portal_workflow.py`) closes the open clock on `from_testing_site_id` and clocks in on `to_testing_site_id` in one transaction. The portal uses this only when the user taps **Clock in** on a stop while another stop still has an open clock (explicit site-to-site move). **Record results** saves the outcome, clocks out the current stop if needed, and **selects** the next incomplete stop—it does not clock in there automatically.

### Office run details (2026-05, Phase 4)

**Run details KPI row** (`GET .../run_details` → `counts`): stop-level tallies — `all_good_count`, `passed_with_problems_count`, `failed_count`, `skipped_count`. Uses `test_outcome` when set; legacy `result_status tested` counts as `all_good`; legacy `skipped` counts as `skipped`. Annual-month sites without an outcome are **not** included in KPI tiles.

**Lazy review endpoints:** ``GET .../run_details/review`` and ``GET .../run_details/review/stops/:testing_site_id`` (see §5.2). Implementation: ``app/monthly/run_details_review.py``.

**Office billing PATCH** (staff session):

| Method | Path |
|--------|------|
| PATCH | `/api/monthly_routes/routes/<route_id>/locations/<location_id>/billing_status?month=YYYY-MM-01` |

Body: `{ "billing_status": "bill" | "do_not_bill" | "unset" }`. Allowed only after technicians **end field** on the run (`office_may_edit_billing`; `409` + `code: billing_before_field_end` while field work is open). Rejects when the row is `legacy` (`code: billing_legacy_locked`). CSV-import runs use the same office review gates (technician portal remains read-only via `portal_read_only`). **Legacy outcomes** (`result_status` without `test_outcome`, e.g. CSV import) show in the run-review outcome dropdown as All good or Skip and may be changed or cleared like portal outcomes once field work has ended. **Auto set billing** (run review button) sets **Bill** when any testing site at the location is all good, passed with problems, or legacy tested; sets **Do not bill** when every site at the location is an annual skip / annual month. Other outcomes (failed, non-annual skip, pending) are left unchanged; legacy billing rows are skipped.

**Monthly Billing board** (staff session, company-wide — not route-scoped):

| Method | Path |
|--------|------|
| GET | `/api/monthly_routes/billing_board` |
| PATCH | `/api/monthly_routes/billing_board/locations/<location_id>/quarter_billed` |

Query: `anchor_month=YYYY-MM-01` **or** `year` + `quarter` (1–4). Optional: `q` (address/PMC; route-like tokens match TEST DAY ``-R{n}`` suffix only), `route` (``R{n}`` route number or full TEST DAY token), `page`, `page_size` (max 200), `bill_any_month`, `unset_any_month`, `not_billed_quarter`, `failed_any_month`.

GET returns active library locations with, for each month in that **calendar quarter**: processor ``billing_status`` from ``monthly_route_test_history`` (defaults to ``unset`` when no row), and a rolled-up **test summary** from ``monthly_testing_site_month`` (worst outcome across testing sites at the address). Also ``quarter_billed`` from ``monthly_location_quarter_billed``.

PATCH body: `{ "billed": true | false }` — upserts or deletes one row per ``(location_id, year, quarter)`` with ``billed_at`` / ``billed_by_username``. This is **invoicing complete**, separate from processor Bill / Do not bill.

UI: ``frontend/src/pages/MonthlyBillingPage.tsx`` at ``/monthlies/billing``. Implementation: ``app/monthly/billing_board.py``. Each row shows ``billing_comments`` under the address (when set); the building field is not shown on this page. Edit comments on the monthly location detail page (**Billing comments** card); persisted on ``monthly_route_location.billing_comments`` via ``PATCH /api/monthly_sites/library/<id>``.

**Paperwork UI:** Single locked view per run phase (see §5.2). **Run preparation** (before `started_at`) uses **Office job comment** (`office_job_comment` on `MonthlyTestingSiteMonth`) instead of the legacy Highlight checkbox; non-empty office comments highlight the prep row purple and appear read-only in the technician portal. **Run review** shows live outcomes, billing, tickets, and deficiencies. **Exact history** shows the frozen technician submission from `GET .../run_details/field_submission` (empty state when no snapshot exists). **Field changes** is not a Paperwork tab in this iteration. **Mark review complete** requires every billing location to be `bill` or `do_not_bill` (not `unset`).

**Field submission:** `POST .../runs/end` (portal) upserts `monthly_route_run_field_submission` — one JSON payload per run, overwritten on each field end. Reopening field work does not delete the snapshot until the next end. If field work ended without a snapshot (legacy runs, idempotent portal end), office review/close and `GET .../field_submission` backfill from live worksheet stops using `field_ended_at` as the capture time. After field end, `GET .../worksheet` for that month serves the frozen submission stops (same order and values as Exact history) until field work is reopened.

**Tickets:** Per billing location — `GET/POST .../locations/<id>/tickets`, `PATCH /api/monthly_routes/tickets/<id>` (status: `open` → `email_sent` → `resolved`).

**Run prep edits:** Office prep field saves use optimistic UI; the server accepts optional ``stop_number`` on worksheet stop PATCH to avoid re-sorting the route, materializes missing stop-month rows when ``run_details`` loads (prep phase, without re-seeding existing rows), and returns a lightweight PATCH payload during prep.

**Prep location order:** Dragging locations on the prep table updates library ``route_stop_order`` via ``PUT …/location_order`` and syncs ``session_route_stop_order`` on worksheet rows so refetches match the new order.

**Prep insights:** **Edited last month** badge on prep rows when the prior month run had audit field edits (`prior_month_field_edits` via `app/monthly/prep_insights.py`). Prior-month visit-order / new-to-route prep badges are disabled for now.

---

## 12. Known gaps and active work

1. **Worksheet grain** — Portal field worksheet uses **one stop per testing site** (`MonthlyTestingSiteMonth`). Legacy office worksheet page (`TechnicianWorksheetPage`) is superseded by **Exact history** on Paperwork for stop-grain read-only view.

2. **Dual schema cutover incomplete** — Legacy `MonthlyRouteLocation` still owns library billing fields (address, status, route assignment, spreadsheet notes). V2 `MonthlyTestingSite` owns per-stop display fields (ring, keys, panel, procedures, price). **Location detail + edit modal** (`MonthlyLocationDetailPage`, `MonthlyLocationLibraryModal`) read/write v2 stops via `GET/PATCH /api/monthly_sites/testing_sites/:id`; primary stop edits dual-write back to legacy for sheet parity. **Location detail** also edits route assignment via **Edit route** (`PATCH` `test_day`, including empty for unassigned).

3. **Portal identity** — Phase 2 tech picker sets `portal_tech_id` / `portal_tech_name` on workflow APIs; field PATCH audit may still show `technician_app` until fully aligned.

4. **Documentation** — This file is the architecture reference; `README.md` only documents the technician portal env var.

5. **In-flight changes (git)** — Modified: `monthly_sites_sync.py`, `monthly_sites.py`, `monthly_sites` routes, v2 migrations, backfill/wipe scripts, v2/bridge tests.

---

## 13. File index (quick lookup)

| Path | Description |
|------|-------------|
| `app/db_models.py` | All monthly ORM models |
| `app/routes/monthly_routes.py` | Main API |
| `app/routes/monthly_sites.py` | V2 API wrapper |
| `app/routes/technician_portal.py` | PIN portal |
| `app/routes/monthly_specialists.py` | Specialist snapshots |
| `app/monthly/monthly_sites_sync.py` | V2 scaffold + dual-write (`sync_testing_sites_from_legacy`, `push_primary_testing_site_display_to_legacy`) |
| `frontend/src/pages/MonthlyLocationDetailPage.tsx` | Library location detail (v2 testing stops section) |
| `frontend/src/pages/MonthlyBillingPage.tsx` | Billing board (quarter test/bill status + mark billed) |
| `app/monthly/billing_board.py` | Billing board query + quarter billed toggle |
| `frontend/src/features/monthlyRoutes/MonthlyLocationLibraryModal.tsx` | Edit billing + v2 testing stops |
| `frontend/src/features/monthlyRoutes/TestingSiteFieldsSection.tsx` | Shared view/edit fields for a testing stop |
| `app/monthly/testing_site_fields.py` | Canonical field names for API/CSV |
| `app/scripts/backfill_testing_site_display_fields.py` | Backfill testing sites from legacy locations |
| `app/scripts/backfill_worksheet_stop_months.py` | Backfill `MonthlyTestingSiteMonth` from attributed history |
| `migrations/versions/z4a5b6c7d8e9_testing_site_display_fields.py` | Per-stop display columns |
| `app/monthly/route_sync.py` | TEST DAY → route FK |
| `app/monthly/test_day.py` | TEST DAY parser |
| `app/monthly/key_resolve.py` | Key FK resolution |
| `app/monthly/route_inspection_csv_import.py` | CSV importer |
| `app/monthly/history_sheet_notes.py` | Latest-run vs history-only sheet notes |
| `app/monthly/runs.py` | Run get-or-create |
| `app/api_auth_gate.py` | Portal auth exemptions |
| `frontend/src/features/monthlyRoutes/portalRouteProjection.ts` | Workflow queue projection + open-clock gating |
| `frontend/src/features/monthlyRoutes/portalWorkflowQueueRunner.ts` | Serial workflow drain |

---

## 14. Summary one-liner

**Route-scheduled monthly fire-alarm testing ledger:** Excel routes → Postgres routes; sites in a library; each month technicians fill **run-scoped history rows** per **location** (office) and **stop months** per **testing site** (portal). **V2** adds multi-stop sites and canonical keys on testing sites, with **`monthly_key_bridge`** protecting key associations across wipes.
