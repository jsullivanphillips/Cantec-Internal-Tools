import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Dropdown, Modal, Spinner } from 'react-bootstrap'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import PaperworkRunSelector from '../features/monthlyRoutes/PaperworkRunSelector'
import OfficeSkipRunModal, {
  type OfficeSkipRunPayload,
} from '../features/monthlyRoutes/OfficeSkipRunModal'
import UploadRunFromCsvModal, {
  type UploadRunResponse,
} from '../features/monthlyRoutes/UploadRunFromCsvModal'
import RunDetailsLocationReviewList from '../features/monthlyRoutes/RunDetailsLocationReviewList'
import RunDetailsPreRunMessageCard from '../features/monthlyRoutes/RunDetailsPreRunMessageCard'
import RunDetailsFieldEndSummaryCard from '../features/monthlyRoutes/RunDetailsFieldEndSummaryCard'
import RunWorkflowStepper from '../features/monthlyRoutes/RunWorkflowStepper'
import {
  monthFirstIsoPacificToday,
  parseYearMonth,
  worksheetRunExplicitlyCompleted,
  type MonthlyRunDetailDeficiencySummary,
  type MonthlyRouteDetailPayload,
  type MonthlyRunDetailLocation,
  type MonthlyRunDetailPayload,
  type MonthlySpecialistTechRow,
  type TechnicianWorksheetRun,
  type TechnicianWorksheetLocation,
  routeDisplayLabel,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import {
  computeSelectablePaperworkMonths,
  derivePaperworkViewMode,
  futureMonthPrepBlockedMessage,
  isFutureMonthPrepBlocked,
  resolvePaperworkMonthQuery,
} from '../features/monthlyRoutes/paperworkViewMode'
import {
  deficiencyPatchFromWorksheetStop,
  detailPatchFromWorksheetStop,
} from '../features/monthlyRoutes/runDetailsPrepPatch'
import { syncRunDetailsStopCache } from '../features/monthlyRoutes/useRunDetailsWorksheetStops'
import { useRunDetailsStopPatch } from '../features/monthlyRoutes/useRunDetailsStopPatch'
import { useAnnualScheduleCheck } from '../features/monthlyRoutes/useAnnualScheduleCheck'
import {
  canOfficeCompleteRun,
  canOfficeReturnRunToPrep,
  runInOfficePrepPhase,
  runIsPrepared,
} from '../features/monthlyRoutes/runWorkflowShared'
import {
  patchRunDetailStopDeficiency,
} from '../features/monthlyRoutes/runDetailsPrepPatch'
import {
  patchRunDetailLocationBilling,
  patchRunDetailPayloadRun,
  patchRouteMetaRunMonth,
  patchRunDetailPreRunMessage,
  patchRunDetailFieldEndSummary,
  patchRunDetailLocationStop,
  reorderRunDetailLocations,
  runDetailLocationOrderMatches,
} from '../features/monthlyRoutes/runDetailsLocationReview'
import {
  getCachedFieldSubmission,
  getCachedRunDetails,
  invalidatePaperworkRouteMonth,
  invalidatePaperworkSecondaryCaches,
  setCachedFieldSubmission,
  setCachedRunDetails,
} from '../features/monthlyRoutes/paperworkRouteCache'
import {
  abortPaperworkRunDetailsFetch,
  fetchPaperworkRunDetails,
  prefetchAdjacentPaperworkMonths,
  prefetchPaperworkMonth,
} from '../features/monthlyRoutes/paperworkRoutePrefetch'
import { subscribePaperworkMasterSync } from '../features/monthlyRoutes/paperworkMasterSync'
import { routeRunSummaryFromApi } from '../features/monthlyRoutes/routeRunsDisplay'
import { SERVICE_TRADE_RUN_JOB_MISSING_TITLE } from '../features/monthlyRoutes/ViewServiceTradeRunJobButton'
import { clearWorksheetCache } from '../features/monthlyRoutes/worksheetOfflineStore'
import { apiJson, isAbortError } from '../lib/apiClient'
import MonthlyRunDetailPageSkeleton from './MonthlyRunDetailPageSkeleton'

function formatMonthHeading(monthFirstIso: string): string {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return monthFirstIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

function formatPaperworkLoadError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message
  if (typeof err === 'object' && err != null && 'error' in err) {
    const message = (err as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Failed to load paperwork.'
}

function specialistTechLabel(t: MonthlySpecialistTechRow): string {
  return (t.tech_name || t.name || '').trim() || '—'
}

function completedByTechniciansPillLabel(techs: MonthlySpecialistTechRow[]): string | null {
  const names = techs.map(specialistTechLabel).filter((n) => n !== '—')
  if (!names.length) return null
  return `Completed by ${names.join(', ')}`
}

const RESET_RUN_BUTTON_TOOLTIP =
  'Clears all work logged for this month—test results, times, comments, and billing—and restores a fresh worksheet from the library. Use this to start the month over.'

const REGENERATE_PAPERWORK_BUTTON_TOOLTIP =
  'Rebuilds this month\'s site list from the current route library (adds new buildings, removes cancelled sites, fixes stop order) and clears recorded progress on every stop. Use when the route lineup has changed.'

export default function MonthlyRoutePaperworkPage() {
  const { routeId } = useParams<{ routeId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const idNum = routeId ? parseInt(routeId, 10) : NaN
  const currentMonthIso = monthFirstIsoPacificToday()

  const [routeMeta, setRouteMeta] = useState<MonthlyRouteDetailPayload | null>(null)
  const [routeMetaLoading, setRouteMetaLoading] = useState(true)
  const [payload, setPayload] = useState<MonthlyRunDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runLifecycleAction, setRunLifecycleAction] = useState<
    'prepare' | 'unprepare' | 'complete' | 'reopen' | null
  >(null)
  const [resetRunModalOpen, setResetRunModalOpen] = useState(false)
  const [resetRunBusy, setResetRunBusy] = useState(false)
  const [regenerateLibraryBusy, setRegenerateLibraryBusy] = useState(false)
  const [skipRouteModalOpen, setSkipRouteModalOpen] = useState(false)
  const [skipRouteSubmitting, setSkipRouteSubmitting] = useState(false)
  const [skipRouteError, setSkipRouteError] = useState<string | null>(null)
  const [uploadRunOpen, setUploadRunOpen] = useState(false)
  const [historyStops, setHistoryStops] = useState<TechnicianWorksheetLocation[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyMeta, setHistoryMeta] = useState<{
    capturedAt: string | null
    fieldWorkReopened: boolean
  }>({ capturedAt: null, fieldWorkReopened: false })
  const pendingRunDetailsReloadRef = useRef(false)
  /** Bumped to drop stale ``run_details`` responses (cache-first load vs reopen/reset). */
  const runDetailsFetchSeqRef = useRef(0)
  const runDetailsLoadKeyRef = useRef<string | null>(null)

  const selectableMonths = useMemo(
    () => computeSelectablePaperworkMonths(routeMeta?.runs_by_month ?? {}, currentMonthIso),
    [routeMeta?.runs_by_month, currentMonthIso],
  )

  const monthQuery = useMemo(() => {
    const monthParam = searchParams.get('month')
    if (routeMetaLoading && routeMeta == null) {
      const trimmed = (monthParam ?? '').trim()
      if (trimmed) return trimmed
      return currentMonthIso
    }
    return resolvePaperworkMonthQuery(monthParam, currentMonthIso, selectableMonths)
  }, [searchParams, currentMonthIso, selectableMonths, routeMetaLoading, routeMeta])

  const paperworkViewMode = useMemo(
    () => derivePaperworkViewMode(payload?.run ?? null, monthQuery, currentMonthIso),
    [payload?.run, monthQuery, currentMonthIso],
  )

  const annualScheduleCheckEnabled =
    paperworkViewMode === 'preparation' && Number.isFinite(idNum) && payload != null
  const {
    status: annualScheduleStatus,
    locationsById: annualScheduleByLocationId,
    warningCount: annualScheduleWarningCount,
    error: annualScheduleError,
    refresh: refreshAnnualScheduleCheck,
  } = useAnnualScheduleCheck(idNum, monthQuery, annualScheduleCheckEnabled)

  const futurePrepBlocked = useMemo(
    () => isFutureMonthPrepBlocked(monthQuery, currentMonthIso, routeMeta?.runs_by_month ?? {}),
    [monthQuery, currentMonthIso, routeMeta?.runs_by_month],
  )
  const futurePrepBlockedMessage = useMemo(
    () =>
      futureMonthPrepBlockedMessage(monthQuery, currentMonthIso, routeMeta?.runs_by_month ?? {}),
    [monthQuery, currentMonthIso, routeMeta?.runs_by_month],
  )

  const syncMonthInUrl = useCallback(
    (nextMonth: string) => {
      if (!Number.isFinite(idNum)) return
      const params = new URLSearchParams()
      if (nextMonth !== currentMonthIso) {
        params.set('month', nextMonth)
      }
      const search = params.toString()
      navigate(
        { pathname: `/monthlies/routes/${idNum}/paperwork`, search: search ? `?${search}` : '' },
        { replace: true },
      )
    },
    [idNum, currentMonthIso, navigate],
  )

  useEffect(() => {
    if (routeMetaLoading) return
    const param = searchParams.get('month')
    if (param && param !== monthQuery) {
      syncMonthInUrl(monthQuery)
    }
  }, [searchParams, monthQuery, syncMonthInUrl, routeMetaLoading])

  const loadRouteMeta = useCallback(async (signal?: AbortSignal) => {
    if (!Number.isFinite(idNum)) return
    setRouteMetaLoading(true)
    try {
      const data = await apiJson<MonthlyRouteDetailPayload>(`/api/monthly_routes/routes/${idNum}`, {
        signal,
      })
      setRouteMeta(data)
    } catch (e) {
      if (isAbortError(e)) return
      setRouteMeta(null)
    } finally {
      if (!signal?.aborted) setRouteMetaLoading(false)
    }
  }, [idNum])

  const loadRunDetails = useCallback(
    async (
      signal?: AbortSignal,
      options?: { background?: boolean; force?: boolean },
    ) => {
      if (!Number.isFinite(idNum)) return
      const fetchSeq = ++runDetailsFetchSeqRef.current
      try {
        const data = await fetchPaperworkRunDetails(idNum, monthQuery, {
          signal,
          force: options?.force,
        })
        if (signal?.aborted) return
        if (fetchSeq !== runDetailsFetchSeqRef.current) return
        if (!data) return
        setPayload(data)
        setError(null)
        return data
      } catch (e) {
        if (isAbortError(e)) return
        if (fetchSeq !== runDetailsFetchSeqRef.current) return
        if (!options?.background) throw e
      }
    },
    [idNum, monthQuery],
  )

  const onRouteOrderChanged = useCallback(
    async (orderedLocationIds: number[]) => {
      if (!Number.isFinite(idNum)) return
      setPayload((prev) => {
        if (!prev?.locations?.length) return prev
        if (runDetailLocationOrderMatches(prev.locations, orderedLocationIds)) {
          return prev
        }
        const next = {
          ...prev,
          locations: reorderRunDetailLocations(prev.locations, orderedLocationIds),
        }
        setCachedRunDetails(idNum, monthQuery, next)
        return next
      })
      runDetailsFetchSeqRef.current += 1
      const fetchSeq = runDetailsFetchSeqRef.current
      setRefreshing(true)
      try {
        const data = await fetchPaperworkRunDetails(idNum, monthQuery, { force: true })
        if (fetchSeq !== runDetailsFetchSeqRef.current) return
        if (data) {
          const serverLocations = data.locations ?? []
          const locations = runDetailLocationOrderMatches(serverLocations, orderedLocationIds)
            ? serverLocations
            : reorderRunDetailLocations(serverLocations, orderedLocationIds)
          const merged = { ...data, locations }
          setPayload(merged)
          setError(null)
          setCachedRunDetails(idNum, monthQuery, merged)
        }
      } catch {
        // Optimistic order already applied; background refresh is best-effort.
      } finally {
        if (fetchSeq === runDetailsFetchSeqRef.current) {
          setRefreshing(false)
        }
      }
    },
    [idNum, monthQuery],
  )

  useEffect(() => {
    if (!Number.isFinite(idNum)) return
    const ac = new AbortController()
    void loadRouteMeta(ac.signal)
    return () => ac.abort()
  }, [idNum, loadRouteMeta])

  useEffect(() => {
    if (!Number.isFinite(idNum)) {
      setLoading(false)
      setRefreshing(false)
      setError('Invalid route.')
      return
    }

    const loadKey = `${idNum}:${monthQuery}`
    if (runDetailsLoadKeyRef.current !== loadKey) {
      if (runDetailsLoadKeyRef.current) {
        const [prevId, prevMonth] = runDetailsLoadKeyRef.current.split(':')
        if (prevId && prevMonth) {
          abortPaperworkRunDetailsFetch(Number(prevId), prevMonth)
        }
      }
      runDetailsLoadKeyRef.current = loadKey
      runDetailsFetchSeqRef.current += 1
    }
    const fetchSeq = runDetailsFetchSeqRef.current

    const cached = getCachedRunDetails(idNum, monthQuery)
    const hasCache = cached != null

    if (hasCache) {
      setPayload(cached)
      setLoading(false)
      setError(null)
      setRefreshing(true)
    } else {
      setPayload(null)
      setLoading(true)
      setRefreshing(false)
      setError(null)
    }

    void (async () => {
      try {
        const data = await fetchPaperworkRunDetails(idNum, monthQuery)
        if (fetchSeq !== runDetailsFetchSeqRef.current) return
        if (data) {
          setPayload(data)
          setError(null)
        }
      } catch (e) {
        if (fetchSeq !== runDetailsFetchSeqRef.current) return
        if (!hasCache) {
          setError(formatPaperworkLoadError(e))
          setPayload(null)
        }
      } finally {
        if (fetchSeq === runDetailsFetchSeqRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    })()
  }, [idNum, monthQuery])

  useEffect(() => {
    if (!payload || !Number.isFinite(idNum)) return
    if (payload.month_date !== monthQuery) return
    setCachedRunDetails(idNum, monthQuery, payload)
  }, [payload, idNum, monthQuery])

  useEffect(() => {
    if (!Number.isFinite(idNum) || loading || !payload) return
    if (payload.month_date !== monthQuery) return
    prefetchAdjacentPaperworkMonths(idNum, monthQuery, selectableMonths, currentMonthIso)
  }, [idNum, loading, payload, monthQuery, selectableMonths, currentMonthIso])

  const onMonthHover = useCallback(
    (hoverMonthIso: string) => {
      if (!Number.isFinite(idNum) || hoverMonthIso === monthQuery) return
      prefetchPaperworkMonth(idNum, hoverMonthIso, currentMonthIso)
    },
    [idNum, monthQuery, currentMonthIso],
  )

  useEffect(() => {
    if (!Number.isFinite(idNum)) return
    return subscribePaperworkMasterSync(idNum, () => {
      setRefreshing(true)
      void loadRunDetails(undefined, { background: true }).finally(() => setRefreshing(false))
    })
  }, [idNum, loadRunDetails])

  const loadFieldSubmission = useCallback(
    async (signal?: AbortSignal, options?: { background?: boolean }) => {
      if (!Number.isFinite(idNum)) return
      const qs = new URLSearchParams({ month: monthQuery })
      if (!options?.background) {
        setHistoryLoading(true)
      }
      try {
        const data = await apiJson<{
          stops: TechnicianWorksheetLocation[]
          captured_at: string | null
          field_work_reopened: boolean
        }>(`/api/monthly_routes/routes/${idNum}/run_details/field_submission?${qs.toString()}`, {
          signal,
        })
        if (signal?.aborted) return
        const entry = {
          stops: data.stops ?? [],
          capturedAt: data.captured_at,
          fieldWorkReopened: Boolean(data.field_work_reopened),
        }
        setCachedFieldSubmission(idNum, monthQuery, entry)
        setHistoryStops(entry.stops)
        setHistoryMeta({
          capturedAt: entry.capturedAt,
          fieldWorkReopened: entry.fieldWorkReopened,
        })
      } catch (e) {
        if (isAbortError(e)) return
        if (!options?.background) {
          setHistoryStops([])
          setHistoryMeta({ capturedAt: null, fieldWorkReopened: false })
        }
      } finally {
        if (!signal?.aborted) setHistoryLoading(false)
      }
    },
    [idNum, monthQuery],
  )

  const applyWorkflowRunUpdate = useCallback(
    (run: TechnicianWorksheetRun) => {
      runDetailsFetchSeqRef.current += 1
      if (Number.isFinite(idNum)) {
        abortPaperworkRunDetailsFetch(idNum, monthQuery)
        invalidatePaperworkSecondaryCaches(idNum, monthQuery)
      }
      setPayload((prev) => {
        if (!prev) return prev
        const next = patchRunDetailPayloadRun(prev, run)
        if (Number.isFinite(idNum)) {
          setCachedRunDetails(idNum, monthQuery, next)
        }
        return next
      })
      const runMonth = (run.month_date ?? monthQuery).trim() || monthQuery
      setRouteMeta((prev) => patchRouteMetaRunMonth(prev, runMonth, run))
    },
    [monthQuery, idNum],
  )

  useEffect(() => {
    if (paperworkViewMode !== 'exact_history') {
      setHistoryStops([])
      setHistoryMeta({ capturedAt: null, fieldWorkReopened: false })
      setHistoryLoading(false)
      return
    }
    if (loading) return

    const cached = Number.isFinite(idNum) ? getCachedFieldSubmission(idNum, monthQuery) : null
    if (cached) {
      setHistoryStops(cached.stops)
      setHistoryMeta({
        capturedAt: cached.capturedAt,
        fieldWorkReopened: cached.fieldWorkReopened,
      })
      setHistoryLoading(false)
    } else {
      setHistoryStops([])
      setHistoryMeta({ capturedAt: null, fieldWorkReopened: false })
    }

    const ac = new AbortController()
    void loadFieldSubmission(ac.signal, { background: cached != null })
    return () => ac.abort()
  }, [paperworkViewMode, loadFieldSubmission, loading, idNum, monthQuery])

  const onBillingPatched = useCallback((locationId: number, billingStatus: string) => {
    setPayload((prev) => {
      if (!prev?.locations?.length) return prev
      return {
        ...prev,
        locations: patchRunDetailLocationBilling(
          prev.locations,
          locationId,
          billingStatus,
          prev.month_date,
        ),
      }
    })
  }, [])

  const onPreRunMessagePatched = useCallback((preRunMessage: string | null) => {
    setPayload((prev) => {
      if (!prev?.run) return prev
      return {
        ...prev,
        run: patchRunDetailPreRunMessage(prev.run, preRunMessage),
      }
    })
  }, [])

  const onFieldEndSummaryPatched = useCallback((fieldEndSummary: string | null) => {
    setPayload((prev) => {
      if (!prev?.run) return prev
      return {
        ...prev,
        run: patchRunDetailFieldEndSummary(prev.run, fieldEndSummary),
      }
    })
  }, [])

  const locationsRef = useRef<MonthlyRunDetailPayload['locations']>(undefined)

  const onStopPatched = useCallback(
    (locationId: number, patch: Partial<MonthlyRunDetailLocation>) => {
      setPayload((prev) => {
        if (!prev?.locations?.length) return prev
        const locations = patchRunDetailLocationStop(
          prev.locations,
          locationId,
          prev.month_date,
          patch,
        )
        locationsRef.current = locations
        return { ...prev, locations }
      })
    },
    [],
  )

  useEffect(() => {
    locationsRef.current = payload?.locations
  }, [payload?.locations])

  const getStopSnapshot = useCallback((locationId: number) => {
    return (locationsRef.current ?? []).find((loc) => loc.location_id === locationId)
  }, [])

  const onWorksheetStopSynced = useCallback(
    (stop: TechnicianWorksheetLocation) => {
      if (!Number.isFinite(idNum)) return
      syncRunDetailsStopCache(idNum, monthQuery, stop)
    },
    [idNum, monthQuery],
  )

  const onStopMergedFromWorksheet = useCallback(
    (stop: TechnicianWorksheetLocation, scope: 'full' | 'deficiency' = 'full') => {
      if (!Number.isFinite(idNum)) return
      syncRunDetailsStopCache(idNum, monthQuery, stop)
      const patch =
        scope === 'deficiency'
          ? deficiencyPatchFromWorksheetStop(stop, payload?.run ?? null)
          : detailPatchFromWorksheetStop(stop)
      onStopPatched(stop.location_id, patch)
    },
    [idNum, monthQuery, onStopPatched, payload?.run],
  )

  const stopPatch = useRunDetailsStopPatch({
    routeId: idNum,
    monthDate: monthQuery,
    onStopPatched,
    onWorksheetStopSynced,
    getStopSnapshot,
  })

  const { hasPendingPatches } = stopPatch

  const onDeficiencyUpdated = useCallback(
    async (locationId: number, updated: MonthlyRunDetailDeficiencySummary) => {
      setPayload((prev) => {
        if (!prev?.locations?.length) return prev
        return {
          ...prev,
          locations: patchRunDetailStopDeficiency(
            prev.locations,
            locationId,
            prev.month_date,
            updated,
          ),
        }
      })
    },
    [],
  )

  useEffect(() => {
    if (hasPendingPatches || !pendingRunDetailsReloadRef.current) return
    pendingRunDetailsReloadRef.current = false
    void loadRunDetails(undefined, { background: true })
  }, [hasPendingPatches, loadRunDetails])

  const onMarkPrepared = useCallback(async () => {
    if (!Number.isFinite(idNum)) return
    if (runLifecycleAction != null) return
    setRunLifecycleAction('prepare')
    try {
      await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/monthly_routes/routes/${idNum}/runs/prepare`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month_date: monthQuery }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      invalidatePaperworkRouteMonth(idNum, monthQuery)
      runDetailsFetchSeqRef.current += 1
      abortPaperworkRunDetailsFetch(idNum, monthQuery)
      await loadRunDetails()
      await loadRouteMeta()
    } catch (e) {
      const msg =
        typeof e === 'object' && e != null && 'error' in (e as Record<string, unknown>)
          ? String((e as { error?: unknown }).error)
          : 'Could not mark route prepared. Try again.'
      window.alert(msg)
    } finally {
      setRunLifecycleAction(null)
    }
  }, [idNum, monthQuery, loadRunDetails, loadRouteMeta, runLifecycleAction])

  const onReturnToPrep = useCallback(async () => {
    if (!Number.isFinite(idNum) || !payload?.run) return
    if (runLifecycleAction != null) return
    if (
      !window.confirm(
        'Return this run to prep? Technicians will not be able to start field work until you mark it prepared again.',
      )
    ) {
      return
    }
    setRunLifecycleAction('unprepare')
    try {
      const data = await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/monthly_routes/routes/${idNum}/runs/unprepare`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month_date: monthQuery }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      applyWorkflowRunUpdate(data.run)
    } catch (e) {
      const msg =
        typeof e === 'object' && e != null && 'error' in (e as Record<string, unknown>)
          ? String((e as { error?: unknown }).error)
          : 'Could not return run to prep. Try again.'
      window.alert(msg)
    } finally {
      setRunLifecycleAction(null)
    }
  }, [idNum, monthQuery, payload?.run, applyWorkflowRunUpdate, runLifecycleAction])

  const onCompleteJob = useCallback(async () => {
    if (!Number.isFinite(idNum) || !payload?.run) return
    if (worksheetRunExplicitlyCompleted(payload.run)) return
    if (runLifecycleAction != null) return
    setRunLifecycleAction('complete')
    try {
      const data = await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/monthly_routes/routes/${idNum}/runs/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month_date: monthQuery }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      applyWorkflowRunUpdate(data.run)
    } catch (e) {
      const msg =
        typeof e === 'object' && e != null && 'error' in (e as Record<string, unknown>)
          ? String((e as { error?: unknown }).error)
          : 'Could not complete job. Try again.'
      window.alert(msg)
    } finally {
      setRunLifecycleAction(null)
    }
  }, [idNum, monthQuery, payload?.run, applyWorkflowRunUpdate, runLifecycleAction])

  const onReopenJob = useCallback(async () => {
    if (!Number.isFinite(idNum) || !payload?.run) return
    if (!worksheetRunExplicitlyCompleted(payload.run)) return
    if (runLifecycleAction != null) return
    setRunLifecycleAction('reopen')
    try {
      const data = await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/monthly_routes/routes/${idNum}/runs/reopen`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month_date: monthQuery }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      applyWorkflowRunUpdate(data.run)
    } catch {
      window.alert('Could not reopen job. Try again.')
    } finally {
      setRunLifecycleAction(null)
    }
  }, [idNum, monthQuery, payload?.run, applyWorkflowRunUpdate, runLifecycleAction])

  const onConfirmResetRun = useCallback(async () => {
    if (!Number.isFinite(idNum) || payload?.run == null) return
    if (worksheetRunExplicitlyCompleted(payload.run)) return
    setResetRunBusy(true)
    try {
      const qs = new URLSearchParams({ month: monthQuery })
      await apiJson<{ ok: boolean }>(
        `/api/monthly_routes/routes/${idNum}/worksheet/reset_run?${qs.toString()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'office' }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      invalidatePaperworkRouteMonth(idNum, monthQuery)
      runDetailsFetchSeqRef.current += 1
      abortPaperworkRunDetailsFetch(idNum, monthQuery)
      setResetRunModalOpen(false)
      await loadRunDetails()
      await loadRouteMeta()
    } catch (e) {
      const msg =
        typeof e === 'object' && e != null && 'error' in (e as Record<string, unknown>)
          ? String((e as { error?: unknown }).error)
          : 'Could not reset run.'
      window.alert(msg)
    } finally {
      setResetRunBusy(false)
    }
  }, [idNum, monthQuery, payload?.run, loadRunDetails, loadRouteMeta])

  const onRegenerateFromLibrary = useCallback(async () => {
    if (!Number.isFinite(idNum)) return
    if (regenerateLibraryBusy || runLifecycleAction != null) return
    if (
      !window.confirm(
        'Rebuild this month\'s paperwork from the library route? ' +
          'Adds new stops, removes cancelled or unassigned sites, and applies library stop order. ' +
          'Clears all run progress on remaining stops (outcomes, times, comments, billing, change log) ' +
          '— same scope as Reset run. This cannot be undone.',
      )
    ) {
      return
    }
    setRegenerateLibraryBusy(true)
    try {
      await apiJson<{ stops_regenerated: number; run: TechnicianWorksheetRun }>(
        `/api/monthly_routes/routes/${idNum}/runs/regenerate_prep_stops`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month_date: monthQuery }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      invalidatePaperworkRouteMonth(idNum, monthQuery)
      runDetailsFetchSeqRef.current += 1
      abortPaperworkRunDetailsFetch(idNum, monthQuery)
      await loadRunDetails()
      await loadRouteMeta()
    } catch (e) {
      const msg =
        typeof e === 'object' && e != null && 'error' in (e as Record<string, unknown>)
          ? String((e as { error?: unknown }).error)
          : 'Could not regenerate paperwork. Try again.'
      window.alert(msg)
    } finally {
      setRegenerateLibraryBusy(false)
    }
  }, [idNum, monthQuery, loadRunDetails, loadRouteMeta, regenerateLibraryBusy, runLifecycleAction])

  const openSkipRouteConfirm = useCallback(() => {
    setSkipRouteError(null)
    setSkipRouteModalOpen(true)
  }, [])

  const closeSkipRouteConfirm = useCallback(() => {
    if (skipRouteSubmitting) return
    setSkipRouteModalOpen(false)
    setSkipRouteError(null)
  }, [skipRouteSubmitting])

  const openUploadCsv = useCallback(() => {
    setUploadRunOpen(true)
  }, [])

  const closeUploadCsv = useCallback(() => {
    setUploadRunOpen(false)
  }, [])

  const handleCsvUploaded = useCallback(
    async (result: UploadRunResponse) => {
      if (result.month_date && result.run) {
        const summary = routeRunSummaryFromApi(
          result.run as Parameters<typeof routeRunSummaryFromApi>[0],
        )
        setRouteMeta((prev) =>
          prev
            ? {
                ...prev,
                runs_by_month: { ...prev.runs_by_month, [result.month_date]: summary },
              }
            : prev,
        )
      }
      const uploadedMonth = result.month_date ?? monthQuery
      clearWorksheetCache(idNum, uploadedMonth)
      invalidatePaperworkRouteMonth(idNum, uploadedMonth)
      setUploadRunOpen(false)
      if (result.month_date && result.month_date !== monthQuery) {
        syncMonthInUrl(result.month_date)
        return
      }
      runDetailsFetchSeqRef.current += 1
      await loadRunDetails(undefined, { force: true })
      await loadRouteMeta()
    },
    [idNum, monthQuery, loadRunDetails, loadRouteMeta, syncMonthInUrl],
  )

  const onConfirmSkipRoute = useCallback(
    async (payload: OfficeSkipRunPayload) => {
      if (!Number.isFinite(idNum)) return
      if (skipRouteSubmitting || regenerateLibraryBusy || runLifecycleAction != null) return
      setSkipRouteSubmitting(true)
      setSkipRouteError(null)
      try {
        const data = await apiJson<{
          ok: boolean
          run: TechnicianWorksheetRun
          month_date: string
        }>(
          `/api/monthly_routes/routes/${idNum}/runs/skip?month=${encodeURIComponent(monthQuery)}`,
          {
            method: 'POST',
            body: JSON.stringify(payload),
          },
        )
        clearWorksheetCache(idNum, monthQuery)
        invalidatePaperworkRouteMonth(idNum, monthQuery)
        runDetailsFetchSeqRef.current += 1
        abortPaperworkRunDetailsFetch(idNum, monthQuery)
        applyWorkflowRunUpdate(data.run)
        setSkipRouteModalOpen(false)
        await loadRunDetails()
        await loadRouteMeta()
      } catch (e) {
        const message =
          typeof e === 'object' && e != null && 'error' in e
            ? String((e as { error?: unknown }).error)
            : 'Unable to skip this route.'
        setSkipRouteError(message)
      } finally {
        setSkipRouteSubmitting(false)
      }
    },
    [
      idNum,
      monthQuery,
      skipRouteSubmitting,
      regenerateLibraryBusy,
      runLifecycleAction,
      applyWorkflowRunUpdate,
      loadRunDetails,
      loadRouteMeta,
    ],
  )

  const routeTo = `/monthlies/routes/${idNum}`

  const locations = payload?.locations ?? []
  const prepPhase = paperworkViewMode === 'preparation'

  const onMonthChange = useCallback(
    (nextMonth: string) => {
      syncMonthInUrl(nextMonth)
    },
    [syncMonthInUrl],
  )

  if (!Number.isFinite(idNum)) {
    return (
      <div className="monthly-route-detail-page">
        <div className="monthly-route-detail-container container py-4">
          <Alert variant="warning">Invalid route.</Alert>
          <Link to="/monthlies">Back to Monthlies</Link>
        </div>
      </div>
    )
  }

  if (loading && !payload) {
    return (
      <MonthlyRunDetailPageSkeleton
        label={`Loading paperwork for ${formatMonthHeading(monthQuery)}…`}
      />
    )
  }

  if (error || !payload) {
    return (
      <div className="monthly-route-detail-page">
        <div className="monthly-route-detail-container container py-4">
          <Alert variant="danger">{error || 'Paperwork not found.'}</Alert>
          <Link to={routeTo}>Back to route</Link>
        </div>
      </div>
    )
  }

  const { route, counts, specialists_month, run, service_trade_run_job } = payload
  const routeTitle = routeDisplayLabel(route)
  const monthHeading = formatMonthHeading(payload.month_date)
  const completedByLabel = completedByTechniciansPillLabel(
    specialists_month?.top_technicians ?? [],
  )
  const runCompleted = worksheetRunExplicitlyCompleted(run)
  const showMarkPrepared =
    !runCompleted && (run == null || !runIsPrepared(run)) && !futurePrepBlocked
  const showReturnToPrep = run != null && canOfficeReturnRunToPrep(run)
  const readyPrepLocked = showReturnToPrep
  const showCompleteJob = run != null && !runCompleted && canOfficeCompleteRun(run)
  const showReopenJob = run != null && runCompleted
  const showResetRun = run != null && !runCompleted
  const showRegenerateFromLibrary =
    runInOfficePrepPhase(run) && !runCompleted && !futurePrepBlocked
  const showSkipRoute =
    prepPhase && runInOfficePrepPhase(run) && !runCompleted && !futurePrepBlocked
  const showUploadCsv =
    prepPhase && runInOfficePrepPhase(run) && !runCompleted && !futurePrepBlocked
  const lifecycleBusy = runLifecycleAction != null
  const prepActionBusy = lifecycleBusy || regenerateLibraryBusy || skipRouteSubmitting
  const serviceTradeJobUrl = (service_trade_run_job?.service_trade_job_url || '').trim()
  const hasServiceTradeJob =
    serviceTradeJobUrl.length > 0 && service_trade_run_job?.service_trade_job_id != null
  const serviceTradeJobAriaLabel = `View ServiceTrade job for ${monthHeading}`
  const heroWorkflowActions =
    showMarkPrepared || showReturnToPrep || showReopenJob || showCompleteJob
  const heroPrepActions =
    showSkipRoute || showRegenerateFromLibrary || showResetRun || showUploadCsv

  return (
    <div
      className={`monthly-route-detail-page monthly-run-detail-page monthly-paperwork-page${
        paperworkViewMode === 'exact_history' ? ' monthly-paperwork-page--exact-history' : ''
      }${paperworkViewMode === 'preparation' ? ' monthly-paperwork-page--preparation' : ''}`}
    >
      <div className="monthly-route-detail-container">
        <nav className="monthly-run-detail-breadcrumb" aria-label="Breadcrumb">
          <Link to="/monthlies" className="monthly-location-back-link">
            Monthlies
          </Link>
          <span className="monthly-run-detail-breadcrumb__sep" aria-hidden>
            /
          </span>
          <Link to={routeTo} className="monthly-location-back-link">
            {routeTitle}
          </Link>
        </nav>

        <PaperworkRunSelector
          months={selectableMonths}
          selectedMonthIso={monthQuery}
          currentMonthIso={currentMonthIso}
          refreshing={refreshing}
          onChange={onMonthChange}
          onMonthHover={onMonthHover}
        />

        <section className="monthly-route-detail-hero monthly-location-detail-surface monthly-run-detail-hero monthly-paperwork-hero">
          <div className="monthly-route-detail-hero__copy monthly-paperwork-hero__copy-top">
            <h1 className="monthly-location-detail-title">
              <Link to={routeTo} className="monthly-paperwork-hero__route-title-link">
                {routeTitle}
              </Link>
              <span className="monthly-paperwork-hero__month-ref"> · {monthHeading}</span>
            </h1>
            <RunWorkflowStepper run={run} className="monthly-run-detail-workflow" />
          </div>
          <div className="monthly-route-detail-hero__right">
            <div className="monthly-paperwork-hero__toolbar">
              {prepPhase && annualScheduleWarningCount > 0 ? (
                <Alert
                  variant="warning"
                  className="monthly-paperwork-annual-schedule-warning py-2 small mb-0"
                >
                  {annualScheduleWarningCount} site
                  {annualScheduleWarningCount === 1 ? '' : 's'} need annual schedule review before
                  technicians start.
                </Alert>
              ) : null}
              <div className="monthly-route-detail-actions monthly-paperwork-hero-actions">
              {runCompleted && completedByLabel ? (
                <div
                  className="monthly-paperwork-hero__completed-by"
                  aria-label="ServiceTrade technicians"
                >
                  <Badge bg="light" text="dark" className="monthly-route-pill">
                    {completedByLabel}
                  </Badge>
                </div>
              ) : null}
              <Dropdown align="end" className="monthly-paperwork-hero-actions-dropdown">
                <Dropdown.Toggle
                  variant="outline-secondary"
                  size="sm"
                  className="monthly-location-detail-action"
                  id="monthly-paperwork-hero-actions"
                >
                  <i className="bi bi-three-dots-vertical" aria-hidden />
                  Actions
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  {showMarkPrepared ? (
                    <Dropdown.Item disabled={lifecycleBusy} onClick={() => void onMarkPrepared()}>
                      {runLifecycleAction === 'prepare' ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" aria-hidden />
                          Preparing…
                        </>
                      ) : (
                        'Mark prepared'
                      )}
                    </Dropdown.Item>
                  ) : null}
                  {showReturnToPrep ? (
                    <Dropdown.Item disabled={lifecycleBusy} onClick={() => void onReturnToPrep()}>
                      {runLifecycleAction === 'unprepare' ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" aria-hidden />
                          Returning…
                        </>
                      ) : (
                        'Return to prep'
                      )}
                    </Dropdown.Item>
                  ) : null}
                  {showReopenJob ? (
                    <Dropdown.Item disabled={lifecycleBusy} onClick={() => void onReopenJob()}>
                      {runLifecycleAction === 'reopen' ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" aria-hidden />
                          Reopening…
                        </>
                      ) : (
                        'Reopen job'
                      )}
                    </Dropdown.Item>
                  ) : null}
                  {showCompleteJob ? (
                    <Dropdown.Item disabled={lifecycleBusy} onClick={() => void onCompleteJob()}>
                      {runLifecycleAction === 'complete' ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" aria-hidden />
                          Completing…
                        </>
                      ) : (
                        'Complete'
                      )}
                    </Dropdown.Item>
                  ) : null}
                  {heroPrepActions && heroWorkflowActions ? <Dropdown.Divider /> : null}
                  {showSkipRoute ? (
                    <Dropdown.Item disabled={prepActionBusy} onClick={openSkipRouteConfirm}>
                      Skip route
                    </Dropdown.Item>
                  ) : null}
                  {showRegenerateFromLibrary ? (
                    <Dropdown.Item
                      disabled={prepActionBusy}
                      title={REGENERATE_PAPERWORK_BUTTON_TOOLTIP}
                      onClick={() => void onRegenerateFromLibrary()}
                    >
                      {regenerateLibraryBusy ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" aria-hidden />
                          Regenerating…
                        </>
                      ) : (
                        'Regenerate paperwork'
                      )}
                    </Dropdown.Item>
                  ) : null}
                  {showUploadCsv ? (
                    <Dropdown.Item disabled={prepActionBusy} onClick={openUploadCsv}>
                      Upload CSV
                    </Dropdown.Item>
                  ) : null}
                  {showResetRun ? (
                    <Dropdown.Item
                      className="text-danger"
                      disabled={lifecycleBusy || resetRunBusy}
                      title={RESET_RUN_BUTTON_TOOLTIP}
                      onClick={() => setResetRunModalOpen(true)}
                    >
                      Reset run
                    </Dropdown.Item>
                  ) : null}
                  {heroWorkflowActions || heroPrepActions ? <Dropdown.Divider /> : null}
                  {hasServiceTradeJob ? (
                    <Dropdown.Item
                      href={serviceTradeJobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={serviceTradeJobAriaLabel}
                    >
                      <i className="bi bi-box-arrow-up-right me-2" aria-hidden />
                      View ST Job
                    </Dropdown.Item>
                  ) : (
                    <Dropdown.Item
                      disabled
                      title={SERVICE_TRADE_RUN_JOB_MISSING_TITLE}
                      aria-label={serviceTradeJobAriaLabel}
                    >
                      <i className="bi bi-box-arrow-up-right me-2" aria-hidden />
                      View ST Job
                    </Dropdown.Item>
                  )}
                </Dropdown.Menu>
              </Dropdown>
            </div>
            </div>
            {!runCompleted && completedByLabel ? (
              <div
                className="monthly-route-detail-hero__specialists"
                aria-label="ServiceTrade technicians"
              >
                <Badge bg="light" text="dark" className="monthly-route-pill">
                  {completedByLabel}
                </Badge>
              </div>
            ) : null}
          </div>
          <div className="monthly-paperwork-hero__copy-bottom">
            {futurePrepBlocked && paperworkViewMode === 'preparation' ? (
              <Alert variant="warning" className="py-2 small mb-0 mt-2">
                {futurePrepBlockedMessage ?? 'Close the current month\'s paperwork before preparing a future month.'}{' '}
                <Link
                  to={`/monthlies/routes/${idNum}/paperwork?month=${encodeURIComponent(currentMonthIso)}`}
                  className="alert-link"
                >
                  Open {formatMonthHeading(currentMonthIso)} paperwork
                </Link>
              </Alert>
            ) : null}
            {prepPhase && annualScheduleStatus === 'loading' ? (
              <p className="small text-muted mb-0 mt-2">Checking ServiceTrade annual schedules…</p>
            ) : null}
            {prepPhase && annualScheduleStatus === 'error' && annualScheduleError ? (
              <Alert variant="warning" className="py-2 small mb-0 mt-2">
                {annualScheduleError}{' '}
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 align-baseline"
                  onClick={() => void refreshAnnualScheduleCheck()}
                >
                  Retry
                </Button>
              </Alert>
            ) : null}
          </div>
        </section>

        {prepPhase ? (
          <RunDetailsPreRunMessageCard
            routeId={idNum}
            monthDate={payload.month_date}
            run={run}
            onPreRunMessagePatched={onPreRunMessagePatched}
            prepEditsDisabled={futurePrepBlocked}
            readyEditLocked={readyPrepLocked}
          />
        ) : null}

        {!prepPhase ? (
          <RunDetailsFieldEndSummaryCard
            routeId={idNum}
            monthDate={payload.month_date}
            run={run}
            onFieldEndSummaryPatched={onFieldEndSummaryPatched}
            editsDisabled={runCompleted || paperworkViewMode === 'exact_history'}
            compact={paperworkViewMode === 'exact_history'}
          />
        ) : null}

        {locations.length > 0 ? (
          <RunDetailsLocationReviewList
            locations={locations}
            monthDate={payload.month_date}
            routeId={idNum}
            run={run}
            runCompleted={runCompleted}
            onBillingPatched={onBillingPatched}
            stopPatch={stopPatch}
            onStopMergedFromWorksheet={onStopMergedFromWorksheet}
            onDeficiencyUpdated={onDeficiencyUpdated}
            historyStops={historyStops}
            historyLoading={historyLoading}
            historyCapturedAt={historyMeta.capturedAt}
            historyFieldWorkReopened={historyMeta.fieldWorkReopened}
            onTicketsChanged={() => void loadRunDetails(undefined, { background: true })}
            paperworkViewMode={paperworkViewMode}
            prepEditsDisabled={futurePrepBlocked}
            readyEditLocked={readyPrepLocked}
            onRouteOrderChanged={(orderedLocationIds) => void onRouteOrderChanged(orderedLocationIds)}
            annualScheduleStatus={annualScheduleStatus}
            annualScheduleByLocationId={annualScheduleByLocationId}
            onAnnualScheduleRefresh={() => void refreshAnnualScheduleCheck()}
            outcomeCounts={
              paperworkViewMode === 'run_review'
                ? {
                    all_good_count: counts.all_good_count,
                    passed_with_problems_count: counts.passed_with_problems_count,
                    failed_count: counts.failed_count,
                    skipped_count: counts.skipped_count,
                  }
                : undefined
            }
          />
        ) : (
          <section id="run-review-section" className="monthly-location-detail-surface p-3">
            <p className="monthly-run-detail-empty mb-0">No worksheet locations for this run yet.</p>
          </section>
        )}
      </div>
      <Modal
        show={resetRunModalOpen}
        onHide={() => {
          if (!resetRunBusy) setResetRunModalOpen(false)
        }}
        centered
        backdrop={resetRunBusy ? 'static' : true}
      >
        <Modal.Header closeButton={!resetRunBusy}>
          <Modal.Title className="h6 mb-0">Reset this run?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">
            This clears everything recorded during this run for this month: tested/skipped outcomes,
            clock events, times, run comments, field edits (panel, annual month, access codes, etc.),
            billing status on each site, and the sites-with-updates change log. Worksheet rows are
            restored from the library master.
          </p>
          <p className="mb-0 small text-muted">
            If the job was marked complete, use <strong>Reopen job</strong> first.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" disabled={resetRunBusy} onClick={() => setResetRunModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" disabled={resetRunBusy} onClick={() => void onConfirmResetRun()}>
            {resetRunBusy ? (
              <>
                <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                Resetting…
              </>
            ) : (
              'Yes, reset run'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
      <OfficeSkipRunModal
        show={skipRouteModalOpen}
        monthIso={monthQuery}
        submitting={skipRouteSubmitting}
        error={skipRouteError}
        title="Skip route"
        confirmLabel="Skip route"
        onClose={closeSkipRouteConfirm}
        onConfirm={(payload) => void onConfirmSkipRoute(payload)}
      />
      <UploadRunFromCsvModal
        show={uploadRunOpen}
        onClose={closeUploadCsv}
        routeId={idNum}
        routeNumber={route.route_number}
        routeLabel={routeTitle}
        targetMonthIso={monthQuery}
        onUploaded={(result) => void handleCsvUploaded(result)}
      />
    </div>
  )
}
