import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  monthFirstIsoPacificToday,
  parseYearMonth,
  worksheetRunExplicitlyCompleted,
  WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE,
  type TechnicianWorksheetPayload,
  type TechnicianWorksheetRun,
  type TechnicianWorksheetStop,
} from './monthlyRoutesShared'
import {
  canPortalEditRun,
  runFieldEnded,
  runIsPrepared,
  worksheetRunFieldInProgress,
} from './runWorkflowShared'
import {
  backoffMs,
  enqueuePortalRunLifecycleAction,
  enqueueWorksheetChange,
  countPendingSyncForRouteMonth,
  hasPendingRunLifecycleForRouteMonth,
  hasPendingSyncForRouteMonth,
  loadSyncQueue,
  loadWorkflowSyncQueue,
  loadWorksheetCache,
  applyServerStopWithPending,
  mergePendingChangesIntoPayload,
  mergeServerWorksheetPayload,
  purgePortalRouteMonthClientState,
  saveSyncQueue,
  saveWorksheetCache,
  serverRunWasExternallyReset,
  shouldSuppressRemoteWorksheetRefresh,
  type WorksheetStopChangeSet,
  worksheetStopChangesForSync,
} from './worksheetOfflineStore'
import { apiJson, authFailureRedirectPath, isAbortError } from '../../lib/apiClient'
import { runPortalRunLifecycleSyncQueue } from './portalRunLifecycleSync'
import { runPortalWorkflowSyncQueue } from './portalWorkflowSync'
import { waitForPortalRouteSyncIdle } from './flushPortalRouteSync'
import {
  markPortalPaperworkRefreshRequested,
  shouldRequestPortalPaperworkRefresh,
} from './portalWorksheetLoadPolicy'
import {
  projectedClockInBlockedForStop,
  projectedOpenClockStop,
  projectStopsWithWorkflowQueue,
} from './portalRouteProjection'
import { ensureMonitoringCompaniesCached } from './monitoringCompaniesShared'
import { usePortalWorkflowActions } from './usePortalWorkflowActions'
import {
  evaluatePortalEndRunPreflight,
  type PortalEndRunModalState,
} from './portalEndRunPreflight'

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
  const [runLifecycleMessage, setRunLifecycleMessage] = useState<string | null>(null)
  const [endRunModal, setEndRunModal] = useState<PortalEndRunModalState | null>(null)
  const [syncState, setSyncState] = useState<PortalWorksheetSyncState>('synced')
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const syncingRef = useRef(false)
  const workflowSyncingRef = useRef(false)
  const runLifecycleSyncingRef = useRef(false)
  const triggerWorkflowSyncRef = useRef(() => {})
  const triggerRunLifecycleSyncRef = useRef(() => {})
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
      loadWorkflowSyncQueue()
        .filter((item) => item.routeId === routeId && item.monthIso === monthIso)
        .map((item) => `${item.id}:${item.action}:${item.testingSiteId}`)
        .join('|'),
    [stops, syncState, routeId, monthIso],
  )

  const pendingSyncCount = useMemo(
    () => (Number.isNaN(routeId) || !monthOk ? 0 : countPendingSyncForRouteMonth(routeId, monthIso)),
    [routeId, monthIso, monthOk, syncState, stops, workflowQueueRevision],
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
      const hasCache = cached != null
      if (hasCache && !hasLoadedOnceRef.current) {
        setPayload(cached)
        setSyncState(navigator.onLine ? 'synced' : 'saved_offline')
        setLoading(false)
        void ensureMonitoringCompaniesCached().catch(() => {})
      }
      const fetchMode: 'initial' | 'background' =
        hasCache && mode === 'initial' ? 'background' : mode
      if (mode === 'initial') {
        setError(null)
      }
      try {
        const qs = new URLSearchParams({ month: monthIso, tech_portal: '1' })
        const isCurrentMonth = monthIso === monthFirstIsoPacificToday()
        if (
          fetchMode === 'initial' &&
          isCurrentMonth &&
          shouldRequestPortalPaperworkRefresh(routeId, monthIso)
        ) {
          qs.set('refresh_paperwork', '1')
          markPortalPaperworkRefreshRequested(routeId, monthIso)
        }
        const data = await apiJson<TechnicianWorksheetPayload>(
          `/api/monthly_routes/routes/${routeId}/worksheet?${qs.toString()}`,
          { signal },
        )
        if (signal?.aborted) return
        const localBaseline = loadWorksheetCache(routeId, monthIso) ?? cached
        const externallyReset = serverRunWasExternallyReset(
          localBaseline,
          data,
          routeId,
          monthIso,
        )
        if (externallyReset) {
          purgePortalRouteMonthClientState(routeId, monthIso)
        }
        const merged = mergePendingChangesIntoPayload(data, routeId, monthIso)
        if (fetchMode === 'background') {
          if (!externallyReset && hasPendingSyncForRouteMonth(routeId, monthIso)) {
            setPayload((prev) => {
              const next = prev ? mergeServerWorksheetPayload(prev, merged, routeId, monthIso) : merged
              saveWorksheetCache(next)
              return next
            })
          } else {
            setPayload(merged)
            saveWorksheetCache(merged)
          }
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
        void ensureMonitoringCompaniesCached().catch(() => {})
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
        if (fetchMode === 'initial' && !hasCache) {
          setError('Unable to load worksheet.')
          setSyncState('saved_offline')
        } else if (hasCache && !hasLoadedOnceRef.current) {
          setHasLoadedOnce(true)
          hasLoadedOnceRef.current = true
        }
      } finally {
        if (!signal?.aborted && mode === 'initial' && !hasCache) {
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
              changes: worksheetStopChangesForSync(item.changes),
            }),
          },
        )
        let mergedStopForQueue: TechnicianWorksheetStop = res.stop
        setPayload((prev) => {
          if (!prev?.stops?.length) return prev
          const prevStop = prev.stops.find((s) => s.testing_site_id === testingSiteId)
          const mergedStop = applyServerStopWithPending(
            res.stop,
            item.routeId,
            item.monthIso,
            item.id,
            prevStop,
          )
          mergedStopForQueue = mergedStop
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
              ? { ...q, expectedUpdatedAt: mergedStopForQueue.version_updated_at }
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
    const runLifecyclePending = hasPendingRunLifecycleForRouteMonth(routeId, monthIso)
    setSyncState(
      nextQueue.length > 0 || workflowPending || runLifecyclePending ? 'saved_offline' : 'synced',
    )
    if (!nextQueue.length) {
      void runRunLifecycleSyncQueueRef.current()
      void runWorkflowSyncQueueRef.current()
    }
  }, [routeId, monthOk, monthIso])

  const runSyncQueueRef = useRef(runSyncQueue)
  useEffect(() => {
    runSyncQueueRef.current = runSyncQueue
  }, [runSyncQueue])

  const runRunLifecycleSyncQueue = useCallback(async () => {
    if (Number.isNaN(routeId) || !monthOk) return
    await runPortalRunLifecycleSyncQueue(
      {
        routeId,
        monthIso,
        setPayload,
        setSyncState,
        suppressRemoteRefreshUntilRef,
      },
      runLifecycleSyncingRef,
    )
  }, [routeId, monthOk, monthIso])

  const runRunLifecycleSyncQueueRef = useRef(runRunLifecycleSyncQueue)
  useEffect(() => {
    runRunLifecycleSyncQueueRef.current = runRunLifecycleSyncQueue
  }, [runRunLifecycleSyncQueue])

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

  triggerRunLifecycleSyncRef.current = () => {
    void runRunLifecycleSyncQueueRef.current()
  }

  const waitForPortalSyncIdle = useCallback(async (): Promise<boolean> => {
    return waitForPortalRouteSyncIdle(routeId, monthIso, {
      runRunLifecycleSyncQueue: () => runRunLifecycleSyncQueueRef.current(),
      runFieldSyncQueue: () => runSyncQueueRef.current(),
      runWorkflowSyncQueue: () => runWorkflowSyncQueueRef.current(),
      isFieldSyncing: () => syncingRef.current,
      isWorkflowSyncing: () => workflowSyncingRef.current,
      isRunLifecycleSyncing: () => runLifecycleSyncingRef.current,
    })
  }, [routeId, monthIso])

  const workflowActions = usePortalWorkflowActions({
    routeId,
    monthIso,
    runId: payload?.run?.id ?? null,
    setPayload,
    setSyncState,
    suppressRemoteRefreshUntilRef,
    triggerSyncRef: triggerWorkflowSyncRef,
  })

  const runPrepared = runIsPrepared(payload?.run)
  const runEnded = runFieldEnded(payload?.run)
  const runCompleted = worksheetRunExplicitlyCompleted(payload?.run)
  const runStarted = worksheetRunFieldInProgress(payload?.run) || runEnded
  const isHistoricalMonth = Boolean(payload?.run?.is_historical)
  const isCurrentMonth = monthOk && monthIso === monthFirstIsoPacificToday()
  const hasRunFile = payload?.run != null
  const runMonthMatchesWorksheet =
    monthOk && (payload?.run?.month_date ?? '').trim() === monthIso.trim()
  /** Prior-month browse is read-only; ``is_historical`` only gates stop edits, not run lifecycle. */
  const viewingHistoricalRun = fromPriorRun || !isCurrentMonth || isHistoricalMonth
  const showPortalRunLifecycle =
    hasRunFile && !fromPriorRun && !runCompleted && runMonthMatchesWorksheet

  const applyServerRunToPayload = useCallback((run: TechnicianWorksheetRun) => {
    setPayload((prev) => {
      if (!prev) return prev
      const next = { ...prev, run }
      saveWorksheetCache(next)
      return next
    })
  }, [])

  const onPortalStartRun = useCallback(async () => {
    if (Number.isNaN(routeId) || viewingHistoricalRun) return
    if (payload?.run != null && payload.run.started_at != null) return
    setPortalStartingRun(true)
    try {
      const now = new Date().toISOString()
      setPayload((prev) => {
        if (!prev?.run) return prev
        const next = {
          ...prev,
          run: {
            ...prev.run,
            started_at: now,
            opened_at: prev.run.opened_at ?? now,
          },
        }
        saveWorksheetCache(next)
        return next
      })
      enqueuePortalRunLifecycleAction({
        action: 'start_run',
        routeId,
        monthIso,
        clientStartedAt: now,
      })
      if (!navigator.onLine) {
        setSyncState('saved_offline')
      }
      suppressRemoteRefreshUntilRef.current = Math.max(
        suppressRemoteRefreshUntilRef.current,
        Date.now() + 2500,
      )
      void runRunLifecycleSyncQueueRef.current()
    } finally {
      setPortalStartingRun(false)
    }
  }, [routeId, monthIso, payload?.run, viewingHistoricalRun])

  const postPortalEndRun = useCallback(async (): Promise<boolean> => {
    try {
      const body = await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/technician_portal/routes/${routeId}/runs/end`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      )
      applyServerRunToPayload(body.run)
      setEndRunModal(null)
      return true
    } catch {
      window.alert('Could not end run. Try again.')
      return false
    }
  }, [routeId, applyServerRunToPayload])

  const requestPortalEndRun = useCallback(async () => {
    if (Number.isNaN(routeId) || !monthOk) return
    const run = payload?.run
    if (!run?.started_at || worksheetRunExplicitlyCompleted(run) || runFieldEnded(run)) return
    const runMonthIso = payload?.month_date ?? monthIso
    setRunLifecycleBusy(true)
    setRunLifecycleMessage('Checking worksheet…')
    try {
      const syncIdle = await waitForPortalSyncIdle()
      if (!syncIdle) {
        window.alert(
          'Worksheet changes are still syncing. Wait a moment for pending actions to finish, then try again.',
        )
        return
      }
      const preflight = evaluatePortalEndRunPreflight(projectedStops, runMonthIso)
      if (preflight) {
        setEndRunModal(preflight)
        return
      }
      setRunLifecycleMessage('Ending field run…')
      await postPortalEndRun()
    } finally {
      setRunLifecycleBusy(false)
      setRunLifecycleMessage(null)
    }
  }, [
    routeId,
    monthOk,
    monthIso,
    payload?.run,
    payload?.month_date,
    projectedStops,
    waitForPortalSyncIdle,
    postPortalEndRun,
  ])

  const dismissEndRunModal = useCallback(() => {
    if (runLifecycleBusy) return
    setEndRunModal(null)
  }, [runLifecycleBusy])

  const confirmSkipUntestedAndEndRun = useCallback(async () => {
    if (Number.isNaN(routeId) || !monthOk) return
    if (endRunModal?.kind !== 'untested') return
    const run = payload?.run
    if (!run?.started_at || worksheetRunExplicitlyCompleted(run) || runFieldEnded(run)) return

    setRunLifecycleBusy(true)
    setRunLifecycleMessage('Skipping remaining stops…')
    try {
      for (const stop of endRunModal.stops) {
        await workflowActions.setTestOutcome(stop, 'skipped', {
          skipCategory: 'lack_of_time',
          skipNote: '',
        })
      }
      const syncIdle = await waitForPortalSyncIdle()
      if (!syncIdle) {
        window.alert(
          'Worksheet changes are still syncing. Wait a moment for pending actions to finish, then try again.',
        )
        return
      }
      setRunLifecycleMessage('Ending field run…')
      await postPortalEndRun()
    } finally {
      setRunLifecycleBusy(false)
      setRunLifecycleMessage(null)
    }
  }, [
    routeId,
    monthOk,
    endRunModal,
    payload?.run,
    workflowActions,
    waitForPortalSyncIdle,
    postPortalEndRun,
  ])

  const onPortalEndRun = requestPortalEndRun

  const onPortalReopenField = useCallback(async () => {
    if (Number.isNaN(routeId) || !monthOk || payload?.run == null) return
    if (!runFieldEnded(payload.run) || worksheetRunExplicitlyCompleted(payload.run)) return
    setRunLifecycleBusy(true)
    try {
      const body = await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/technician_portal/routes/${routeId}/runs/reopen_field`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      )
      applyServerRunToPayload(body.run)
    } catch {
      window.alert('Could not reopen run. Try again.')
    } finally {
      setRunLifecycleBusy(false)
    }
  }, [routeId, monthOk, payload?.run, applyServerRunToPayload])

  const onPortalCompleteRun = requestPortalEndRun
  const onPortalReopenRun = onPortalReopenField

  const applyRemoteWorksheetRefresh = useCallback(() => {
    if (shouldSuppressRemoteWorksheetRefresh(suppressRemoteRefreshUntilRef.current, routeId, monthIso)) {
      worksheetDeferredRemoteFetchRef.current = true
      return
    }
    if (worksheetInteractiveBusyRef.current) {
      worksheetDeferredRemoteFetchRef.current = true
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
    const cached = loadWorksheetCache(routeId, monthIso)
    setPayload(cached)
    setError(null)
    setLoading(cached == null)
    suppressRemoteRefreshUntilRef.current = 0
  }, [routeId, monthIso])

  useEffect(() => {
    const c = new AbortController()
    void load(c.signal)
    return () => c.abort()
  }, [load])

  useEffect(() => {
    const t = setInterval(() => {
      void runRunLifecycleSyncQueueRef.current()
      void runSyncQueue()
      void runWorkflowSyncQueueRef.current()
      if (worksheetDeferredRemoteFetchRef.current) {
        applyRemoteWorksheetRefresh()
      }
    }, 3500)
    return () => clearInterval(t)
  }, [runSyncQueue, applyRemoteWorksheetRefresh])

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine && hasLoadedOnceRef.current) {
        applyRemoteWorksheetRefresh()
      }
    }, 30_000)
    return () => clearInterval(t)
  }, [applyRemoteWorksheetRefresh])

  const [sseGateOpen, setSseGateOpen] = useState(false)

  useEffect(() => {
    setSseGateOpen(false)
    const timer = window.setTimeout(() => setSseGateOpen(true), 2500)
    return () => window.clearTimeout(timer)
  }, [routeId, monthIso])

  const sseEnabled =
    payload !== null && monthOk && !Number.isNaN(routeId) && sseGateOpen

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
      es.onopen = () => {
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

    const onOnline = () => {
      void runRunLifecycleSyncQueueRef.current()
      void runSyncQueueRef.current()
      void runWorkflowSyncQueueRef.current()
      openEs()
    }

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
    showStopWorkspace &&
    canPortalEditRun(payload?.run) &&
    !viewingHistoricalRun &&
    isCurrentMonth
  const showStartRun = showPortalRunLifecycle && runPrepared && !runStarted
  const showEndRun = showPortalRunLifecycle && worksheetRunFieldInProgress(payload?.run)
  const showReopenField = showPortalRunLifecycle && runEnded && !worksheetRunFieldInProgress(payload?.run)
  const readOnlyWorksheet = showStopWorkspace && !canEditStops
  /** True until we have any worksheet payload to render (cache or network). */
  const initialLoading = loading && payload == null

  return {
    payload,
    stops,
    projectedStops,
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
    pendingSyncCount,
    openClockInStop,
    clockInBlockedForStop,
    updateLocalStop,
    queueStopChanges,
    onPortalStartRun,
    onPortalEndRun,
    requestPortalEndRun,
    onPortalCompleteRun,
    endRunModal,
    dismissEndRunModal,
    confirmSkipUntestedAndEndRun,
    runLifecycleMessage,
    onPortalReopenField,
    onPortalReopenRun,
    runStarted,
    runPrepared,
    runEnded,
    runCompleted,
    isHistoricalMonth,
    isCurrentMonth,
    hasRunFile,
    showStopWorkspace,
    showStartRun,
    showEndRun,
    showReopenField,
    viewingHistoricalRun,
    readOnlyWorksheet,
    canEditStops,
    setInteractiveBusy,
    hhmmNow,
    workflowActions,
  }
}
