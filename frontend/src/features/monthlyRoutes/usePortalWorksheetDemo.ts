import { useCallback, useMemo, useState } from 'react'
import { buildPortalWorksheetDemoPayload } from './portalWorksheetDemo'
import {
  monthFirstIsoPacificToday,
  parseYearMonth,
  worksheetRunExplicitlyCompleted,
  worksheetStopIsOpenClockIn,
  type TechnicianWorksheetPayload,
  type TechnicianWorksheetStop,
} from './monthlyRoutesShared'
import type { WorksheetStopChangeSet } from './worksheetOfflineStore'
import type { PortalWorksheetSyncState } from './usePortalWorksheet'

const MONTH_FIRST_RE = /^\d{4}-\d{2}-01$/

function formatMonthHeading(monthFirstIso: string): string {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return monthFirstIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

function hhmmNow(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** In-memory worksheet for portal UI demos (matches ``usePortalWorksheet`` return shape). */
export function usePortalWorksheetDemo(monthIso: string) {
  const monthOk = MONTH_FIRST_RE.test(monthIso) && parseYearMonth(monthIso) != null
  const seedMonth = monthOk ? monthIso : monthFirstIsoPacificToday()

  const [payload, setPayload] = useState<TechnicianWorksheetPayload>(() =>
    buildPortalWorksheetDemoPayload(seedMonth),
  )
  const [portalStartingRun, setPortalStartingRun] = useState(false)
  const [runLifecycleBusy, setRunLifecycleBusy] = useState(false)
  const [syncState] = useState<PortalWorksheetSyncState>('synced')
  const [syncMessage] = useState<string | null>(null)

  const stops = useMemo(() => payload.stops ?? [], [payload.stops])

  const updateLocalStop = useCallback((testingSiteId: number, patch: WorksheetStopChangeSet) => {
    setPayload((prev) => {
      if (!prev.stops?.length) return prev
      const nextStops = prev.stops.map((s) =>
        s.testing_site_id === testingSiteId ? { ...s, ...patch } : s,
      )
      return { ...prev, stops: nextStops }
    })
  }, [])

  const openClockInStop = useMemo(() => {
    if (!stops.length) return null
    return stops.find(worksheetStopIsOpenClockIn) ?? null
  }, [stops])

  const clockInBlockedForStop = useCallback(
    (stop: TechnicianWorksheetStop): boolean =>
      openClockInStop != null && openClockInStop.testing_site_id !== stop.testing_site_id,
    [openClockInStop],
  )

  const queueStopChanges = useCallback(
    (stop: TechnicianWorksheetStop, changes: WorksheetStopChangeSet) => {
      updateLocalStop(stop.testing_site_id, changes)
    },
    [updateLocalStop],
  )

  const runStarted = (payload.run?.started_at || '').trim().length > 0
  const runCompleted = worksheetRunExplicitlyCompleted(payload.run)
  const isHistoricalMonth = false
  const isCurrentMonth = monthOk && monthIso === monthFirstIsoPacificToday()
  const hasRunFile = payload.run != null
  const viewingHistoricalRun = false

  const onPortalStartRun = useCallback(async () => {
    if (payload.run?.started_at) return
    setPortalStartingRun(true)
    await new Promise((r) => window.setTimeout(r, 400))
    setPayload((prev) => {
      if (!prev.run) return prev
      const now = new Date().toISOString()
      return {
        ...prev,
        run: { ...prev.run, started_at: now, opened_at: prev.run.opened_at ?? now },
      }
    })
    setPortalStartingRun(false)
  }, [payload.run?.started_at])

  const onPortalCompleteRun = useCallback(async () => {
    const run = payload.run
    if (!run?.started_at || worksheetRunExplicitlyCompleted(run)) return
    setRunLifecycleBusy(true)
    await new Promise((r) => window.setTimeout(r, 300))
    setPayload((prev) => {
      if (!prev.run) return prev
      return {
        ...prev,
        run: {
          ...prev.run,
          status: 'completed',
          completed_at: new Date().toISOString(),
        },
      }
    })
    setRunLifecycleBusy(false)
  }, [payload.run])

  const onPortalReopenRun = useCallback(async () => {
    if (!payload.run || !worksheetRunExplicitlyCompleted(payload.run)) return
    setRunLifecycleBusy(true)
    await new Promise((r) => window.setTimeout(r, 300))
    setPayload((prev) => {
      if (!prev.run) return prev
      return {
        ...prev,
        run: {
          ...prev.run,
          status: 'open',
          completed_at: null,
        },
      }
    })
    setRunLifecycleBusy(false)
  }, [payload.run])

  const setInteractiveBusy = useCallback(() => {}, [])

  const showStopWorkspace = stops.length > 0 && hasRunFile
  const canEditStops = showStopWorkspace && !runCompleted && !viewingHistoricalRun && isCurrentMonth
  const showStartRun = false
  const showCompleteRun = false
  const showReopenRun = false
  const readOnlyWorksheet = showStopWorkspace && !canEditStops

  return {
    payload,
    stops,
    loading: false,
    initialLoading: false,
    detailRefreshing: false,
    hasLoadedOnce: true,
    error: null,
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
    isDemo: true as const,
  }
}
