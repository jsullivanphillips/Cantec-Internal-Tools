# Monthly portal workflow — Phase 1

## Schema
- [x] Alembic: `monthly_stop_clock_event`
- [x] Alembic: MTSM `test_outcome`, `skip_category`, `skip_note`, `confirmed_no_deficiencies`
- [x] Alembic: location-month `billing_status` on `monthly_route_test_history`
- [x] Alembic: `monthly_testing_site_deficiency`
- [x] ORM models in `app/db_models.py`

## Domain (`app/monthly/portal_workflow.py`)
- [x] Clock event CRUD + open-clock route guard
- [x] Test outcome setter + skip category validation
- [x] Billing default + E1 any-billable-stop-on-location
- [x] Deficiency CRUD + quick verify + verification_notes
- [x] Per-stop reset (re-seed, clear run_comments, delete run deficiencies, audit)

## API
- [x] GET/POST session technician + GET cached technicians (+ Shop Tech fallback)
- [x] Clock event endpoints on worksheet stop
- [x] PUT test_outcome endpoint
- [x] Deficiency endpoints + verify
- [x] POST per-stop reset
- [x] Extend worksheet GET `stops[]` payload
- [x] `portal_read_only` for csv_import completed runs

## Compatibility
- [x] Dual-write primary stop → `MonthlyRouteTestHistory`
- [x] Preserve clock/outcome/deficiency/billing on regenerate_paperwork

## Tests
- [x] `tests/test_portal_workflow_api.py` (new)
- [x] Extend `tests/test_worksheet_stops_api.py` for payload fields

## Docs
- [x] Update `docs/monthly-route-testing-system.md`

---

# Monthly portal workflow — Phase 2

## Portal UI core
- [x] `portalWorkflowShared.ts` — dock bands A/B/C, open clock, outcome labels
- [x] Extend `TechnicianWorksheetStop` with Phase 1 GET fields
- [x] Tech picker (`/tech/technician`) + layout gate after PIN
- [x] `usePortalWorkflowActions` + `portalWorkflowSyncQueue` in `worksheetOfflineStore`
- [x] Worksheet dock state machine (remove legacy clock/skip PATCH on dock)
- [x] `PortalClockEventsCard`, `PortalSkipModal`, `PortalRecordResultsModal` (basic)
- [x] `PortalDeficienciesCard` + modal + quick verify; per-stop reset confirm
- [x] Read-only banner when `portal_read_only`
- [x] Demo worksheet data + CSS; `portalWorkflowShared.test.ts`
- [x] Docs addendum + this checklist

## Manual test checklist
1. PIN → pick tech → start route → worksheet.
2. Band A: skip without clock-in; clock-in blocked while clocked into another stop.
3. Band B: clock in → record All good → auto clock-out; clock out with no result opens modal, cancel stays clocked in.
4. Band C: clock in again shows prior result; reset clears stop; skip not shown.
5. Deficiency add + quick verify; invalid/fixed ghost toggle.
6. Airplane mode: clock-in queues and syncs on reconnect.
7. `portal_read_only` run: all workflow actions disabled.

---

# Monthly portal workflow — Phase 3

## Business rules and verify flows
- [x] `validate_test_outcome` in `portal_workflow.py` + API `400` codes
- [x] `portalWorkflowShared` deficiency/outcome helpers + unit tests
- [x] Record Results wizard (choose → verify → confirm_none → saving)
- [x] Worksheet wiring + demo validation + offline queue drops invalid outcomes
- [x] Docs addendum + this checklist

## Manual test checklist
1. Add New deficiency → All good disabled; create while All good → downgrades to Passed with problems.
2. Passed with problems, no deficiencies → confirm dialog → saves with `confirmed_no_deficiencies`.
3. Passed with problems / Failed with prior-run New def → verify step → each Verify → Continue → outcome saved + clock closed.
4. All good with only invalid/fixed hidden defs → allowed (card default view).
5. Cancel wizard from clock-out path → still clocked in.
6. Airplane mode: invalid outcome rejected on sync with clear message.

# Monthly portal workflow — Phase 4

## Office run details
- [x] `run_details_counts_for_route_month` → four `test_outcome` stop counts + API tests
- [x] `set_location_billing_status` + `PATCH .../locations/<id>/billing_status` + tests
- [x] `MonthlyRunDetailCounts` + `officeRunReviewShared` helpers
- [x] `MonthlyRunDetailPage` four KPI tiles + `RunDetailsLocationBillingPanel`
- [x] Run review: outcome filters, billing badges, `confirmed_no_deficiencies` pill
- [x] CSS + docs addendum + this checklist

## Manual test checklist
1. Portal run with mixed outcomes → four KPI counts match stops; KPI click filters run review.
2. Legacy/csv_import run → legacy outcome labels; billing `legacy` read-only (no PATCH).
3. Processor Bill / Do not bill / Unset per location → persists; badge on cards updates.
4. `confirmed_no_deficiencies` visible on relevant stop cards.
5. Complete/reopen job and reset run unchanged.

# Portal clock sync UX (2026-05)

## Implementation
- [x] `portalRouteProjection.ts` + unit tests; projected open-clock in `usePortalWorksheet`
- [x] `mergeWorkflowQueueIntoPayload` on GET/SSE merge; sync badge when queue pending
- [x] Conflict-aware retry + safer `no_open_clock`; enqueue dedupe per stop/action
- [x] `transition_clock` API + queue action; auto-advance + clock-in-while-elsewhere use transition
- [x] Docs addendum in `monthly-route-testing-system.md`

## Manual test checklist
1. Clock out site A → immediately clock in site B (throttled network): no false “already clocked in” alert; UI shows B open; badge “Pending sync” until drained.
2. Record results on A: advances selection to B but does not clock in at B; user taps Clock in at B.
3. Tap **Clock in** on B while A still open on server snapshot: transition runs (no alert).
4. Airplane mode: queue actions; reconnect — state converges without duplicate open clocks.
5. Optional: second browser on same route — alert only when projection shows a true conflict.
