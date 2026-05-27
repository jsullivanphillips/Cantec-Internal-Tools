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
| `MonthlyRouteLocation` | `monthly_route_location` | Site library; unique normalized address/PMC/building; `test_day`, route FK, stop order, keys, inspection/monitoring fields |
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
| Runs | `GET .../run_details?month=` (office run summary), `POST .../runs/import_csv`, `POST .../runs/complete`, `POST .../runs/reopen` |
| Other | `PUT .../location_order`, comments, geocode, `GET .../testing_session` |

Location create/update also runs: `sync_monthly_route_fk_for_location`, `sync_key_fk_for_location`, v2 `sync_testing_sites_from_legacy`, `push_legacy_keys_to_primary_testing_site`.

### 5.2 `monthly_sites` — `app/routes/monthly_sites.py` (v2 wrapper)

Delegates most mutations to `monthly_routes`, then augments with v2:

| Endpoint | Notes |
|----------|--------|
| `GET /api/monthly_sites/library` | Lightweight list: slim month cells, batched v2 key rollup (no sync-on-read); detail GET includes `testing_sites[]` |
| `PATCH /api/monthly_sites/testing_sites/<id>` | Edit stop; dual-writes keys to legacy |
| `POST .../library/<id>/testing_sites` | Add stop |
| `DELETE .../testing_sites/<id>` | Delete stop (not last) |

**Frontend split:** Library/map pages use **`/api/monthly_sites/...`**; route detail, run details, and worksheet use **`/api/monthly_routes/...`**.

**Office run navigation:** Route detail → **Run details** (`/monthlies/routes/:routeId/runs/:monthIso`, `GET .../run_details`) → technician worksheet. Run details requires a ``MonthlyRouteRun`` row for that month (CSV import, portal, or worksheet materialization)—master-sheet ledger history alone is not enough. The route detail API exposes ``runs_by_month`` (run files) separately from ``testing_by_month`` (sheet ledger counts from ``monthly_route_test_history``).

**Run lock (office completes the job):** A run is editable in the technician portal until office staff press **Complete job** on the **Run details** page (`POST .../runs/complete` sets `status=completed` and `completed_at`). That sets `is_historical` on the worksheet payload and blocks all portal PATCHes (`run_completed_locked`). **Reopen job** on Run details (`POST .../runs/reopen`) clears completion. Technicians no longer use Start/Complete run in the portal — opening the current month's worksheet materializes the run file automatically.

### 5.3 `technician_portal` — `app/routes/technician_portal.py`

| Endpoint | Purpose |
|----------|---------|
| `POST /api/technician_portal/auth` | PIN gate (`TECHNICIAN_PORTAL_PIN`) |
| `GET /api/technician_portal/routes_today` | Routes matching today’s weekday/occurrence |
| `POST /api/technician_portal/routes/<id>/runs` | Start run + materialize history rows and v2 stop months |
| `POST .../runs/complete`, `.../runs/reopen` | Portal run lifecycle |

Auth exemptions: `app/api_auth_gate.py` — portal + regex-matched worksheet paths when `tech_portal_unlocked` session flag is set.

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
| Route inspection CSV | `app/monthly/route_inspection_csv_import.py` → `POST .../runs/import_csv` |
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
| `app/scripts/upload_monthly_sheet.py` | Bulk master sheet → library + history + v2 refresh |
| `app/scripts/backfill_monthly_route_entities.py` | Route entities from TEST DAY classification |
| `app/scripts/backfill_monthly_location_key_id.py` | Key FK backfill on locations |
| `app/scripts/backfill_monthly_route_coordinates.py` | Geocode backfill |
| `app/scripts/audit_keys_multiple_monthly_routes.py` | Audit keys spanning multiple routes |

**Safe wipe order:** `backfill_monthly_key_bridge --execute` → then `wipe_monthly_locations_data --execute`.

---

## 9. Frontend

| File | Role |
|------|------|
| `frontend/src/pages/MonthlyRoutesPage.tsx` | Library (v2 API) |
| `frontend/src/pages/MonthlyRouteDetailPage.tsx` | Route detail; Runs table links to run details |
| `frontend/src/pages/MonthlyRunDetailPage.tsx` | Office run summary (counts, ST techs, comments, audit) → worksheet |
| `frontend/src/pages/MonthlyRoutesMapPage.tsx` | Map view |
| `frontend/src/pages/MonthlyLocationDetailPage.tsx` | Location detail |
| `frontend/src/pages/TechnicianWorksheetPage.tsx` | Office/staff worksheet table + SSE |
| `frontend/src/pages/TechnicianPortalWorksheetPage.tsx` | Portal worksheet (one stop at a time, v2 `stops[]`) |
| `frontend/src/features/monthlyRoutes/usePortalWorksheet.ts` | Portal load/sync/SSE/run lifecycle hook |
| `app/monthly/worksheet_stops.py` | Materialize/serialize/PATCH helpers for portal stops; **run-month snapshots** on read; new months seed from **office master** (+ prior-month fallback); latest-month PATCH mirrors to master |
| `app/monthly/site_field_template.py` | Master template + prior-month merge for seeding new ``MonthlyTestingSiteMonth`` rows |
| `frontend/src/features/monthlyRoutes/monthlyRoutesShared.ts` | Shared types/helpers |
| `frontend/src/features/monthlyRoutes/worksheetOfflineStore.ts` | Offline worksheet support |

Technician flow: `/tech` → `/tech/start` → `/tech/route/:routeId/worksheet/:monthIso`.

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

## 11. Technician field run (current month)

```
/tech PIN → session[tech_portal_unlocked]
  → GET /api/technician_portal/routes_today
  → POST /api/technician_portal/routes/:id/runs
       → MonthlyRouteRun (started_at set)
       → materialize MonthlyRouteTestHistory rows + MonthlyTestingSiteMonth stops
  → GET /api/monthly_routes/routes/:id/worksheet?month=...&tech_portal=1
       → ``stops[]`` (v2 testing-site grain); ``rows[]`` still returned for compatibility
  → PATCH .../worksheet/stops/:testing_site_id
       → MonthlyTestingSiteMonth + dual-write primary location history (audit FK)
  → POST portal .../runs/complete
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
- **New run materialize:** `seed_stop_month_fields` copies display fields from **office master** (`MonthlyTestingSite` / `master_template_fields`), with gaps filled from the **most recent prior** `MonthlyTestingSiteMonth`, then from the **current or prior** `MonthlyRouteTestHistory` row (so an April CSV import carries procedures into May even when no April portal stop rows exist). Outcomes (tested/skipped/times) start empty. **`run_comments` always starts empty** for a new month (never copied from prior month or master).
- **Portal refresh paperwork:** `POST /api/technician_portal/routes/<id>/regenerate_paperwork` re-runs that seeding for the **Pacific current month** when the run is not completed (route hub button). Snapshot fields are overwritten from latest office/prior-run data; times, outcomes, and run comments are preserved. **`POST …/worksheet/reset_run`** still clears field progress only (does not refresh procedures from history).
- **Library location display:** Each `MonthlyTestingSite` master row is the **newest edition** for that testing stop (office edits + mirror from the latest run month when techs PATCH snapshot fields). Primary testing-site values also dual-write to the legacy route location for sheet/detail parity.
- **Portal stop PATCH (latest month only):** Snapshot field edits on the current/latest run mirror to that stop's `MonthlyTestingSite` master via `mirror_mtsm_snapshot_to_primary_master` (`monthly_sites_sync.py`). Primary stops also mirror to the legacy location. Older months never mirror.
- **Office testing-site PATCH:** Updates master directly; the next run seeds from that master.
- **Route CSV import:** Writes snapshot fields to `MonthlyRouteTestHistory` and materializes `MonthlyTestingSiteMonth` stop rows for that month. Legacy location library columns still use `is_latest_history_month_for_location` (`history_sheet_notes.py`).

### Per-testing-site display fields (2026-05)

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
| Monitoring company | `monitoring_company_id` → `monitoring_company` |
| Monitoring notes | `monitoring_notes` |

Run-month copies: **`MonthlyTestingSiteMonth`** (`panel`, `panel_location`, `door_code`, `building_name`, `property_management_company`, `testing_procedures`, `inspection_tech_notes`, `monitoring_notes`, plus existing ring/key/annual).

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

---

## 12. Known gaps and active work

1. **Worksheet grain** — Portal field worksheet uses **one stop per testing site** (`MonthlyTestingSiteMonth`). Office worksheet still **one row per location** (`MonthlyRouteTestHistory`).

2. **Dual schema cutover incomplete** — Legacy `MonthlyRouteLocation` still owns library billing fields (address, status, route assignment, spreadsheet notes). V2 `MonthlyTestingSite` owns per-stop display fields (ring, keys, panel, procedures, price). **Location detail + edit modal** (`MonthlyLocationDetailPage`, `MonthlyLocationLibraryModal`) read/write v2 stops via `GET/PATCH /api/monthly_sites/testing_sites/:id`; primary stop edits dual-write back to legacy for sheet parity.

3. **Portal identity** — No per-tech identity in v1 portal; audit uses `source='technician_app'`.

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

---

## 14. Summary one-liner

**Route-scheduled monthly fire-alarm testing ledger:** Excel routes → Postgres routes; sites in a library; each month technicians fill **run-scoped history rows** per **location** (office) and **stop months** per **testing site** (portal). **V2** adds multi-stop sites and canonical keys on testing sites, with **`monthly_key_bridge`** protecting key associations across wipes.
