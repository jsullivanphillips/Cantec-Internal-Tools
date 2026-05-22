import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, Badge, Button, Modal } from 'react-bootstrap'
import {
  WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE,
  worksheetStopIsOpenClockIn,
  worksheetStopSkipIsAnnual,
  type TechnicianWorksheetStop,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { isPortalWorksheetDemoRoute } from '../features/monthlyRoutes/portalWorksheetDemo'
import { usePortalWorksheet } from '../features/monthlyRoutes/usePortalWorksheet'
import { usePortalWorksheetDemo } from '../features/monthlyRoutes/usePortalWorksheetDemo'
import PortalEditableFieldRow from '../features/monthlyRoutes/PortalEditableFieldRow'
import type { WorksheetStopChangeSet } from '../features/monthlyRoutes/worksheetOfflineStore'
import PortalWorksheetSkeleton from './PortalWorksheetSkeleton'

type StopDisplayStatus = 'pending' | 'in_progress' | 'tested' | 'skipped'

function stopDisplayStatus(stop: TechnicianWorksheetStop): StopDisplayStatus {
  const rs = (stop.result_status || '').trim().toLowerCase()
  if (rs === 'tested') return 'tested'
  if (rs === 'skipped') return 'skipped'
  if (worksheetStopIsOpenClockIn(stop)) return 'in_progress'
  return 'pending'
}

function statusLabel(status: StopDisplayStatus, stop: TechnicianWorksheetStop): string {
  if (status === 'tested') return 'Tested'
  if (status === 'skipped') {
    return worksheetStopSkipIsAnnual(stop) ? 'Annual skip' : 'Skipped'
  }
  if (status === 'in_progress') return 'In progress'
  return 'Pending'
}

function isAnnualMonth(stop: TechnicianWorksheetStop): boolean {
  return (stop.annual_month || '').trim().length > 0
}

function navStopStatusClass(stop: TechnicianWorksheetStop): string {
  if (worksheetStopIsOpenClockIn(stop)) return 'pw-mock-nav-stop--clocked-in'
  const status = stopDisplayStatus(stop)
  if (status === 'tested') return 'pw-mock-nav-stop--tested'
  if (status === 'skipped' && worksheetStopSkipIsAnnual(stop)) return 'pw-mock-nav-stop--annual'
  if (status === 'skipped') return 'pw-mock-nav-stop--skipped'
  if (isAnnualMonth(stop)) return 'pw-mock-nav-stop--annual'
  return ''
}

function headerBandClass(stop: TechnicianWorksheetStop): string {
  const status = stopDisplayStatus(stop)
  if (status === 'tested') return 'pw-mock-header--tested'
  if (status === 'skipped' && worksheetStopSkipIsAnnual(stop)) return 'pw-mock-header--annual'
  if (status === 'skipped') return 'pw-mock-header--skipped'
  if (status === 'in_progress') return 'pw-mock-header--progress'
  if (isAnnualMonth(stop)) return 'pw-mock-header--annual'
  return ''
}

function skipReasonDisplay(stop: TechnicianWorksheetStop): string | null {
  const reason = (stop.skip_reason || '').trim()
  if (!reason) return null
  const low = reason.toLowerCase()
  if (low === 'annual_booked' || low === 'sheet_value') return null
  return reason
}

function FieldRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={`pw-mock-field-row${multiline ? ' pw-mock-field-row--multiline' : ''}`}>
      <div className="pw-mock-field-label">{label}</div>
      <div className="pw-mock-field-value">{value || '—'}</div>
    </div>
  )
}

function syncBadgeVariant(state: string): string {
  if (state === 'synced') return 'success'
  if (state === 'syncing') return 'primary'
  if (state === 'conflict') return 'danger'
  return 'warning'
}

function syncBadgeLabel(state: string, refreshing: boolean): string {
  if (refreshing) return 'Loading…'
  if (state === 'synced') return 'Synced'
  if (state === 'syncing') return 'Syncing…'
  if (state === 'conflict') return 'Conflict'
  return 'Offline'
}

export default function TechnicianPortalWorksheetPage() {
  const { routeId, monthIso } = useParams<{ routeId: string; monthIso: string }>()
  const isDemo = isPortalWorksheetDemoRoute(routeId)
  const idNum = routeId && !isDemo ? parseInt(routeId, 10) : NaN
  const monthQuery = (monthIso || '').trim()

  const liveWorksheet = usePortalWorksheet(idNum, monthQuery)
  const demoWorksheet = usePortalWorksheetDemo(monthQuery)
  const {
    payload,
    stops,
    error,
    monthOk,
    monthHeading,
    portalStartingRun,
    runLifecycleBusy,
    syncState,
    syncMessage,
    clockInBlockedForStop,
    queueStopChanges,
    onPortalStartRun,
    onPortalCompleteRun,
    onPortalReopenRun,
    initialLoading,
    detailRefreshing,
    showStartRun,
    showStopWorkspace,
    showCompleteRun,
    showReopenRun,
    readOnlyWorksheet,
    canEditStops,
    setInteractiveBusy,
    hhmmNow,
  } = isDemo ? demoWorksheet : liveWorksheet

  const [activeId, setActiveId] = useState<number | null>(null)
  const [navExpanded, setNavExpanded] = useState(false)
  const [skipModalOpen, setSkipModalOpen] = useState(false)
  const [skipDraft, setSkipDraft] = useState('')
  const [editingField, setEditingField] = useState<string | null>(null)

  useEffect(() => {
    if (!stops.length) {
      setActiveId(null)
      return
    }
    if (activeId != null && stops.some((s) => s.testing_site_id === activeId)) return
    const firstOpen = stops.find((s) => stopDisplayStatus(s) === 'pending')
    setActiveId((firstOpen ?? stops[0]).testing_site_id)
  }, [stops, activeId])

  const active = useMemo(
    () => stops.find((s) => s.testing_site_id === activeId) ?? stops[0] ?? null,
    [stops, activeId],
  )

  const progress = useMemo(() => {
    const tested = stops.filter((s) => stopDisplayStatus(s) === 'tested').length
    const skipped = stops.filter((s) => stopDisplayStatus(s) === 'skipped').length
    const open = stops.length - tested - skipped
    return { tested, skipped, open, total: stops.length }
  }, [stops])

  useEffect(() => {
    setEditingField(null)
  }, [active?.testing_site_id])

  useEffect(() => {
    setInteractiveBusy(skipModalOpen || editingField != null)
  }, [skipModalOpen, editingField, setInteractiveBusy])

  const applyStopPatch = useCallback(
    (patch: Parameters<typeof queueStopChanges>[1]) => {
      if (!active || !canEditStops) return
      queueStopChanges(active, patch)
    },
    [active, canEditStops, queueStopChanges],
  )

  const clockIn = () => {
    if (!active) return
    if (clockInBlockedForStop(active)) {
      window.alert(WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE)
      return
    }
    applyStopPatch({
      time_in: hhmmNow(),
      time_out: null,
      result_status: null,
      skip_reason: null,
    })
  }

  const clockOut = () => {
    if (!active) return
    applyStopPatch({
      time_out: hhmmNow(),
      result_status: 'tested',
    })
    const idx = stops.findIndex((s) => s.testing_site_id === active.testing_site_id)
    const next = stops.slice(idx + 1).find((s) => stopDisplayStatus(s) === 'pending')
    if (next) setActiveId(next.testing_site_id)
  }

  const applySkip = () => {
    applyStopPatch({
      result_status: 'skipped',
      skip_reason: skipDraft.trim() || 'Skipped',
      time_in: null,
      time_out: null,
    })
    setSkipModalOpen(false)
    setSkipDraft('')
  }

  const saveField = useCallback(
    (field: keyof WorksheetStopChangeSet) => (text: string) => {
      applyStopPatch({ [field]: text.length > 0 ? text : null })
    },
    [applyStopPatch],
  )

  const fieldEditProps = {
    readOnly: readOnlyWorksheet,
    editingField,
    onEditingFieldChange: setEditingField,
  }

  const renderNavStop = (stop: TechnicianWorksheetStop) => {
    const isActive = stop.testing_site_id === activeId
    const statusClass = navStopStatusClass(stop)
    const clockedIn = worksheetStopIsOpenClockIn(stop)
    const activeClass = isActive ? ' pw-mock-nav-stop--active' : ''
    const statusSuffix = statusClass ? ` ${statusClass}` : ''
    const displayStatus = stopDisplayStatus(stop)
    const ring = (stop.ring || '—').trim()
    const key = (stop.key_number || '—').trim()
    const monitoring = (stop.monitoring_company || '—').trim()

    if (!navExpanded) {
      return (
        <button
          key={stop.testing_site_id}
          type="button"
          className={`pw-mock-nav-stop pw-mock-nav-stop--collapsed${statusSuffix}${activeClass}`}
          onClick={() => setActiveId(stop.testing_site_id)}
          title={`#${stop.stop_number} — ${stop.display_address}`}
          aria-label={`Stop ${stop.stop_number}, ${clockedIn ? 'Clocked in' : statusLabel(displayStatus, stop)}`}
          aria-current={isActive ? 'true' : undefined}
        >
          <span className="pw-mock-nav-stop-num">{stop.stop_number}</span>
        </button>
      )
    }

    return (
      <button
        key={stop.testing_site_id}
        type="button"
        className={`pw-mock-nav-stop pw-mock-nav-stop--expanded${statusSuffix}${activeClass}`}
        onClick={() => setActiveId(stop.testing_site_id)}
        aria-current={isActive ? 'true' : undefined}
      >
        <span className="pw-mock-nav-stop-address">{stop.display_address}</span>
        <span className="pw-mock-nav-stop-detail">
          <span className="pw-mock-nav-stop-line">
            <span className="pw-mock-nav-stop-label">Monitoring</span>
            {monitoring}
          </span>
          <span className="pw-mock-nav-stop-line">
            <span className="pw-mock-nav-stop-label">Key</span>
            {key}
          </span>
          <span className="pw-mock-nav-stop-line">
            <span className="pw-mock-nav-stop-label">Ring</span>
            {ring}
          </span>
        </span>
      </button>
    )
  }

  if (!monthOk) {
    return (
      <div className="portal-worksheet-mockup p-3">
        <Alert variant="warning" className="mb-0">
          Invalid worksheet month in URL.
          <Link to="/tech/start" className="ms-2">
            Back to portal
          </Link>
        </Alert>
      </div>
    )
  }

  if (initialLoading) {
    return <PortalWorksheetSkeleton />
  }

  if (error && !payload) {
    return (
      <div className="portal-worksheet-mockup p-3">
        <Alert variant="danger" className="mb-0">
          {error}
          <Link to="/tech/start" className="ms-2">
            Back to portal
          </Link>
        </Alert>
      </div>
    )
  }

  const routeLabel = payload?.route.label || `Route ${payload?.route.route_number ?? routeId}`
  const activeStatus = active ? stopDisplayStatus(active) : 'pending'
  const activeSkipLabel = active ? skipReasonDisplay(active) : null

  return (
    <div className="portal-worksheet-mockup">
      <header className="pw-mock-chrome">
        <div className="pw-mock-chrome-top">
          <Link to="/tech/start" className="btn btn-link text-primary p-0 pw-mock-back" aria-label="Back">
            <i className="bi bi-arrow-left-circle-fill" aria-hidden />
          </Link>
          <div className="pw-mock-chrome-titles">
            <div className="pw-mock-route-title">{routeLabel}</div>
            <div className="pw-mock-route-sub">
              {monthHeading} run · {progress.total} stops
            </div>
          </div>
          <Badge
            bg={isDemo ? 'info' : syncBadgeVariant(detailRefreshing ? 'primary' : syncState)}
            className="pw-mock-sync"
          >
            {isDemo ? 'Demo' : syncBadgeLabel(syncState, detailRefreshing)}
          </Badge>
        </div>
        {isDemo ? (
          <Alert variant="info" className="py-1 px-2 mb-0 small">
            Sample data only — changes are not saved. For showing the new worksheet UI to coworkers.
          </Alert>
        ) : null}
        {syncMessage ? (
          <Alert variant="warning" className="py-1 px-2 mb-0 small">
            {syncMessage}
          </Alert>
        ) : null}
        <div className="pw-mock-chrome-meta">
          <span>
            {progress.tested} tested · {progress.skipped} skipped · {progress.open} open
          </span>
          {showStartRun ? (
            <Button
              size="sm"
              variant="success"
              disabled={portalStartingRun}
              onClick={() => void onPortalStartRun()}
            >
              {portalStartingRun ? (
                <>
                  <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden />
                  Starting…
                </>
              ) : (
                'Start run'
              )}
            </Button>
          ) : showReopenRun ? (
            <Button
              size="sm"
              variant="outline-secondary"
              disabled={runLifecycleBusy}
              onClick={() => void onPortalReopenRun()}
            >
              Reopen run
            </Button>
          ) : showCompleteRun ? (
            <Button
              size="sm"
              variant="outline-success"
              disabled={runLifecycleBusy}
              onClick={() => void onPortalCompleteRun()}
            >
              Complete run
            </Button>
          ) : null}
        </div>
      </header>

      {showStartRun ? (
        <div className="px-3 py-4 text-center text-muted">
          Start the run to clock in and record outcomes for each stop.
        </div>
      ) : null}

      {payload?.run && !showStopWorkspace && !showStartRun && !initialLoading && !detailRefreshing ? (
        <div className="px-3 py-4 text-center text-muted">
          No stops found for this run month.
        </div>
      ) : null}

      {showStopWorkspace && active ? (
        <div className="pw-mock-body">
          <aside
            className={`pw-mock-sidenav${navExpanded ? ' pw-mock-sidenav--expanded' : ' pw-mock-sidenav--collapsed'}`}
          >
            {navExpanded ? (
              <div className="pw-mock-sidenav-head">
                <div className="pw-mock-sidenav-title">Route</div>
                <div className="pw-mock-sidenav-sub">{progress.total} stops</div>
              </div>
            ) : null}
            <div className="pw-mock-sidenav-list">{stops.map((s) => renderNavStop(s))}</div>
            <button
              type="button"
              className="pw-mock-sidenav-toggle"
              aria-expanded={navExpanded}
              onClick={() => setNavExpanded((v) => !v)}
            >
              <i
                className={`bi ${navExpanded ? 'bi-chevron-double-left' : 'bi-chevron-double-right'}`}
                aria-hidden
              />
              {navExpanded ? <span className="pw-mock-sidenav-toggle-label">Collapse menu</span> : null}
            </button>
          </aside>

          <div className="pw-mock-shell">
            {detailRefreshing ? (
              <PortalWorksheetSkeleton detailOnly />
            ) : (
              <>
                <section className="pw-mock-detail">
                  <div className={`pw-mock-header ${headerBandClass(active)}`}>
                    <div className="pw-mock-header-stop">
                      Stop #{active.stop_number}
                      {isAnnualMonth(active) || worksheetStopSkipIsAnnual(active) ? (
                        <span className="pw-mock-annual-pill">Annual month</span>
                      ) : null}
                    </div>
                    <h1 className="pw-mock-header-address">{active.display_address}</h1>
                    {active.building_name ? (
                      <div className="pw-mock-header-line">{active.building_name}</div>
                    ) : null}
                    {active.property_management_company ? (
                      <div className="pw-mock-header-line text-muted">{active.property_management_company}</div>
                    ) : null}
                    {active.label ? (
                      <div className="pw-mock-header-line fw-semibold">{active.label}</div>
                    ) : null}
                    {(active.time_in || active.time_out) && (
                      <div className="pw-mock-header-times">
                        {active.time_in ? <span>Time in {active.time_in}</span> : null}
                        {active.time_out ? <span> · Time out {active.time_out}</span> : null}
                      </div>
                    )}
                    {activeStatus === 'skipped' ? (
                      <div className="pw-mock-header-skip">
                        {activeSkipLabel
                          ? `Skipped: ${activeSkipLabel}`
                          : worksheetStopSkipIsAnnual(active)
                            ? 'Skipped: Annual'
                            : 'Skipped'}
                      </div>
                    ) : null}
                  </div>

                  <div className="pw-mock-fields">
                    <div className="pw-mock-field-group">
                      <div className="pw-mock-field-group-title">Site</div>
                      <PortalEditableFieldRow
                        fieldKey="property_management_company"
                        label="Property management"
                        value={active.property_management_company ?? ''}
                        onSave={saveField('property_management_company')}
                        {...fieldEditProps}
                      />
                      <PortalEditableFieldRow
                        fieldKey="building_name"
                        label="Building"
                        value={active.building_name ?? ''}
                        onSave={saveField('building_name')}
                        {...fieldEditProps}
                      />
                    </div>
                    <div className="pw-mock-field-group">
                      <div className="pw-mock-field-group-title">Access</div>
                      <PortalEditableFieldRow
                        fieldKey="ring"
                        label="Ring"
                        value={active.ring ?? ''}
                        onSave={saveField('ring')}
                        {...fieldEditProps}
                      />
                      <PortalEditableFieldRow
                        fieldKey="key_number"
                        label="Key #"
                        value={active.key_number ?? ''}
                        onSave={saveField('key_number')}
                        {...fieldEditProps}
                      />
                      <PortalEditableFieldRow
                        fieldKey="door_code"
                        label="Door code"
                        value={active.door_code ?? ''}
                        onSave={saveField('door_code')}
                        {...fieldEditProps}
                      />
                      <PortalEditableFieldRow
                        fieldKey="annual_month"
                        label="Annual"
                        value={active.annual_month ?? ''}
                        onSave={saveField('annual_month')}
                        {...fieldEditProps}
                      />
                    </div>
                    <div className="pw-mock-field-group">
                      <div className="pw-mock-field-group-title">Panel</div>
                      <PortalEditableFieldRow
                        fieldKey="panel"
                        label="Panel (make / model)"
                        value={active.panel ?? ''}
                        onSave={saveField('panel')}
                        {...fieldEditProps}
                      />
                      <PortalEditableFieldRow
                        fieldKey="panel_location"
                        label="Panel location"
                        value={active.panel_location ?? ''}
                        onSave={saveField('panel_location')}
                        {...fieldEditProps}
                      />
                    </div>
                    <div className="pw-mock-field-group">
                      <div className="pw-mock-field-group-title">Monitoring</div>
                      <PortalEditableFieldRow
                        fieldKey="monitoring_company"
                        label="Company"
                        value={active.monitoring_company ?? ''}
                        onSave={saveField('monitoring_company')}
                        {...fieldEditProps}
                      />
                      <PortalEditableFieldRow
                        fieldKey="monitoring_notes"
                        label="Notes"
                        value={active.monitoring_notes ?? ''}
                        multiline
                        onSave={saveField('monitoring_notes')}
                        {...fieldEditProps}
                      />
                    </div>
                    <div className="pw-mock-field-group">
                      <div className="pw-mock-field-group-title">Test sheet</div>
                      <PortalEditableFieldRow
                        fieldKey="testing_procedures"
                        label="Testing procedures"
                        value={active.testing_procedures ?? ''}
                        multiline
                        onSave={saveField('testing_procedures')}
                        {...fieldEditProps}
                      />
                      <PortalEditableFieldRow
                        fieldKey="inspection_tech_notes"
                        label="Tech comments & notes"
                        value={active.inspection_tech_notes ?? ''}
                        multiline
                        onSave={saveField('inspection_tech_notes')}
                        {...fieldEditProps}
                      />
                    </div>
                  </div>
                </section>

                <footer className="pw-mock-dock">
                  <Button
                    variant="primary"
                    className="pw-mock-dock-btn"
                    disabled={readOnlyWorksheet || activeStatus === 'tested' || !!active.time_in}
                    onClick={clockIn}
                  >
                    Clock in
                  </Button>
                  <Button
                    variant="primary"
                    className="pw-mock-dock-btn"
                    disabled={readOnlyWorksheet || !active.time_in || !!active.time_out}
                    onClick={clockOut}
                  >
                    Clock out
                  </Button>
                  <Button
                    variant="outline-warning"
                    className="pw-mock-dock-btn"
                    disabled={readOnlyWorksheet || activeStatus === 'tested'}
                    onClick={() => {
                      setSkipDraft(active.skip_reason ?? '')
                      setSkipModalOpen(true)
                    }}
                  >
                    Skip
                  </Button>
                  <Button
                    variant="outline-danger"
                    className="pw-mock-dock-btn"
                    disabled={readOnlyWorksheet}
                    onClick={() => window.alert('Deficiency tracking is not available yet.')}
                  >
                    Deficiency
                  </Button>
                </footer>
              </>
            )}
          </div>
        </div>
      ) : null}

      {active ? (
        <>
          <Modal show={skipModalOpen} onHide={() => setSkipModalOpen(false)} centered>
            <Modal.Header closeButton>
              <Modal.Title>Skip stop #{active.stop_number}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <label className="form-label small" htmlFor="skip-reason">
                Reason
              </label>
              <textarea
                id="skip-reason"
                className="form-control"
                rows={3}
                value={skipDraft}
                onChange={(e) => setSkipDraft(e.target.value)}
              />
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={() => setSkipModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="warning" onClick={applySkip}>
                Confirm skip
              </Button>
            </Modal.Footer>
          </Modal>

        </>
      ) : null}
    </div>
  )
}
