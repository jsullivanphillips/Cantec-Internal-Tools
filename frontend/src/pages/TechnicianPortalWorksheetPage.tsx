import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, Badge, Button, Spinner } from 'react-bootstrap'
import {
  WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE,
  isAnnualForMonth,
  worksheetLocationIsOpenClockIn,
  worksheetLocationSkipIsAnnual,
  type TechnicianWorksheetLocation,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import PortalBlockingOverlay from '../features/monthlyRoutes/PortalBlockingOverlay'
import { usePortalWorksheet } from '../features/monthlyRoutes/usePortalWorksheet'
import {
  isTechnicianDemoRoute,
  resetTechnicianDemoRoute,
  useTechnicianDemoRouteInfo,
} from '../features/monthlyRoutes/technicianDemoRoute'
import PortalEditableFieldRow from '../features/monthlyRoutes/PortalEditableFieldRow'
import {
  schedulePortalFieldRowScrollForElement,
  usePortalFieldEditActionRegistry,
} from '../features/monthlyRoutes/portalFieldEditRegistry'
import PortalMonitoringCompanyField from '../features/monthlyRoutes/PortalMonitoringCompanyField'
import {
  stopMonitoringDisplay,
  stopHasMonitoring,
  stopMonitoringCallPhone,
  monitoringPhoneTelHref,
} from '../features/monthlyRoutes/stopMonitoringDisplay'
import PortalStopSummaryDetail from '../features/monthlyRoutes/PortalStopSummaryDetail'
import PortalBootstrapIcon from '../features/monthlyRoutes/PortalBootstrapIcon'
import { enrichStopsWithMonitoringDirectory } from '../features/monthlyRoutes/monitoringCompaniesShared'
import { useMonitoringCompanies } from '../features/monthlyRoutes/useMonitoringCompanies'
import type { MonitoringCompanySummary } from '../features/monthlyRoutes/monthlyRoutesShared'
import type { WorksheetStopChangeSet } from '../features/monthlyRoutes/worksheetOfflineStore'
import PortalWorksheetSkeleton from './PortalWorksheetSkeleton'
import PortalClockEventsCard from '../features/monthlyRoutes/PortalClockEventsCard'
import PortalSkipModal from '../features/monthlyRoutes/PortalSkipModal'
import PortalMapsChoiceModal from '../features/monthlyRoutes/PortalMapsChoiceModal'
import {
  getPortalMapsProvider,
  openMapsLocation,
  resolveStopMapsTarget,
  setPortalMapsProvider,
  type PortalMapsProvider,
} from '../features/monthlyRoutes/portalMapsLinks'
import PortalEndRunModals from '../features/monthlyRoutes/PortalEndRunModals'
import PortalRecordResultsModal, {
  type RecordResultsCompletePayload,
} from '../features/monthlyRoutes/PortalRecordResultsModal'
import PortalDeficienciesCard from '../features/monthlyRoutes/PortalDeficienciesCard'
import PortalDeficiencyModal from '../features/monthlyRoutes/PortalDeficiencyModal'
import PortalKeyViewModal from '../features/monthlyRoutes/PortalKeyViewModal'
import {
  testingSitePositionAtLocation,
  locationPrimaryLabel,
  LocationHeading,
} from '../features/monthlyRoutes/locationDisplay'
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
const PORTAL_WORKSHEET_PHONE_LAYOUT_MEDIA = '(max-width: 767.98px)'

function stopDisplayStatus(stop: TechnicianWorksheetLocation): StopDisplayStatus {
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
  if (worksheetLocationIsOpenClockIn(stop)) return 'in_progress'
  return 'pending'
}

function statusLabel(status: StopDisplayStatus, stop: TechnicianWorksheetLocation): string {
  const outcomeLabel = portalOutcomeDisplay(stop)
  if (outcomeLabel && portalStopHasTestOutcome(stop)) return outcomeLabel
  if (status === 'tested') return 'Tested'
  if (status === 'skipped') {
    return worksheetLocationSkipIsAnnual(stop) ? 'Annual skip' : 'Skipped'
  }
  if (status === 'in_progress') return 'In progress'
  return 'Pending'
}

function showAnnualMonthPill(
  stop: TechnicianWorksheetLocation,
  runMonthIso: string,
  status: StopDisplayStatus,
): boolean {
  if (portalStopHasTestOutcome(stop)) return false
  if (status === 'skipped') return worksheetLocationSkipIsAnnual(stop)
  return isAnnualForMonth(stop.annual_month, runMonthIso)
}

function skipReasonDisplay(stop: TechnicianWorksheetLocation): string | null {
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

function headerTimesDisplay(stop: TechnicianWorksheetLocation): ReactNode | null {
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
  if (rs === 'skipped' && worksheetLocationSkipIsAnnual(stop)) {
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

function syncBadgeText(state: string): string {
  if (state === 'synced') return 'Synced'
  if (state === 'syncing') return 'Syncing'
  if (state === 'conflict') return 'Conflict'
  if (state === 'saved_offline') return 'Pending sync'
  return 'Offline'
}

function PortalSyncStatusBadge({
  state,
  pendingCount,
}: {
  state: string
  pendingCount: number
}) {
  const showCount =
    pendingCount > 0 && (state === 'syncing' || state === 'saved_offline')
  return (
    <Badge bg={syncBadgeVariant(state)} className="pw-mock-sync">
      <span>{syncBadgeText(state)}</span>
      {showCount ? (
        <span className="pw-mock-sync__count" aria-label={`${pendingCount} queued changes`}>
          {pendingCount}
        </span>
      ) : null}
    </Badge>
  )
}

export default function TechnicianPortalWorksheetPage() {
  const { routeId, monthIso } = useParams<{ routeId: string; monthIso: string }>()
  const idNum = routeId ? parseInt(routeId, 10) : NaN
  const monthQuery = (monthIso || '').trim()

  const routeBackPath = useMemo(() => {
    if (Number.isNaN(idNum)) return '/tech/start'
    return `/tech/route/${idNum}`
  }, [idNum])

  const worksheet = usePortalWorksheet(idNum, monthQuery)
  const { info: demoInfo, refresh: refreshDemoInfo } = useTechnicianDemoRouteInfo()
  const [trainingBannerOpen, setTrainingBannerOpen] = useState(true)
  const [demoResetBusy, setDemoResetBusy] = useState(false)
  const [demoResetError, setDemoResetError] = useState<string | null>(null)
  const [demoResetMessage, setDemoResetMessage] = useState<string | null>(null)
  const [copiedPaperworkLink, setCopiedPaperworkLink] = useState(false)

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
    pendingSyncCount,
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

  const isTrainingRoute = isTechnicianDemoRoute(payload?.route?.route_number)
  const officePaperworkPath =
    demoInfo?.office_paperwork_path ??
    (payload?.route?.id != null && monthQuery
      ? `/monthlies/routes/${payload.route.id}/paperwork?month=${encodeURIComponent(monthQuery)}`
      : null)
  const officePaperworkUrl =
    officePaperworkPath && typeof window !== 'undefined'
      ? `${window.location.origin}${officePaperworkPath}`
      : officePaperworkPath

  const handleCopyPaperworkLink = useCallback(async () => {
    if (!officePaperworkUrl) return
    try {
      await navigator.clipboard.writeText(officePaperworkUrl)
      setCopiedPaperworkLink(true)
      window.setTimeout(() => setCopiedPaperworkLink(false), 2000)
    } catch {
      setDemoResetError('Could not copy the office link — select and copy it manually.')
    }
  }, [officePaperworkUrl])

  const handleResetTrainingData = useCallback(async () => {
    if (
      !window.confirm(
        'Reset training data for this month? This restores the starting scenario for the next class.',
      )
    ) {
      return
    }
    setDemoResetBusy(true)
    setDemoResetError(null)
    setDemoResetMessage(null)
    try {
      await resetTechnicianDemoRoute()
      setDemoResetMessage('Training data reset. Worksheet will refresh shortly.')
      await refreshDemoInfo()
      window.location.reload()
    } catch {
      setDemoResetError('Could not reset training data. Try again or ask the office to run the seed script.')
    } finally {
      setDemoResetBusy(false)
    }
  }, [refreshDemoInfo])

  const { companies: monitoringCompanies, loading: monitoringCompaniesLoading, appendCompany } =
    useMonitoringCompanies()

  const displayStops = useMemo(
    () => enrichStopsWithMonitoringDirectory(projectedStops, monitoringCompanies),
    [projectedStops, monitoringCompanies],
  )

  const [activeId, setActiveId] = useState<number | null>(null)
  const [technicianNoteExpanded, setTechnicianNoteExpanded] = useState(true)
  const [navExpanded, setNavExpanded] = useState(false)
  const [navItemsExpanded, setNavItemsExpanded] = useState(false)
  const [phoneLayout, setPhoneLayout] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PORTAL_WORKSHEET_PHONE_LAYOUT_MEDIA).matches,
  )
  const [keyViewOpen, setKeyViewOpen] = useState(false)
  const [skipModalOpen, setSkipModalOpen] = useState(false)
  const [resultsModalOpen, setResultsModalOpen] = useState(false)
  const [resultsForClockOut, setResultsForClockOut] = useState(false)
  const [defModalOpen, setDefModalOpen] = useState(false)
  const [defModalMode, setDefModalMode] = useState<'add' | 'edit'>('add')
  const [editingDeficiency, setEditingDeficiency] = useState<PortalDeficiencySummary | null>(null)
  const [editingField, setEditingField] = useState<string | null>(null)
  const {
    activeFieldEditActions,
    registerFieldEditActions,
    unregisterFieldEditActions,
  } = usePortalFieldEditActionRegistry(editingField)
  const [mapsChoiceOpen, setMapsChoiceOpen] = useState(false)
  const [mapsPendingStop, setMapsPendingStop] = useState<TechnicianWorksheetLocation | null>(null)

  const openMapsForStop = useCallback(
    (stop: TechnicianWorksheetLocation, forceChoice = false) => {
      if (!resolveStopMapsTarget(stop)) return
      const provider = forceChoice ? null : getPortalMapsProvider()
      if (provider) {
        openMapsLocation(provider, stop)
        return
      }
      setMapsPendingStop(stop)
      setMapsChoiceOpen(true)
    },
    [],
  )

  const handleMapsProviderSelect = useCallback(
    (provider: PortalMapsProvider) => {
      setPortalMapsProvider(provider)
      setMapsChoiceOpen(false)
      if (mapsPendingStop) {
        openMapsLocation(provider, mapsPendingStop)
      }
      setMapsPendingStop(null)
    },
    [mapsPendingStop],
  )

  const handleMapsPinClick = useCallback(
    (event: MouseEvent, stop: TechnicianWorksheetLocation) => {
      event.preventDefault()
      event.stopPropagation()
      openMapsForStop(stop)
    },
    [openMapsForStop],
  )

  const handleMapsPinContextMenu = useCallback(
    (event: MouseEvent, stop: TechnicianWorksheetLocation) => {
      event.preventDefault()
      event.stopPropagation()
      openMapsForStop(stop, true)
    },
    [openMapsForStop],
  )

  const renderMonitoringCallButton = useCallback(
    (stop: TechnicianWorksheetLocation, extraClassName = '') => {
      if (!phoneLayout) return null
      const phone = stopMonitoringCallPhone(stop)
      if (!phone) return null
      const telHref = monitoringPhoneTelHref(phone)
      if (!telHref) return null
      return (
        <a
          href={telHref}
          className={`pw-mock-nav-stop-map pw-mock-nav-stop-call${extraClassName}`}
          aria-label={`Call monitoring for stop ${stop.stop_number}`}
          title={`Call monitoring: ${phone}`}
        >
          <PortalBootstrapIcon name="telephone-fill" className="pw-mock-nav-stop-map-icon" aria-hidden />
        </a>
      )
    },
    [phoneLayout],
  )

  const renderMapsPinButton = useCallback(
    (stop: TechnicianWorksheetLocation, extraClassName = '') => {
      if (!resolveStopMapsTarget(stop)) return null
      return (
        <button
          type="button"
          className={`pw-mock-nav-stop-map${extraClassName}`}
          aria-label={`Open maps for stop ${stop.stop_number}`}
          title="Open in maps (right-click to change maps app)"
          onClick={(event) => handleMapsPinClick(event, stop)}
          onContextMenu={(event) => handleMapsPinContextMenu(event, stop)}
        >
          <PortalBootstrapIcon name="geo-alt" className="pw-mock-nav-stop-map-icon" aria-hidden />
        </button>
      )
    },
    [handleMapsPinClick, handleMapsPinContextMenu],
  )

  const renderHeroDirectionsButton = useCallback(
    (stop: TechnicianWorksheetLocation) => {
      const mapsTarget = resolveStopMapsTarget(stop)
      const monitoringCall = renderMonitoringCallButton(stop, ' pw-mock-header-directions-btn pw-mock-nav-stop--active')
      if (!mapsTarget && !monitoringCall) return null
      return (
        <div className="pw-mock-header-directions">
          {mapsTarget ? (
            <>
              <span className="pw-mock-header-directions-label">Directions</span>
              <button
                type="button"
                className="pw-mock-nav-stop-map pw-mock-header-directions-btn"
                aria-label={`Open directions for stop ${stop.stop_number}`}
                title="Open in maps (right-click to change maps app)"
                onClick={(event) => handleMapsPinClick(event, stop)}
                onContextMenu={(event) => handleMapsPinContextMenu(event, stop)}
              >
                <PortalBootstrapIcon name="geo-alt" className="pw-mock-nav-stop-map-icon" aria-hidden />
              </button>
            </>
          ) : null}
          {monitoringCall}
        </div>
      )
    },
    [handleMapsPinClick, handleMapsPinContextMenu, renderMonitoringCallButton],
  )

  useEffect(() => {
    if (!displayStops.length) {
      setActiveId(null)
      return
    }
    if (activeId != null && displayStops.some((s) => s.location_id === activeId)) return
    const firstOpen = displayStops.find((s) => stopDisplayStatus(s) === 'pending')
    setActiveId((firstOpen ?? displayStops[0]).location_id)
  }, [displayStops, activeId])

  const active = useMemo(
    () => displayStops.find((s) => s.location_id === activeId) ?? displayStops[0] ?? null,
    [displayStops, activeId],
  )

  const activeSitePosition = useMemo(() => {
    if (!active) return { siteCount: 1, siteIndex: 0 }
    return testingSitePositionAtLocation(active, displayStops)
  }, [active, displayStops])

  const runMonthIso = payload?.month_date ?? monthQuery

  const progress = useMemo(() => {
    const tested = projectedStops.filter((s) => stopDisplayStatus(s) === 'tested').length
    const skipped = projectedStops.filter((s) => stopDisplayStatus(s) === 'skipped').length
    const annual = projectedStops.filter(
      (s) =>
        isAnnualForMonth(s.annual_month, runMonthIso) ||
        (stopDisplayStatus(s) === 'skipped' && worksheetLocationSkipIsAnnual(s)),
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
  }, [active?.location_id])

  useLayoutEffect(() => {
    if (!activeFieldEditActions) return undefined
    const row = document.querySelector<HTMLElement>('.pw-mock-field-row--editing')
    return schedulePortalFieldRowScrollForElement(row)
  }, [activeFieldEditActions])

  useEffect(() => {
    setInteractiveBusy(
      keyViewOpen ||
        skipModalOpen ||
        resultsModalOpen ||
        defModalOpen ||
        editingField != null,
    )
  }, [
    keyViewOpen,
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
      if (openClockInStop && openClockInStop.location_id !== active.location_id) {
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

      const projected: TechnicianWorksheetLocation = {
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
        const idx = projectedStops.findIndex((s) => s.location_id === active.location_id)
        const next = projectedStops.slice(idx + 1).find((s) => !portalStopVisitComplete(s))
        if (next) setActiveId(next.location_id)
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

      const idx = stops.findIndex((s) => s.location_id === active.location_id)
      const next = stops.slice(idx + 1).find((s) => !portalStopVisitComplete(s))
      if (next) setActiveId(next.location_id)

      const projected: TechnicianWorksheetLocation = {
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

  const fieldEditProps = {
    readOnly: readOnlyWorksheet,
    editingField,
    onEditingFieldChange: setEditingField,
    onRegisterFieldEditActions: registerFieldEditActions,
    onUnregisterFieldEditActions: unregisterFieldEditActions,
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
      if (!active) return
      void workflowActions.refreshDeficiencies(active, includeHidden)
    },
    [active, workflowActions],
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

  useEffect(() => {
    const mediaQuery = window.matchMedia(PORTAL_WORKSHEET_PHONE_LAYOUT_MEDIA)
    const syncPhoneLayout = () => setPhoneLayout(mediaQuery.matches)
    syncPhoneLayout()
    mediaQuery.addEventListener('change', syncPhoneLayout)
    return () => mediaQuery.removeEventListener('change', syncPhoneLayout)
  }, [])

  const selectStop = useCallback(
    (locationId: number) => {
      setActiveId(locationId)
      if (phoneLayout) setNavExpanded(false)
    },
    [phoneLayout],
  )

  const renderNavStop = (stop: TechnicianWorksheetLocation) => {
    const isActive = stop.location_id === activeId
    const statusClass = portalNavStopStatusClass(stop, runMonthIso)
    const clockedIn = worksheetLocationIsOpenClockIn(stop)
    const activeClass = isActive ? ' pw-mock-nav-stop--active' : ''
    const statusSuffix = statusClass ? ` ${statusClass}` : ''
    const displayStatus = stopDisplayStatus(stop)
    const monitoring = stopMonitoringDisplay(stop)
    const hasMonitoring = stopHasMonitoring(stop)
    const { siteCount, siteIndex } = testingSitePositionAtLocation(stop, displayStops)
    const collapsedTitleParts = [
      `#${stop.stop_number} — ${locationPrimaryLabel(stop, { siteCount, siteIndex, compact: true })}`,
      hasMonitoring || monitoring.phones.length > 0
        ? [
            monitoring.company !== '—' ? monitoring.company : null,
            ...monitoring.phones,
            monitoring.account !== '—' ? `Acct ${monitoring.account}` : null,
            monitoring.password !== '—' ? `PW ${monitoring.password}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : null,
    ].filter(Boolean)

    if (!navItemsExpanded) {
      return (
        <button
          key={stop.location_id}
          type="button"
          className={`pw-mock-nav-stop pw-mock-nav-stop--collapsed${statusSuffix}${activeClass}`}
          onClick={() => selectStop(stop.location_id)}
          title={collapsedTitleParts.join(' · ')}
          aria-label={`Stop ${stop.stop_number}, ${clockedIn ? 'Clocked in' : statusLabel(displayStatus, stop)}`}
          aria-current={isActive ? 'true' : undefined}
        >
          <span className="pw-mock-nav-stop-num">{stop.stop_number}</span>
        </button>
      )
    }

    return (
      <div key={stop.location_id} className="pw-mock-nav-stop-row">
        <button
          type="button"
          className={`pw-mock-nav-stop pw-mock-nav-stop--expanded${statusSuffix}${activeClass}`}
          onClick={() => selectStop(stop.location_id)}
          aria-current={isActive ? 'true' : undefined}
        >
          <span className="pw-mock-nav-stop-address">
            {locationPrimaryLabel(stop, { siteCount, siteIndex, compact: true })}
          </span>
          <PortalStopSummaryDetail stop={stop} />
        </button>
        {resolveStopMapsTarget(stop) ? renderMapsPinButton(stop, activeClass) : null}
        {renderMonitoringCallButton(stop, activeClass)}
      </div>
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
  const technicianNote = (payload?.route.technician_note ?? '').trim()
  const activeStatus = active ? stopDisplayStatus(active) : 'pending'
  const activeSkipLabel = active ? skipReasonDisplay(active) : null
  const activeHeaderTimes = active ? headerTimesDisplay(active) : null
  const dockClassName = [
    'pw-mock-dock',
    dockBand === 'C' ? 'pw-mock-dock--completed' : '',
    activeFieldEditActions ? 'pw-mock-dock--field-editing' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const showAwaitingOfficePrepare =
    !isTrainingRoute &&
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
        onGoToClockedInStop={(locationId) => {
          setActiveId(locationId)
          dismissEndRunModal()
        }}
        onConfirmSkipUntestedAndEnd={() => void confirmSkipUntestedAndEndRun()}
        endRunBusy={runLifecycleBusy}
      />
      <header className="pw-mock-chrome">
        <div
          className={`pw-mock-chrome-top${technicianNote ? ' pw-mock-chrome-top--with-note' : ''}`}
        >
          <div className="pw-mock-chrome-start">
            <Link to={routeBackPath} className="btn btn-link text-primary p-0 pw-mock-back" aria-label="Back to route">
              <PortalBootstrapIcon name="arrow-left-circle-fill" className="pw-mock-back-icon" aria-hidden />
            </Link>
            <div className="pw-mock-chrome-titles">
              <div className="pw-mock-route-title">{routeLabel}</div>
              <div className="pw-mock-route-sub">
                {monthHeading} run · {progress.total} stops
              </div>
            </div>
          </div>
          {technicianNote ? (
            <div className="pw-mock-chrome-center">
              {technicianNoteExpanded ? (
                <div className="pw-mock-tech-note pw-mock-tech-note--expanded">
                  <button
                    type="button"
                    className="pw-mock-tech-note__hide"
                    aria-label="Hide note"
                    onClick={() => setTechnicianNoteExpanded(false)}
                  >
                    ×
                  </button>
                  <div className="pw-mock-tech-note__body">{technicianNote}</div>
                </div>
              ) : (
                <button
                  type="button"
                  className="pw-mock-tech-note pw-mock-tech-note--collapsed"
                  onClick={() => setTechnicianNoteExpanded(true)}
                >
                  Note
                </button>
              )}
            </div>
          ) : null}
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
            {isTrainingRoute ? (
              <Badge bg="info" className="pw-mock-sync">
                Training
              </Badge>
            ) : null}
            <PortalSyncStatusBadge state={syncState} pendingCount={pendingSyncCount} />
          </div>
        </div>
        {isTrainingRoute && trainingBannerOpen ? (
          <Alert variant="info" className="py-2 px-3 mb-0 small">
            <div className="d-flex flex-column flex-md-row align-items-md-start justify-content-between gap-2">
              <div>
                <div className="fw-semibold mb-1">Practice route — safe to tap everything</div>
                <div>
                  Changes save to the server and sync like a real run. Open office paperwork on a
                  laptop to watch live updates during training.
                </div>
                {demoInfo?.training_steps?.length ? (
                  <ul className="mb-0 mt-2 ps-3">
                    {demoInfo.training_steps.slice(0, 3).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="d-flex flex-wrap gap-2 flex-shrink-0">
                {officePaperworkUrl ? (
                  <Button
                    size="sm"
                    variant="outline-info"
                    onClick={() => void handleCopyPaperworkLink()}
                  >
                    {copiedPaperworkLink ? 'Copied!' : 'Copy office link'}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={demoResetBusy}
                  onClick={() => void handleResetTrainingData()}
                >
                  {demoResetBusy ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                      Resetting…
                    </>
                  ) : (
                    'Reset training data'
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="link"
                  className="text-info-emphasis p-0 align-self-center"
                  onClick={() => setTrainingBannerOpen(false)}
                >
                  Hide
                </Button>
              </div>
            </div>
            {demoResetError ? <div className="text-danger mt-2 mb-0">{demoResetError}</div> : null}
            {demoResetMessage ? <div className="mt-2 mb-0">{demoResetMessage}</div> : null}
          </Alert>
        ) : null}
        {!isTrainingRoute || trainingBannerOpen ? null : (
          <div className="px-2 pb-1">
            <Button
              size="sm"
              variant="link"
              className="p-0 small"
              onClick={() => setTrainingBannerOpen(true)}
            >
              Show training tips
            </Button>
          </div>
        )}
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
                <div className="pw-mock-sidenav-head-text">
                  <div className="pw-mock-sidenav-title">{routeLabel}</div>
                  <div className="pw-mock-sidenav-sub">{progress.total} stops</div>
                </div>
                <button
                  type="button"
                  className="pw-mock-sidenav-key-btn"
                  aria-label="Key view"
                  title="Key view"
                  onClick={() => setKeyViewOpen(true)}
                >
                  <PortalBootstrapIcon name="key" className="pw-mock-sidenav-key-btn-icon" aria-hidden />
                </button>
              </div>
            ) : null}
            <div
              className={`pw-mock-sidenav-list${
                navItemsExpanded ? ' pw-mock-sidenav-list--expanded' : ' pw-mock-sidenav-list--collapsed'
              }`}
            >
              {displayStops.map((s) => renderNavStop(s))}
            </div>
            <button
              type="button"
              className="pw-mock-sidenav-toggle"
              aria-expanded={navExpanded}
              onClick={() => setNavExpanded((v) => !v)}
            >
              <PortalBootstrapIcon
                name={navExpanded ? 'chevron-double-left' : 'chevron-double-right'}
                className="pw-mock-sidenav-toggle-icon"
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
                <LocationHeading
                  stop={active}
                  siteCount={activeSitePosition.siteCount}
                  siteIndex={activeSitePosition.siteIndex}
                  compact
                  as="h1"
                  primaryClassName="pw-mock-header-address"
                  sublineClassName="pw-mock-header-line text-muted"
                />
                <div className="pw-mock-header-meta-row">
                  <PortalStopSummaryDetail
                    stop={active}
                    includePanel={!phoneLayout}
                    className="pw-mock-header-detail"
                  />
                  {renderHeroDirectionsButton(active)}
                </div>
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
                      : worksheetLocationSkipIsAnnual(active)
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
                    fieldKey="label"
                    label="Building"
                    value={active.label ?? ''}
                    onSave={saveField('label')}
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
                    fieldKey="monitoring_password"
                    label="Password"
                    value={active.monitoring_password ?? ''}
                    onSave={saveField('monitoring_password')}
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

      {showStopWorkspace && projectedStops.length > 0 ? (
        <PortalKeyViewModal
          show={keyViewOpen}
          onHide={() => setKeyViewOpen(false)}
          stops={projectedStops}
          activeStopId={activeId}
        />
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
          <PortalMapsChoiceModal
            show={mapsChoiceOpen}
            onHide={() => {
              setMapsChoiceOpen(false)
              setMapsPendingStop(null)
            }}
            onSelect={handleMapsProviderSelect}
          />
        </>
      ) : null}
    </div>
  )
}
