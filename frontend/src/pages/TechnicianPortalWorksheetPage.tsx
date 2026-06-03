import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, Badge, Button, Spinner } from 'react-bootstrap'
import {
  WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE,
  isAnnualForMonth,
  worksheetStopIsOpenClockIn,
  worksheetStopSkipIsAnnual,
  type TechnicianWorksheetStop,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { isPortalWorksheetDemoRoute } from '../features/monthlyRoutes/portalWorksheetDemo'
import PortalBlockingOverlay from '../features/monthlyRoutes/PortalBlockingOverlay'
import { usePortalWorksheet } from '../features/monthlyRoutes/usePortalWorksheet'
import { usePortalWorksheetDemo } from '../features/monthlyRoutes/usePortalWorksheetDemo'
import PortalEditableFieldRow, { type PortalFieldEditActions } from '../features/monthlyRoutes/PortalEditableFieldRow'
import PortalMonitoringCompanyField from '../features/monthlyRoutes/PortalMonitoringCompanyField'
import { stopMonitoringDisplay, stopMonitoringSummaryLabel, stopHasMonitoring } from '../features/monthlyRoutes/stopMonitoringDisplay'
import { useMonitoringCompanies } from '../features/monthlyRoutes/useMonitoringCompanies'
import type { MonitoringCompanySummary } from '../features/monthlyRoutes/monthlyRoutesShared'
import type { WorksheetStopChangeSet } from '../features/monthlyRoutes/worksheetOfflineStore'
import PortalWorksheetSkeleton from './PortalWorksheetSkeleton'
import PortalClockEventsCard from '../features/monthlyRoutes/PortalClockEventsCard'
import PortalSkipModal from '../features/monthlyRoutes/PortalSkipModal'
import PortalEndRunModals from '../features/monthlyRoutes/PortalEndRunModals'
import PortalRecordResultsModal, {
  type RecordResultsCompletePayload,
} from '../features/monthlyRoutes/PortalRecordResultsModal'
import PortalDeficienciesCard from '../features/monthlyRoutes/PortalDeficienciesCard'
import PortalDeficiencyModal from '../features/monthlyRoutes/PortalDeficiencyModal'
import {
  portalHeaderBandClass,
  portalNavStopStatusClass,
  portalOutcomeDisplay,
  portalStatusPillClass,
  portalStopCanReset,
  portalStopDockBand,
  optimisticClockOutPatch,
  optimisticOutcomePatch,
  portalStopHasOpenClock,
  portalStopHasTestOutcome,
  portalStopVisitComplete,
  portalStopWorkflowReadOnly,
  skipCategoryLabel,
  type PortalDeficiencySummary,
  type PortalSkipCategory,
} from '../features/monthlyRoutes/portalWorkflowShared'

type StopDisplayStatus = 'pending' | 'in_progress' | 'tested' | 'skipped'

const NAV_EXPAND_TRANSITION_MS = 220

function stopDisplayStatus(stop: TechnicianWorksheetStop): StopDisplayStatus {
  if (portalStopHasTestOutcome(stop)) {
    const outcome = (stop.test_outcome || '').trim().toLowerCase()
    if (outcome === 'skipped') return 'skipped'
    return 'tested'
  }
  if (stop.is_legacy_outcome) {
    const rs = (stop.result_status || '').trim().toLowerCase()
    if (rs === 'tested') return 'tested'
    if (rs === 'skipped') return 'skipped'
  }
  if (worksheetStopIsOpenClockIn(stop)) return 'in_progress'
  return 'pending'
}

function statusLabel(status: StopDisplayStatus, stop: TechnicianWorksheetStop): string {
  const outcomeLabel = portalOutcomeDisplay(stop)
  if (outcomeLabel && portalStopHasTestOutcome(stop)) return outcomeLabel
  if (status === 'tested') return 'Tested'
  if (status === 'skipped') {
    return worksheetStopSkipIsAnnual(stop) ? 'Annual skip' : 'Skipped'
  }
  if (status === 'in_progress') return 'In progress'
  return 'Pending'
}

function showAnnualMonthPill(
  stop: TechnicianWorksheetStop,
  runMonthIso: string,
  status: StopDisplayStatus,
): boolean {
  if (portalStopHasTestOutcome(stop)) return false
  if (status === 'skipped') return worksheetStopSkipIsAnnual(stop)
  return isAnnualForMonth(stop.annual_month, runMonthIso)
}

function skipReasonDisplay(stop: TechnicianWorksheetStop): string | null {
  if (portalStopHasTestOutcome(stop) && (stop.test_outcome || '').toLowerCase() === 'skipped') {
    const cat = skipCategoryLabel(stop.skip_category)
    const note = (stop.skip_note || '').trim()
    if (cat && note) return `${cat} — ${note}`
    if (cat) return cat
    if (note) return note
    return 'Skipped'
  }
  const reason = (stop.skip_reason || '').trim()
  if (!reason) return null
  const low = reason.toLowerCase()
  if (low === 'annual_booked' || low === 'sheet_value') return null
  return reason
}

function headerPanelDisplay(stop: TechnicianWorksheetStop): string | null {
  const makeModel = (stop.panel || '').trim()
  const location = (stop.panel_location || '').trim()
  if (makeModel && location) return `${makeModel} - ${location}`
  if (makeModel) return makeModel
  if (location) return location
  return (stop.label || '').trim() || null
}

function headerMonitoringDisplay(stop: TechnicianWorksheetStop): string {
  return stopMonitoringSummaryLabel(stop)
}

function headerTimesDisplay(stop: TechnicianWorksheetStop): ReactNode | null {
  const events = stop.clock_events ?? []
  if (events.length > 0) {
    const open = events.find((ev) => ev.time_in && !ev.time_out?.trim())
    const last = events[events.length - 1]
    const tin = open?.time_in ?? last?.time_in
    const tout = open ? null : last?.time_out
    if (!tin) return null
    return (
      <>
        <span>Time in {tin}</span>
        {tout?.trim() ? <span> · Time out {tout}</span> : open ? <span> · Clocked in</span> : null}
      </>
    )
  }
  const rs = (stop.result_status || '').trim().toLowerCase()
  if (rs === 'skipped' && worksheetStopSkipIsAnnual(stop)) {
    return <span>ANNUAL</span>
  }
  const tin = (stop.time_in || '').trim()
  const tout = (stop.time_out || '').trim()
  if (!tin && !tout) return null
  if (tin) {
    return (
      <>
        <span>Time in {tin}</span>
        {tout ? <span> · Time out {tout}</span> : null}
      </>
    )
  }
  return tout ? <span>Time out {tout}</span> : null
}

function syncBadgeVariant(state: string): string {
  if (state === 'synced') return 'success'
  if (state === 'syncing') return 'primary'
  if (state === 'conflict') return 'danger'
  return 'warning'
}

function syncBadgeLabel(state: string): string {
  if (state === 'synced') return 'Synced'
  if (state === 'syncing') return 'Syncing…'
  if (state === 'conflict') return 'Conflict'
  if (state === 'saved_offline') return 'Pending sync'
  return 'Offline'
}

export default function TechnicianPortalWorksheetPage() {
  const { routeId, monthIso } = useParams<{ routeId: string; monthIso: string }>()
  const isDemo = isPortalWorksheetDemoRoute(routeId)
  const idNum = routeId && !isDemo ? parseInt(routeId, 10) : NaN
  const monthQuery = (monthIso || '').trim()

  const routeBackPath = useMemo(() => {
    if (isDemo || Number.isNaN(idNum)) return '/tech/start'
    return `/tech/route/${idNum}`
  }, [isDemo, idNum])

  const liveWorksheet = usePortalWorksheet(idNum, monthQuery)
  const demoWorksheet = usePortalWorksheetDemo(monthQuery)
  const worksheet = isDemo ? demoWorksheet : liveWorksheet

  const {
    payload,
    stops,
    projectedStops,
    error,
    monthOk,
    monthHeading,
    runCompleted,
    runEnded,
    runPrepared,
    showStartRun,
    showEndRun,
    showReopenField,
    onPortalStartRun,
    requestPortalEndRun,
    onPortalReopenField,
    endRunModal,
    dismissEndRunModal,
    confirmSkipUntestedAndEndRun,
    portalStartingRun,
    runLifecycleBusy,
    runLifecycleMessage,
    isCurrentMonth,
    viewingHistoricalRun,
    hasRunFile,
    syncState,
    syncMessage,
    clockInBlockedForStop,
    openClockInStop,
    queueStopChanges,
    initialLoading,
    showStopWorkspace,
    readOnlyWorksheet,
    canEditStops,
    setInteractiveBusy,
    workflowActions,
  } = worksheet

  const { companies: monitoringCompanies, loading: monitoringCompaniesLoading, appendCompany } =
    useMonitoringCompanies()

  const [activeId, setActiveId] = useState<number | null>(null)
  const [navExpanded, setNavExpanded] = useState(false)
  const [navItemsExpanded, setNavItemsExpanded] = useState(false)
  const [skipModalOpen, setSkipModalOpen] = useState(false)
  const [resultsModalOpen, setResultsModalOpen] = useState(false)
  const [resultsForClockOut, setResultsForClockOut] = useState(false)
  const [defModalOpen, setDefModalOpen] = useState(false)
  const [defModalMode, setDefModalMode] = useState<'add' | 'edit'>('add')
  const [editingDeficiency, setEditingDeficiency] = useState<PortalDeficiencySummary | null>(null)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [fieldEditActions, setFieldEditActions] = useState<PortalFieldEditActions | null>(null)

  useEffect(() => {
    if (!projectedStops.length) {
      setActiveId(null)
      return
    }
    if (activeId != null && projectedStops.some((s) => s.testing_site_id === activeId)) return
    const firstOpen = projectedStops.find((s) => stopDisplayStatus(s) === 'pending')
    setActiveId((firstOpen ?? projectedStops[0]).testing_site_id)
  }, [projectedStops, activeId])

  const active = useMemo(
    () => projectedStops.find((s) => s.testing_site_id === activeId) ?? projectedStops[0] ?? null,
    [projectedStops, activeId],
  )

  const runMonthIso = payload?.month_date ?? monthQuery

  const progress = useMemo(() => {
    const tested = projectedStops.filter((s) => stopDisplayStatus(s) === 'tested').length
    const skipped = projectedStops.filter((s) => stopDisplayStatus(s) === 'skipped').length
    const annual = projectedStops.filter(
      (s) =>
        isAnnualForMonth(s.annual_month, runMonthIso) ||
        (stopDisplayStatus(s) === 'skipped' && worksheetStopSkipIsAnnual(s)),
    ).length
    const open = projectedStops.length - tested - skipped
    return { tested, skipped, annual, open, total: projectedStops.length }
  }, [projectedStops, runMonthIso])

  const workflowReadOnly = Boolean(
    active &&
      (portalStopWorkflowReadOnly(active, runCompleted) ||
        readOnlyWorksheet ||
        active.portal_read_only),
  )

  const dockBand = active
    ? portalStopDockBand(active, clockInBlockedForStop(active))
    : 'A'

  const outcomeBanner = active ? portalOutcomeDisplay(active) : null

  useEffect(() => {
    setEditingField(null)
    setFieldEditActions(null)
  }, [active?.testing_site_id])

  useEffect(() => {
    setInteractiveBusy(
      skipModalOpen ||
        resultsModalOpen ||
        defModalOpen ||
        editingField != null,
    )
  }, [
    skipModalOpen,
    resultsModalOpen,
    defModalOpen,
    editingField,
    setInteractiveBusy,
  ])

  const applyStopPatch = useCallback(
    (patch: Parameters<typeof queueStopChanges>[1]) => {
      if (!active || !canEditStops) return
      queueStopChanges(active, patch)
    },
    [active, canEditStops, queueStopChanges],
  )

  const handleClockIn = useCallback(() => {
    if (!active || workflowReadOnly) return
    if (clockInBlockedForStop(active)) {
      if (openClockInStop && openClockInStop.testing_site_id !== active.testing_site_id) {
        void workflowActions.transitionClock(openClockInStop, active)
        return
      }
      window.alert(WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE)
      return
    }
    void workflowActions.clockIn(active)
  }, [active, workflowReadOnly, clockInBlockedForStop, openClockInStop, workflowActions])

  const handleRecordResultsComplete = useCallback(
    async ({ outcome, confirmedNoDeficiencies }: RecordResultsCompletePayload) => {
      if (!active) return
      const completeForClockOut = resultsForClockOut
      setResultsModalOpen(false)
      setResultsForClockOut(false)

      const projected: TechnicianWorksheetStop = {
        ...active,
        ...optimisticOutcomePatch(active, outcome, { confirmedNoDeficiencies }),
      }
      void workflowActions.setTestOutcome(active, outcome, { confirmedNoDeficiencies })

      let afterStop = projected
      if (completeForClockOut && portalStopHasOpenClock(projected)) {
        void workflowActions.clockOut(projected)
        afterStop = { ...projected, ...optimisticClockOutPatch(projected) }
      }

      if (!portalStopHasOpenClock(afterStop)) {
        const idx = projectedStops.findIndex((s) => s.testing_site_id === active.testing_site_id)
        const next = projectedStops.slice(idx + 1).find((s) => !portalStopVisitComplete(s))
        if (next) setActiveId(next.testing_site_id)
      }
    },
    [active, workflowActions, projectedStops, resultsForClockOut],
  )

  const handleClockOut = useCallback(() => {
    if (!active || workflowReadOnly) return
    if (!portalStopHasTestOutcome(active)) {
      setResultsForClockOut(true)
      setResultsModalOpen(true)
      return
    }
    void workflowActions.clockOut(active)
  }, [active, workflowReadOnly, workflowActions])

  const handleRecordResultsOpen = useCallback(() => {
    if (!active) return
    if (!portalStopHasOpenClock(active)) {
      window.alert('Clock in before recording results.')
      return
    }
    setResultsForClockOut(false)
    setResultsModalOpen(true)
  }, [active])

  const handleSkipConfirm = useCallback(
    (category: PortalSkipCategory, note: string) => {
      if (!active || workflowReadOnly) return
      setSkipModalOpen(false)

      const idx = stops.findIndex((s) => s.testing_site_id === active.testing_site_id)
      const next = stops.slice(idx + 1).find((s) => !portalStopVisitComplete(s))
      if (next) setActiveId(next.testing_site_id)

      const projected: TechnicianWorksheetStop = {
        ...active,
        ...optimisticOutcomePatch(active, 'skipped', { skipCategory: category, skipNote: note }),
      }
      void workflowActions.setTestOutcome(active, 'skipped', {
        skipCategory: category,
        skipNote: note,
      })
      if (portalStopHasOpenClock(projected)) {
        void workflowActions.clockOut(projected)
      }
    },
    [active, workflowReadOnly, workflowActions, projectedStops],
  )

  const handleReset = useCallback(() => {
    if (!active || workflowReadOnly || !portalStopCanReset(active)) return
    if (
      !window.confirm(
        `Reset stop #${active.stop_number}? This clears clock events, results, and deficiencies logged this run.`,
      )
    ) {
      return
    }
    void workflowActions.resetStop(active)
  }, [active, workflowReadOnly, workflowActions])

  const saveField = useCallback(
    (field: keyof WorksheetStopChangeSet) => (text: string) => {
      applyStopPatch({ [field]: text.length > 0 ? text : null })
    },
    [applyStopPatch],
  )

  const saveMonitoringCompanyId = useCallback(
    (companyId: number | null) => {
      const selected =
        companyId != null ? monitoringCompanies.find((row) => row.id === companyId) ?? null : null
      applyStopPatch({
        monitoring_company_id: companyId,
        monitoring_company: selected?.name?.trim() || null,
        monitoring_company_record: selected,
      })
    },
    [applyStopPatch, monitoringCompanies],
  )

  const handleMonitoringCompanyCreated = useCallback(
    (company: MonitoringCompanySummary) => {
      appendCompany(company)
    },
    [appendCompany],
  )

  const handleFieldEditActionsChange = useCallback((actions: PortalFieldEditActions | null) => {
    setFieldEditActions(actions)
  }, [])

  const fieldEditProps = {
    readOnly: readOnlyWorksheet,
    editingField,
    onEditingFieldChange: setEditingField,
    onEditActionsChange: handleFieldEditActionsChange,
  }

  const openDeficiencyAdd = useCallback(() => {
    setDefModalMode('add')
    setEditingDeficiency(null)
    setDefModalOpen(true)
  }, [])

  const openDeficiencyEdit = useCallback((def: PortalDeficiencySummary) => {
    setDefModalMode('edit')
    setEditingDeficiency(def)
    setDefModalOpen(true)
  }, [])

  const handleDeficiencySave = useCallback(
    (values: { title: string; severity: string; status: string; description: string }) => {
      if (!active || workflowReadOnly) return
      setDefModalOpen(false)
      if (defModalMode === 'add') {
        void workflowActions.createDeficiency(active, {
          title: values.title,
          severity: values.severity,
          status: values.status,
          description: values.description || undefined,
        })
      } else if (editingDeficiency) {
        void workflowActions.updateDeficiency(active, editingDeficiency.id, values)
      }
    },
    [active, workflowReadOnly, defModalMode, editingDeficiency, workflowActions],
  )

  const handleDeficiencyVerify = useCallback(
    (def: PortalDeficiencySummary) => {
      if (!active || workflowReadOnly) return
      void workflowActions.verifyDeficiency(active, def.id)
    },
    [active, workflowReadOnly, workflowActions],
  )

  const handleToggleHiddenDeficiencies = useCallback(
    (includeHidden: boolean) => {
      if (!active || isDemo) return
      void workflowActions.refreshDeficiencies(active, includeHidden)
    },
    [active, isDemo, workflowActions],
  )

  useEffect(() => {
    if (!navExpanded) {
      setNavItemsExpanded(false)
      return undefined
    }
    const timer = window.setTimeout(() => {
      setNavItemsExpanded(true)
    }, NAV_EXPAND_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [navExpanded])

  const renderNavStop = (stop: TechnicianWorksheetStop) => {
    const isActive = stop.testing_site_id === activeId
    const statusClass = portalNavStopStatusClass(stop, runMonthIso)
    const clockedIn = worksheetStopIsOpenClockIn(stop)
    const activeClass = isActive ? ' pw-mock-nav-stop--active' : ''
    const statusSuffix = statusClass ? ` ${statusClass}` : ''
    const displayStatus = stopDisplayStatus(stop)
    const ring = (stop.ring || '—').trim()
    const key = (stop.key_number || '—').trim()
    const monitoring = stopMonitoringDisplay(stop)
    const hasMonitoring = stopHasMonitoring(stop)
    const collapsedTitleParts = [
      `#${stop.stop_number} — ${stop.display_address}`,
      hasMonitoring
        ? [
            monitoring.company !== '—' ? monitoring.company : null,
            monitoring.account !== '—' ? `Acct ${monitoring.account}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : null,
    ].filter(Boolean)

    if (!navItemsExpanded) {
      return (
        <button
          key={stop.testing_site_id}
          type="button"
          className={`pw-mock-nav-stop pw-mock-nav-stop--collapsed${statusSuffix}${activeClass}`}
          onClick={() => setActiveId(stop.testing_site_id)}
          title={collapsedTitleParts.join(' · ')}
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
          {hasMonitoring ? (
            <>
              {monitoring.company !== '—' ? (
                <span className="pw-mock-nav-stop-line">
                  <span className="pw-mock-nav-stop-label">Monitoring</span>
                  {monitoring.company}
                </span>
              ) : null}
              {monitoring.account !== '—' ? (
                <span className="pw-mock-nav-stop-line">
                  <span className="pw-mock-nav-stop-label">Acct</span>
                  {monitoring.account}
                </span>
              ) : null}
            </>
          ) : null}
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

  const renderDockButtons = () => {
    if (!active || workflowReadOnly) return null

    if (dockBand === 'A') {
      return (
        <>
          <Button
            variant="primary"
            className="pw-mock-dock-btn pw-mock-dock-normal-btn"
            onClick={handleClockIn}
          >
            Clock in
          </Button>
          <Button
            variant="outline-warning"
            className="pw-mock-dock-btn pw-mock-dock-normal-btn"
            onClick={() => setSkipModalOpen(true)}
          >
            Skip
          </Button>
        </>
      )
    }

    if (dockBand === 'B') {
      return (
        <>
          <Button
            variant="success"
            className="pw-mock-dock-btn pw-mock-dock-normal-btn"
            onClick={handleRecordResultsOpen}
          >
            Record results
          </Button>
          <Button
            variant="primary"
            className="pw-mock-dock-btn pw-mock-dock-normal-btn"
            onClick={handleClockOut}
          >
            Clock out
          </Button>
          <Button
            variant="outline-danger"
            className="pw-mock-dock-btn pw-mock-dock-normal-btn"
            onClick={openDeficiencyAdd}
          >
            Add deficiency
          </Button>
          <Button
            variant="outline-warning"
            className="pw-mock-dock-btn pw-mock-dock-normal-btn"
            onClick={() => setSkipModalOpen(true)}
          >
            Skip
          </Button>
          {portalStopCanReset(active) ? (
            <Button
              variant="outline-secondary"
              className="pw-mock-dock-btn pw-mock-dock-normal-btn"
              onClick={handleReset}
            >
              Reset
            </Button>
          ) : null}
        </>
      )
    }

    return (
      <>
        <Button
          variant="primary"
          className="pw-mock-dock-btn pw-mock-dock-normal-btn"
          onClick={handleClockIn}
        >
          Clock in again
        </Button>
        {portalStopCanReset(active) ? (
          <Button
            variant="outline-secondary"
            className="pw-mock-dock-btn pw-mock-dock-normal-btn"
            onClick={handleReset}
          >
            Reset
          </Button>
        ) : null}
      </>
    )
  }

  if (!monthOk) {
    return (
      <div className="portal-worksheet-mockup p-3">
        <Alert variant="warning" className="mb-0">
          Invalid worksheet month in URL.
          <Link to={routeBackPath} className="ms-2">
            Back to route
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
          <Link to={routeBackPath} className="ms-2">
            Back to route
          </Link>
        </Alert>
      </div>
    )
  }

  const routeLabel = payload?.route.label || `Route ${payload?.route.route_number ?? routeId}`
  const activeStatus = active ? stopDisplayStatus(active) : 'pending'
  const activeSkipLabel = active ? skipReasonDisplay(active) : null
  const activePanelDisplay = active ? headerPanelDisplay(active) : null
  const activeMonitoringDisplay = active ? headerMonitoringDisplay(active) : 'No Monitoring'
  const activeHeaderTimes = active ? headerTimesDisplay(active) : null
  const activeFieldEditActions =
    editingField && fieldEditActions?.fieldKey === editingField ? fieldEditActions : null
  const dockClassName = [
    'pw-mock-dock',
    dockBand === 'C' ? 'pw-mock-dock--completed' : '',
    activeFieldEditActions ? 'pw-mock-dock--field-editing' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const showAwaitingOfficePrepare =
    !isDemo &&
    isCurrentMonth &&
    !viewingHistoricalRun &&
    hasRunFile &&
    !runPrepared &&
    !runCompleted &&
    (payload?.run?.started_at ?? '').trim().length === 0

  return (
    <div className="portal-worksheet-mockup">
      <PortalBlockingOverlay
        show={portalStartingRun || runLifecycleBusy}
        message={
          portalStartingRun
            ? 'Starting run…'
            : runLifecycleMessage ?? 'Updating run…'
        }
      />
      <PortalEndRunModals
        modal={endRunModal}
        onDismiss={dismissEndRunModal}
        onGoToClockedInStop={(testingSiteId) => {
          setActiveId(testingSiteId)
          dismissEndRunModal()
        }}
        onConfirmSkipUntestedAndEnd={() => void confirmSkipUntestedAndEndRun()}
        endRunBusy={runLifecycleBusy}
      />
      <header className="pw-mock-chrome">
        <div className="pw-mock-chrome-top">
          <Link to={routeBackPath} className="btn btn-link text-primary p-0 pw-mock-back" aria-label="Back to route">
            <i className="bi bi-arrow-left-circle-fill" aria-hidden />
          </Link>
          <div className="pw-mock-chrome-titles">
            <div className="pw-mock-route-title">{routeLabel}</div>
            <div className="pw-mock-route-sub">
              {monthHeading} run · {progress.total} stops
            </div>
          </div>
          <div className="pw-mock-chrome-actions">
            {showStartRun ? (
              <Button
                size="sm"
                variant="primary"
                className="pw-mock-chrome-run-action"
                disabled={portalStartingRun || runLifecycleBusy}
                onClick={() => void onPortalStartRun()}
              >
                {portalStartingRun ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                    Starting…
                  </>
                ) : (
                  'Start run'
                )}
              </Button>
            ) : null}
            {showEndRun ? (
              <Button
                size="sm"
                variant="outline-success"
                className="pw-mock-chrome-run-action"
                disabled={runLifecycleBusy || portalStartingRun}
                onClick={() => void requestPortalEndRun()}
              >
                {runLifecycleBusy && !portalStartingRun ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                    Ending…
                  </>
                ) : (
                  'End field run'
                )}
              </Button>
            ) : null}
            {showReopenField ? (
              <Button
                size="sm"
                variant="outline-warning"
                className="pw-mock-chrome-run-action"
                disabled={runLifecycleBusy || portalStartingRun}
                onClick={() => void onPortalReopenField()}
              >
                {runLifecycleBusy && !portalStartingRun ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                    Reopening…
                  </>
                ) : (
                  'Reopen run'
                )}
              </Button>
            ) : null}
            <Badge
              bg={isDemo ? 'info' : syncBadgeVariant(syncState)}
              className="pw-mock-sync"
            >
              {isDemo ? 'Demo' : syncBadgeLabel(syncState)}
            </Badge>
          </div>
        </div>
        {isDemo ? (
          <Alert variant="info" className="py-1 px-2 mb-0 small">
            Sample data only — changes are not saved. For showing the new worksheet UI to coworkers.
          </Alert>
        ) : null}
        {workflowReadOnly && active?.portal_read_only ? (
          <Alert variant="secondary" className="py-1 px-2 mb-0 small pw-portal-readonly-banner">
            Imported run — view only. Workflow actions are disabled.
          </Alert>
        ) : null}
        {syncMessage ? (
          <Alert variant="warning" className="py-1 px-2 mb-0 small">
            {syncMessage}
          </Alert>
        ) : null}
        <div className="pw-mock-chrome-meta">
          <span>
            {progress.tested} tested · {progress.skipped} skipped · {progress.annual} annual ·{' '}
            {progress.open} open
          </span>
          {runCompleted ? (
            <span className="small text-muted">Job closed by office — contact the office to reopen.</span>
          ) : runEnded ? (
            <span className="small text-muted">Field work ended — use Reopen run to continue testing.</span>
          ) : showAwaitingOfficePrepare ? (
            <span className="small text-muted">
              Waiting for office to release this route — tap Start run once it is prepared.
            </span>
          ) : null}
        </div>
      </header>

      {payload?.run && !showStopWorkspace && !initialLoading ? (
        <div className="px-3 py-4 text-center text-muted">
          No stops found for this run month.
        </div>
      ) : null}

      {showStopWorkspace && active ? (
        <div className="pw-mock-body">
          <aside
            className={`pw-mock-sidenav${navExpanded ? ' pw-mock-sidenav--expanded' : ' pw-mock-sidenav--collapsed'}`}
          >
            {navItemsExpanded ? (
              <div className="pw-mock-sidenav-head">
                <div className="pw-mock-sidenav-title">{routeLabel}</div>
                <div className="pw-mock-sidenav-sub">{progress.total} stops</div>
              </div>
            ) : null}
            <div
              className={`pw-mock-sidenav-list${
                navItemsExpanded ? ' pw-mock-sidenav-list--expanded' : ' pw-mock-sidenav-list--collapsed'
              }`}
            >
              {projectedStops.map((s) => renderNavStop(s))}
            </div>
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
              {navItemsExpanded ? <span className="pw-mock-sidenav-toggle-label">Collapse menu</span> : null}
            </button>
          </aside>

          <div className="pw-mock-shell">
            <section className="pw-mock-detail">
              <div className={`pw-mock-header ${portalHeaderBandClass(active, runMonthIso)}`}>
                <div className="pw-mock-header-top">
                  <div className="pw-mock-header-stop">
                    Stop #{active.stop_number}
                    {showAnnualMonthPill(active, runMonthIso, activeStatus) ? (
                      <span className="pw-mock-annual-pill">Annual month</span>
                    ) : null}
                  </div>
                  <span
                    className={`pw-mock-status-pill pw-mock-status-pill--${portalStatusPillClass(active, runMonthIso)}`}
                  >
                    {statusLabel(activeStatus, active)}
                  </span>
                </div>
                <h1 className="pw-mock-header-address">{active.display_address}</h1>
                {active.building_name ? (
                  <div className="pw-mock-header-line">{active.building_name}</div>
                ) : null}
                <div className="pw-mock-header-line text-muted">{activeMonitoringDisplay}</div>
                {activePanelDisplay ? (
                  <div className="pw-mock-header-line fw-semibold">{activePanelDisplay}</div>
                ) : null}
                {activeHeaderTimes ? (
                  <div className="pw-mock-header-times">{activeHeaderTimes}</div>
                ) : null}
                {dockBand === 'C' && outcomeBanner ? (
                  <div className="pw-portal-outcome-banner">Current result: {outcomeBanner}</div>
                ) : null}
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
                <PortalClockEventsCard stop={active} />
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
                  <div className="pw-mock-access-row">
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
                      monthSelect
                      onSave={saveField('annual_month')}
                      {...fieldEditProps}
                    />
                  </div>
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
                  <PortalMonitoringCompanyField
                    fieldKey="monitoring_company_id"
                    label="Company"
                    companyId={active.monitoring_company_id ?? null}
                    companyName={active.monitoring_company}
                    companyRecord={active.monitoring_company_record}
                    companies={monitoringCompanies}
                    companiesLoading={monitoringCompaniesLoading}
                    onSave={saveMonitoringCompanyId}
                    onCompanyCreated={handleMonitoringCompanyCreated}
                    {...fieldEditProps}
                  />
                  <PortalEditableFieldRow
                    fieldKey="monitoring_account_number"
                    label="Account #"
                    value={active.monitoring_account_number ?? ''}
                    onSave={saveField('monitoring_account_number')}
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
                <PortalDeficienciesCard
                  stop={active}
                  readOnly={workflowReadOnly}
                  onAdd={openDeficiencyAdd}
                  onEdit={openDeficiencyEdit}
                  onVerify={handleDeficiencyVerify}
                  onToggleHidden={handleToggleHiddenDeficiencies}
                />
                <div className="pw-mock-field-group">
                  <div className="pw-mock-field-group-title">Comments</div>
                  {(active.office_job_comment || '').trim() ? (
                    <PortalEditableFieldRow
                      fieldKey="office_job_comment"
                      label="Office job comment"
                      value={active.office_job_comment ?? ''}
                      multiline
                      onSave={async () => {}}
                      {...fieldEditProps}
                      readOnly
                    />
                  ) : null}
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
                    label="Location comments"
                    value={active.inspection_tech_notes ?? ''}
                    multiline
                    onSave={saveField('inspection_tech_notes')}
                    {...fieldEditProps}
                  />
                  <PortalEditableFieldRow
                    fieldKey="run_comments"
                    label="Job comments"
                    value={active.run_comments ?? ''}
                    multiline
                    onSave={saveField('run_comments')}
                    {...fieldEditProps}
                  />
                </div>
              </div>
            </section>

            <footer className={dockClassName}>
              {!workflowReadOnly ? renderDockButtons() : null}
              {activeFieldEditActions ? (
                <>
                  <Button
                    variant="outline-secondary"
                    className="pw-mock-dock-btn pw-mock-dock-edit-btn"
                    onClick={activeFieldEditActions.cancel}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="pw-mock-dock-btn pw-mock-dock-edit-btn"
                    onClick={activeFieldEditActions.save}
                  >
                    Save
                  </Button>
                </>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}

      {active ? (
        <>
          <PortalSkipModal
            show={skipModalOpen}
            stopNumber={active.stop_number}
            onHide={() => setSkipModalOpen(false)}
            onConfirm={handleSkipConfirm}
          />
          <PortalRecordResultsModal
            show={resultsModalOpen}
            stop={active}
            runId={payload?.run?.id ?? null}
            recordAndClockOut={resultsForClockOut}
            workflowActions={workflowActions}
            onHide={() => {
              setResultsModalOpen(false)
              setResultsForClockOut(false)
            }}
            onComplete={(payload) => handleRecordResultsComplete(payload)}
          />
          <PortalDeficiencyModal
            show={defModalOpen}
            mode={defModalMode}
            deficiency={editingDeficiency}
            onHide={() => setDefModalOpen(false)}
            onSave={handleDeficiencySave}
          />
        </>
      ) : null}
    </div>
  )
}
