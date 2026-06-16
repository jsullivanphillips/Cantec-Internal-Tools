import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Modal, Spinner } from 'react-bootstrap'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import PaperworkRunSelector from '../features/monthlyRoutes/PaperworkRunSelector'
import OfficeSkipRunModal, {
  type OfficeSkipRunPayload,
} from '../features/monthlyRoutes/OfficeSkipRunModal'
import RunDetailsLocationReviewList from '../features/monthlyRoutes/RunDetailsLocationReviewList'
import RunDetailsPreRunMessageCard from '../features/monthlyRoutes/RunDetailsPreRunMessageCard'
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
} from '../features/monthlyRoutes/monthlyRoutesShared'
import {
  computeSelectablePaperworkMonths,
  derivePaperworkViewMode,
  futureMonthPrepBlockedMessage,
  isFutureMonthPrepBlocked,
  paperworkViewModeLabel,
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

  const { route, counts, specialists_month, run } = payload
  const monthHeading = formatMonthHeading(payload.month_date)
  const viewLabel = paperworkViewModeLabel(paperworkViewMode)
  const completedByLabel = completedByTechniciansPillLabel(
    specialists_month?.top_technicians ?? [],
  )
  const runCompleted = worksheetRunExplicitlyCompleted(run)
  const showMarkPrepared =
    !runCompleted && (run == null || !runIsPrepared(run)) && !futurePrepBlocked
  const showReturnToPrep = run != null && canOfficeReturnRunToPrep(run)
  const showCompleteJob = run != null && !runCompleted && canOfficeCompleteRun(run)
  const showReopenJob = run != null && runCompleted
  const showResetRun = run != null && !runCompleted
  const showRegenerateFromLibrary =
    runInOfficePrepPhase(run) && !runCompleted && !futurePrepBlocked
  const showSkipRoute =
    prepPhase && runInOfficePrepPhase(run) && !runCompleted && !futurePrepBlocked
  const lifecycleBusy = runLifecycleAction != null
  const prepActionBusy = lifecycleBusy || regenerateLibraryBusy || skipRouteSubmitting

  return (
    <div
      className={`monthly-route-detail-page monthly-run-detail-page monthly-paperwork-page${
        paperworkViewMode === 'exact_history' ? ' monthly-paperwork-page--exact-history' : ''
      }`}
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
            {route.label}
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

        <section className="monthly-route-detail-hero monthly-location-detail-surface monthly-run-detail-hero">
          <div className="monthly-route-detail-hero__copy">
            <div className="monthly-location-detail-eyebrow">Paperwork</div>
            <h1 className="monthly-location-detail-title">
              {monthHeading}
              <span className="monthly-run-detail-hero__route-ref"> · {route.label}</span>
            </h1>
            <Badge bg="primary" className="monthly-paperwork-view-badge mb-2">
              Viewing: {viewLabel}
            </Badge>
            <RunWorkflowStepper run={run} className="monthly-run-detail-workflow mb-3" />
            {run == null && paperworkViewMode === 'preparation' ? (
              <p className="small text-muted mb-0 mt-2">
                No run file yet for this month. Review stops below, then mark prepared when
                technicians may start field work.
              </p>
            ) : null}
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
            {prepPhase && annualScheduleWarningCount > 0 ? (
              <Alert variant="warning" className="py-2 small mb-0 mt-2">
                {annualScheduleWarningCount} site
                {annualScheduleWarningCount === 1 ? '' : 's'} need annual schedule review before
                technicians start.
              </Alert>
            ) : null}
          </div>
          <div className="monthly-route-detail-hero__right">
            <div className="monthly-route-detail-actions">
              {showMarkPrepared ? (
                <Button
                  size="sm"
                  variant="outline-primary"
                  className="monthly-location-detail-action"
                  disabled={lifecycleBusy}
                  onClick={() => void onMarkPrepared()}
                >
                  {runLifecycleAction === 'prepare' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                      Preparing…
                    </>
                  ) : (
                    'Mark prepared'
                  )}
                </Button>
              ) : null}
              {showReturnToPrep ? (
                <Button
                  size="sm"
                  variant="outline-secondary"
                  className="monthly-location-detail-action"
                  disabled={lifecycleBusy}
                  onClick={() => void onReturnToPrep()}
                >
                  {runLifecycleAction === 'unprepare' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                      Returning…
                    </>
                  ) : (
                    'Return to prep'
                  )}
                </Button>
              ) : null}
              {showReopenJob ? (
                <Button
                  size="sm"
                  variant="outline-warning"
                  className="monthly-location-detail-action"
                  disabled={lifecycleBusy}
                  onClick={() => void onReopenJob()}
                >
                  {runLifecycleAction === 'reopen' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                      Reopening…
                    </>
                  ) : (
                    'Reopen job'
                  )}
                </Button>
              ) : null}
              {showCompleteJob ? (
                <Button
                  size="sm"
                  variant="success"
                  className="monthly-location-detail-action"
                  disabled={lifecycleBusy}
                  onClick={() => void onCompleteJob()}
                >
                  {runLifecycleAction === 'complete' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                      Completing…
                    </>
                  ) : (
                    'Complete'
                  )}
                </Button>
              ) : null}
              {showRegenerateFromLibrary || showSkipRoute ? (
                <div className="monthly-route-detail-hero__paired-actions">
                  {showSkipRoute ? (
                    <Button
                      size="sm"
                      variant="warning"
                      className="monthly-location-detail-action monthly-route-skip-action"
                      disabled={prepActionBusy}
                      onClick={openSkipRouteConfirm}
                    >
                      Skip route
                    </Button>
                  ) : null}
                  {showRegenerateFromLibrary ? (
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      className="monthly-location-detail-action"
                      disabled={prepActionBusy}
                      onClick={() => void onRegenerateFromLibrary()}
                    >
                      {regenerateLibraryBusy ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                          Regenerating…
                        </>
                      ) : (
                        'Regenerate paperwork'
                      )}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {showResetRun ? (
                <Button
                  size="sm"
                  variant="outline-danger"
                  className="monthly-location-detail-action"
                  disabled={lifecycleBusy || resetRunBusy}
                  onClick={() => setResetRunModalOpen(true)}
                >
                  Reset run
                </Button>
              ) : null}
            </div>
            {completedByLabel ? (
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
        </section>

        {prepPhase ? (
          <RunDetailsPreRunMessageCard
            routeId={idNum}
            monthDate={payload.month_date}
            run={run}
            onPreRunMessagePatched={onPreRunMessagePatched}
            prepEditsDisabled={futurePrepBlocked}
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
    </div>
  )
}
