import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  monthFirstIsoPacificToday,
  parseYearMonth,
  worksheetRunExplicitlyCompleted,
  WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE,
  type TechnicianWorksheetPayload,
  type TechnicianWorksheetStop,
} from './monthlyRoutesShared'
import {
  backoffMs,
  enqueueWorksheetChange,
  hasPendingSyncForRouteMonth,
  loadSyncQueue,
  loadWorkflowSyncQueue,
  loadWorksheetCache,
  applyServerStopWithPending,
  mergePendingChangesIntoPayload,
  mergeServerWorksheetPayload,
  saveSyncQueue,
  saveWorksheetCache,
  type WorksheetStopChangeSet,
} from './worksheetOfflineStore'
import { apiJson, authFailureRedirectPath, isAbortError } from '../../lib/apiClient'
import { runPortalWorkflowSyncQueue } from './portalWorkflowSync'
import {
  projectedClockInBlockedForStop,
  projectedOpenClockStop,
  projectStopsWithWorkflowQueue,
} from './portalRouteProjection'
import { usePortalWorkflowActions } from './usePortalWorkflowActions'

const MONTH_FIRST_RE = /^\d{4}-\d{2}-01$/

export type PortalWorksheetSyncState = 'synced' | 'saved_offline' | 'syncing' | 'conflict'

function hhmmNow(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function formatMonthHeading(monthFirstIso: string): string {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return monthFirstIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

export function usePortalWorksheet(routeId: number, monthIso: string) {
  const monthOk = MONTH_FIRST_RE.test(monthIso) && parseYearMonth(monthIso) != null

  const location = useLocation()
  const fromPriorRun = Boolean(
    (location.state as { fromPriorRun?: boolean } | null)?.fromPriorRun,
  )

  const [payload, setPayload] = useState<TechnicianWorksheetPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [portalStartingRun, setPortalStartingRun] = useState(false)
  const [runLifecycleBusy, setRunLifecycleBusy] = useState(false)
  const [syncState, setSyncState] = useState<PortalWorksheetSyncState>('synced')
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const syncingRef = useRef(false)
  const workflowSyncingRef = useRef(false)
  const triggerWorkflowSyncRef = useRef(() => {})
  const worksheetDeferredRemoteFetchRef = useRef(false)
  const worksheetInteractiveBusyRef = useRef(false)
  const hasLoadedOnceRef = useRef(false)
  const suppressRemoteRefreshUntilRef = useRef(0)

  const stops = useMemo(() => payload?.stops ?? [], [payload?.stops])

  const updateLocalStop = useCallback((testingSiteId: number, patch: WorksheetStopChangeSet) => {
    setPayload((prev) => {
      if (!prev?.stops?.length) return prev
      const nextStops = prev.stops.map((s) =>
        s.testing_site_id === testingSiteId ? { ...s, ...patch } : s,
      )
      const next = { ...prev, stops: nextStops }
      saveWorksheetCache(next)
      return next
    })
  }, [])

  const workflowQueueRevision = useMemo(
    () =>
      loadWorkflowSyncQueue().filter(
        (item) => item.routeId === routeId && item.monthIso === monthIso,
      ).length,
    [stops, syncState, routeId, monthIso],
  )

  const projectedStops = useMemo(
    () => projectStopsWithWorkflowQueue(stops, routeId, monthIso),
    [stops, routeId, monthIso, workflowQueueRevision],
  )

  const openClockInStop = useMemo(() => {
    if (!projectedStops.length) return null
    return projectedOpenClockStop(projectedStops, routeId, monthIso) ?? null
  }, [projectedStops, routeId, monthIso])

  const clockInBlockedForStop = useCallback(
    (stop: TechnicianWorksheetStop): boolean =>
      projectedClockInBlockedForStop(stop, stops, routeId, monthIso),
    [stops, routeId, monthIso, workflowQueueRevision],
  )

  const fetchWorksheet = useCallback(
    async (signal?: AbortSignal, mode: 'initial' | 'background' = 'initial') => {
      if (Number.isNaN(routeId) || !monthOk) {
        setLoading(false)
        return
      }
      const cached = loadWorksheetCache(routeId, monthIso)
      if (cached && !hasLoadedOnceRef.current) {
        setPayload(cached)
        setSyncState(navigator.onLine ? 'synced' : 'saved_offline')
      }
      if (mode === 'initial') {
        setError(null)
      }
      try {
        const qs = new URLSearchParams({ month: monthIso, tech_portal: '1' })
        const data = await apiJson<TechnicianWorksheetPayload>(
          `/api/monthly_routes/routes/${routeId}/worksheet?${qs.toString()}`,
          { signal },
        )
        if (signal?.aborted) return
        const merged = mergePendingChangesIntoPayload(data, routeId, monthIso)
        if (mode === 'background' && hasLoadedOnceRef.current) {
          if (hasPendingSyncForRouteMonth(routeId, monthIso)) {
            return
          }
          setPayload((prev) => {
            const next = prev ? mergeServerWorksheetPayload(prev, merged, routeId, monthIso) : merged
            saveWorksheetCache(next)
            return next
          })
        } else {
          setPayload(merged)
          saveWorksheetCache(merged)
        }
        setSyncState(
          hasPendingSyncForRouteMonth(routeId, monthIso)
            ? navigator.onLine
              ? 'saved_offline'
              : 'saved_offline'
            : 'synced',
        )
        setHasLoadedOnce(true)
        hasLoadedOnceRef.current = true
      } catch (e) {
        if (isAbortError(e)) return
        if (e instanceof Error && e.message === 'portal_auth') return
        if (
          typeof e === 'object' &&
          e != null &&
          'code' in e &&
          ((e as { code?: string }).code === 'auth_required' ||
            (e as { code?: string }).code === 'portal_locked')
        ) {
          window.location.href = authFailureRedirectPath()
          return
        }
        if (mode === 'initial' && !cached) {
          setError('Unable to load worksheet.')
          setSyncState('saved_offline')
        }
      } finally {
        if (!signal?.aborted && mode === 'initial') {
          setLoading(false)
        }
      }
    },
    [routeId, monthOk, monthIso],
  )

  const load = useCallback((signal?: AbortSignal) => fetchWorksheet(signal, 'initial'), [fetchWorksheet])

  const refreshInBackground = useCallback(
    (signal?: AbortSignal) => {
      if (!hasLoadedOnceRef.current) return
      void fetchWorksheet(signal, 'background')
    },
    [fetchWorksheet],
  )

  const refreshInBackgroundRef = useRef(refreshInBackground)
  useEffect(() => {
    refreshInBackgroundRef.current = refreshInBackground
  }, [refreshInBackground])

  const queueStopChanges = useCallback(
    (stop: TechnicianWorksheetStop, changes: WorksheetStopChangeSet) => {
      updateLocalStop(stop.testing_site_id, changes)
      enqueueWorksheetChange({
        routeId,
        testingSiteId: stop.testing_site_id,
        monthIso,
        expectedUpdatedAt: stop.version_updated_at,
        clientMutatedAt: new Date().toISOString(),
        techPortal: true,
        changes,
      })
      setSyncState(navigator.onLine ? 'syncing' : 'saved_offline')
      void runSyncQueueRef.current()
    },
    [routeId, monthIso, updateLocalStop],
  )

  const runSyncQueue = useCallback(async () => {
    if (syncingRef.current || Number.isNaN(routeId) || !monthOk || !navigator.onLine) return
    const queue = loadSyncQueue()
    if (queue.length === 0) {
      setSyncState('synced')
      return
    }
    syncingRef.current = true
    setSyncState('syncing')
    let nextQueue = [...queue]
    for (const item of queue) {
      if (item.nextAttemptAt > Date.now()) continue
      if (item.routeId !== routeId || item.monthIso !== monthIso) continue
      const testingSiteId = item.testingSiteId
      if (testingSiteId == null) continue
      try {
        const qs = new URLSearchParams({ month: item.monthIso, tech_portal: '1' })
        const res = await apiJson<{ stop: TechnicianWorksheetStop }>(
          `/api/monthly_routes/routes/${item.routeId}/worksheet/stops/${testingSiteId}?${qs.toString()}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              expected_updated_at: item.expectedUpdatedAt,
              client_mutation_id: item.id,
              client_mutated_at: item.clientMutatedAt,
              source: 'technician_app',
              changes: item.changes,
            }),
          },
        )
        const mergedStop = applyServerStopWithPending(
          res.stop,
          item.routeId,
          item.monthIso,
          item.id,
        )
        setPayload((prev) => {
          if (!prev?.stops?.length) return prev
          const nextStops = prev.stops.map((s) =>
            s.testing_site_id === testingSiteId ? mergedStop : s,
          )
          const next = { ...prev, stops: nextStops }
          saveWorksheetCache(next)
          return next
        })
        suppressRemoteRefreshUntilRef.current = Date.now() + 2500
        nextQueue = nextQueue
          .filter((q) => q.id !== item.id)
          .map((q) =>
            q.routeId === item.routeId &&
            q.monthIso === item.monthIso &&
            q.testingSiteId === testingSiteId
              ? { ...q, expectedUpdatedAt: mergedStop.version_updated_at }
              : q,
          )
      } catch (e) {
        const maybeErr = e as { error?: unknown; conflict?: { message?: string } }
        if (maybeErr?.error === 'conflict' || maybeErr?.conflict) {
          setSyncState('conflict')
          setSyncMessage('A server conflict needs manual review for one or more stops.')
          syncingRef.current = false
          return
        }
        if (
          typeof maybeErr === 'object' &&
          maybeErr != null &&
          'code' in (maybeErr as Record<string, unknown>) &&
          (maybeErr as { code?: string }).code === 'open_clock_in_conflict'
        ) {
          window.alert(WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE)
        }
        nextQueue = nextQueue.map((q) =>
          q.id !== item.id
            ? q
            : {
                ...q,
                attempts: q.attempts + 1,
                nextAttemptAt: Date.now() + backoffMs(q.attempts + 1),
              },
        )
      }
    }
    saveSyncQueue(nextQueue)
    syncingRef.current = false
    const workflowPending = loadWorkflowSyncQueue().some(
      (item) => item.routeId === routeId && item.monthIso === monthIso,
    )
    setSyncState(nextQueue.length > 0 || workflowPending ? 'saved_offline' : 'synced')
    if (!nextQueue.length) {
      void runWorkflowSyncQueueRef.current()
    }
  }, [routeId, monthOk, monthIso])

  const runSyncQueueRef = useRef(runSyncQueue)
  useEffect(() => {
    runSyncQueueRef.current = runSyncQueue
  }, [runSyncQueue])

  const runWorkflowSyncQueue = useCallback(async () => {
    if (Number.isNaN(routeId) || !monthOk) return
    await runPortalWorkflowSyncQueue(
      {
        routeId,
        monthIso,
        setPayload,
        setSyncState,
        suppressRemoteRefreshUntilRef,
      },
      workflowSyncingRef,
    )
  }, [routeId, monthOk, monthIso])

  const runWorkflowSyncQueueRef = useRef(runWorkflowSyncQueue)
  useEffect(() => {
    runWorkflowSyncQueueRef.current = runWorkflowSyncQueue
  }, [runWorkflowSyncQueue])

  triggerWorkflowSyncRef.current = () => {
    void runWorkflowSyncQueueRef.current()
  }

  const workflowActions = usePortalWorkflowActions({
    routeId,
    monthIso,
    setPayload,
    setSyncState,
    suppressRemoteRefreshUntilRef,
    triggerSyncRef: triggerWorkflowSyncRef,
  })

  const runStarted = (payload?.run?.started_at || '').trim().length > 0
  const runCompleted = worksheetRunExplicitlyCompleted(payload?.run)
  const isHistoricalMonth = Boolean(payload?.run?.is_historical)
  const isCurrentMonth = monthOk && monthIso === monthFirstIsoPacificToday()
  const hasRunFile = payload?.run != null
  const viewingHistoricalRun = fromPriorRun || !isCurrentMonth || isHistoricalMonth

  const onPortalStartRun = useCallback(async () => {
    if (Number.isNaN(routeId) || viewingHistoricalRun) return
    if (payload?.run != null && payload.run.started_at != null) return
    setPortalStartingRun(true)
    try {
      await apiJson<{ run: { month_date: string } }>(`/api/technician_portal/routes/${routeId}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      await load()
    } catch {
      window.alert('Could not start run. Try again.')
    } finally {
      setPortalStartingRun(false)
    }
  }, [routeId, payload?.run, load, viewingHistoricalRun])

  const onPortalCompleteRun = useCallback(async () => {
    if (Number.isNaN(routeId) || !monthOk) return
    const run = payload?.run
    if (!run?.started_at || worksheetRunExplicitlyCompleted(run)) return
    setRunLifecycleBusy(true)
    try {
      await apiJson(`/api/technician_portal/routes/${routeId}/runs/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month_date: monthIso }),
      })
      await load()
    } catch {
      window.alert('Could not complete run. Try again.')
    } finally {
      setRunLifecycleBusy(false)
    }
  }, [routeId, monthOk, monthIso, payload?.run, load])

  const onPortalReopenRun = useCallback(async () => {
    if (Number.isNaN(routeId) || !monthOk || payload?.run == null) return
    if (!worksheetRunExplicitlyCompleted(payload.run)) return
    setRunLifecycleBusy(true)
    try {
      await apiJson(`/api/technician_portal/routes/${routeId}/runs/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month_date: monthIso }),
      })
      await load()
    } catch {
      window.alert('Could not reopen run. Try again.')
    } finally {
      setRunLifecycleBusy(false)
    }
  }, [routeId, monthOk, monthIso, payload?.run, load])

  const applyRemoteWorksheetRefresh = useCallback(() => {
    if (Date.now() < suppressRemoteRefreshUntilRef.current) {
      return
    }
    if (worksheetInteractiveBusyRef.current) {
      worksheetDeferredRemoteFetchRef.current = true
      return
    }
    if (hasPendingSyncForRouteMonth(routeId, monthIso)) {
      return
    }
    worksheetDeferredRemoteFetchRef.current = false
    refreshInBackgroundRef.current()
  }, [routeId, monthIso])

  const setInteractiveBusy = useCallback((busy: boolean) => {
    worksheetInteractiveBusyRef.current = busy
    if (!busy && worksheetDeferredRemoteFetchRef.current) {
      worksheetDeferredRemoteFetchRef.current = false
      refreshInBackgroundRef.current()
    }
  }, [])

  useEffect(() => {
    worksheetDeferredRemoteFetchRef.current = false
    hasLoadedOnceRef.current = false
    setHasLoadedOnce(false)
    setPayload(null)
    setError(null)
    setLoading(true)
    suppressRemoteRefreshUntilRef.current = 0
  }, [routeId, monthIso])

  useEffect(() => {
    const c = new AbortController()
    void load(c.signal)
    return () => c.abort()
  }, [load])

  useEffect(() => {
    const t = setInterval(() => {
      void runSyncQueue()
      void runWorkflowSyncQueueRef.current()
    }, 3500)
    return () => clearInterval(t)
  }, [runSyncQueue])

  const sseEnabled = payload !== null && monthOk && !Number.isNaN(routeId)

  useEffect(() => {
    if (!sseEnabled) return

    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null

    const clearReconnect = () => {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const scheduleReconnect = () => {
      clearReconnect()
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        openEs()
      }, 15000)
    }

    const openEs = () => {
      clearReconnect()
      if (!navigator.onLine || document.visibilityState !== 'visible') return
      const qs = new URLSearchParams({ month: monthIso, tech_portal: '1' })
      const url = `/api/monthly_routes/routes/${routeId}/worksheet/stream?${qs.toString()}`
      try {
        es = new EventSource(url)
      } catch {
        scheduleReconnect()
        return
      }
      es.onmessage = (event: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(event.data) as {
            revision?: string
            route_id?: number
            month_date?: string
          }
          if (msg.route_id !== routeId || msg.month_date !== monthIso) return
        } catch {
          return
        }
        applyRemoteWorksheetRefresh()
      }
      es.onerror = () => {
        es?.close()
        es = null
        scheduleReconnect()
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearReconnect()
        es?.close()
        es = null
      } else {
        openEs()
      }
    }

    const onOffline = () => {
      clearReconnect()
      es?.close()
      es = null
    }

    const onOnline = () => openEs()

    openEs()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      clearReconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      es?.close()
      es = null
    }
  }, [sseEnabled, routeId, monthIso, applyRemoteWorksheetRefresh])

  const showStopWorkspace = stops.length > 0 && hasRunFile
  const canEditStops =
    showStopWorkspace && !runCompleted && !viewingHistoricalRun && isCurrentMonth
  const showStartRun = false
  const showCompleteRun = false
  const showReopenRun = false
  const readOnlyWorksheet = showStopWorkspace && !canEditStops
  /** True until the first successful fetch for this route/month (avoids stale prior-month UI). */
  const initialLoading = loading && !hasLoadedOnce

  return {
    payload,
    stops,
    loading,
    initialLoading,
    hasLoadedOnce,
    error,
    monthOk,
    monthHeading: formatMonthHeading(monthIso),
    portalStartingRun,
    runLifecycleBusy,
    syncState,
    syncMessage,
    openClockInStop,
    clockInBlockedForStop,
    updateLocalStop,
    queueStopChanges,
    onPortalStartRun,
    onPortalCompleteRun,
    onPortalReopenRun,
    runStarted,
    runCompleted,
    isHistoricalMonth,
    isCurrentMonth,
    hasRunFile,
    showStopWorkspace,
    showStartRun,
    showCompleteRun,
    showReopenRun,
    viewingHistoricalRun,
    readOnlyWorksheet,
    canEditStops,
    setInteractiveBusy,
    hhmmNow,
    workflowActions,
  }
}
