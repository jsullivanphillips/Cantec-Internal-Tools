import { useCallback, useMemo } from 'react'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  PORTAL_OUTCOME_VALIDATION_MESSAGES,
  portalStopActiveDeficiencies,
  portalStopNewDeficienciesFromPriorRuns,
  type PortalSkipCategory,
  type PortalTestOutcome,
} from './portalWorkflowShared'
import type { PortalDeficiencySummary } from './portalWorkflowShared'

function hhmmNow(): string {
  const d = new Date()
  const h = d.getHours() % 12 || 12
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = d.getHours() < 12 ? 'AM' : 'PM'
  return `${h}:${m} ${ampm}`
}

type PatchStop = (testingSiteId: number, patch: Partial<TechnicianWorksheetStop>) => void

function mergeStopPatch(
  stop: TechnicianWorksheetStop,
  patch: Partial<TechnicianWorksheetStop>,
): TechnicianWorksheetStop {
  return { ...stop, ...patch }
}

export function usePortalWorkflowActionsDemo(
  patchStop: PatchStop,
  runId: number | null = null,
) {
  const mergeStop = useCallback(
    (stop: TechnicianWorksheetStop) => patchStop(stop.testing_site_id, stop),
    [patchStop],
  )

  const clockIn = useCallback(
    async (stop: TechnicianWorksheetStop) => {
      const timeIn = hhmmNow()
      const events = [...(stop.clock_events ?? [])]
      const maxSort = events.reduce((m, ev) => Math.max(m, ev.sort_order), 0)
      const patch = {
        clock_events: [
          ...events,
          { id: Date.now(), sort_order: maxSort + 1, time_in: timeIn, time_out: null },
        ],
        time_in: timeIn,
        time_out: null,
        has_run_changes: true,
      }
      patchStop(stop.testing_site_id, patch)
      return { ok: true, stop: mergeStopPatch(stop, patch) }
    },
    [patchStop],
  )

  const clockOut = useCallback(
    async (stop: TechnicianWorksheetStop) => {
      const timeOut = hhmmNow()
      const events = (stop.clock_events ?? []).map((ev) =>
        ev.time_in && !ev.time_out?.trim() ? { ...ev, time_out: timeOut } : ev,
      )
      const patch = {
        clock_events: events,
        time_out: timeOut,
        has_run_changes: true,
      }
      patchStop(stop.testing_site_id, patch)
      return { ok: true, stop: mergeStopPatch(stop, patch) }
    },
    [patchStop],
  )

  const cancelClockIn = useCallback(
    async (stop: TechnicianWorksheetStop) => {
      const events = (stop.clock_events ?? []).filter((ev) => ev.time_out?.trim())
      const closed = events.filter((ev) => ev.time_out?.trim())
      const lastClosed = closed.length > 0 ? closed[closed.length - 1] : null
      const patch = {
        clock_events: events,
        time_in: events.length ? events[0]?.time_in ?? null : null,
        time_out: lastClosed?.time_out ?? null,
        has_run_changes: events.length > 0 || Boolean(stop.test_outcome),
      }
      patchStop(stop.testing_site_id, patch)
      return { ok: true, stop: mergeStopPatch(stop, patch) }
    },
    [patchStop],
  )

  const setTestOutcome = useCallback(
    async (
      stop: TechnicianWorksheetStop,
      testOutcome: PortalTestOutcome,
      opts?: {
        skipCategory?: PortalSkipCategory
        skipNote?: string
        confirmedNoDeficiencies?: boolean
      },
    ) => {
      const active = portalStopActiveDeficiencies(stop).length
      const newCount = portalStopNewDeficienciesFromPriorRuns(stop, runId).length
      if (testOutcome === 'all_good' && active > 0) {
        window.alert(PORTAL_OUTCOME_VALIDATION_MESSAGES.deficiencies_block_all_good)
        return { ok: false }
      }
      if (testOutcome === 'passed_with_problems') {
        if (active === 0 && !opts?.confirmedNoDeficiencies) {
          window.alert(PORTAL_OUTCOME_VALIDATION_MESSAGES.confirmed_no_deficiencies_required)
          return { ok: false }
        }
        if (newCount > 0) {
          window.alert(PORTAL_OUTCOME_VALIDATION_MESSAGES.unverified_deficiencies)
          return { ok: false }
        }
      }
      if (testOutcome === 'failed' && newCount > 0) {
        window.alert(PORTAL_OUTCOME_VALIDATION_MESSAGES.unverified_deficiencies)
        return { ok: false }
      }
      const patch = {
        test_outcome: testOutcome,
        skip_category: testOutcome === 'skipped' ? opts?.skipCategory ?? null : null,
        skip_note: testOutcome === 'skipped' ? opts?.skipNote ?? null : null,
        result_status: testOutcome === 'skipped' ? 'skipped' : 'tested',
        confirmed_no_deficiencies: opts?.confirmedNoDeficiencies ?? false,
        has_run_changes: true,
      }
      patchStop(stop.testing_site_id, patch)
      return { ok: true, stop: mergeStopPatch(stop, patch) }
    },
    [patchStop, runId],
  )

  const createDeficiency = useCallback(
    async (
      stop: TechnicianWorksheetStop,
      body: { title: string; severity: string; status: string; description?: string },
    ) => {
      const list = [...(stop.deficiencies ?? [])]
      const row: PortalDeficiencySummary = {
        id: Date.now(),
        monthly_testing_site_id: stop.testing_site_id,
        created_run_id: runId,
        title: body.title,
        severity: body.severity,
        status: body.status,
        description: body.description ?? null,
        verification_notes: null,
      }
      const patch: Partial<TechnicianWorksheetStop> = {
        deficiencies: [...list, row],
        has_run_changes: true,
      }
      if ((stop.test_outcome || '').toLowerCase() === 'all_good') {
        patch.test_outcome = 'passed_with_problems'
        patch.confirmed_no_deficiencies = false
      }
      patchStop(stop.testing_site_id, patch)
      return { ok: true, stop: mergeStopPatch(stop, patch) }
    },
    [patchStop, runId],
  )

  const updateDeficiency = useCallback(
    async (
      stop: TechnicianWorksheetStop,
      deficiencyId: number,
      body: { title?: string; severity?: string; status?: string; description?: string },
    ) => {
      const list = (stop.deficiencies ?? []).map((d) =>
        d.id === deficiencyId ? { ...d, ...body } : d,
      )
      patchStop(stop.testing_site_id, { deficiencies: list, has_run_changes: true })
      return { ok: true }
    },
    [patchStop],
  )

  const verifyDeficiency = useCallback(
    async (stop: TechnicianWorksheetStop, deficiencyId: number) => {
      const list = (stop.deficiencies ?? []).map((d) =>
        d.id === deficiencyId ? { ...d, status: 'verified' } : d,
      )
      patchStop(stop.testing_site_id, { deficiencies: list, has_run_changes: true })
      return { ok: true }
    },
    [patchStop],
  )

  const resetStop = useCallback(async (stop: TechnicianWorksheetStop) => {
    patchStop(stop.testing_site_id, {
      test_outcome: null,
      skip_category: null,
      skip_note: null,
      clock_events: [],
      deficiencies: [],
      time_in: null,
      time_out: null,
      result_status: null,
      skip_reason: null,
      has_run_changes: false,
    })
    return { ok: true }
  }, [patchStop])

  const refreshDeficiencies = useCallback(async () => {}, [])

  const transitionClock = useCallback(
    async (fromStop: TechnicianWorksheetStop, toStop: TechnicianWorksheetStop) => {
      const timeOut = hhmmNow()
      const timeIn = hhmmNow()
      const fromEvents = (fromStop.clock_events ?? []).map((ev) =>
        ev.time_in && !ev.time_out?.trim() ? { ...ev, time_out: timeOut } : ev,
      )
      patchStop(fromStop.testing_site_id, {
        clock_events: fromEvents.length ? fromEvents : fromStop.clock_events,
        time_out: timeOut,
      })
      const toEvents = [...(toStop.clock_events ?? [])]
      const maxSort = toEvents.reduce((m, ev) => Math.max(m, ev.sort_order), 0)
      patchStop(toStop.testing_site_id, {
        clock_events: [
          ...toEvents,
          { id: -Date.now(), sort_order: maxSort + 1, time_in: timeIn, time_out: null },
        ],
        time_in: timeIn,
        time_out: null,
      })
      return { ok: true }
    },
    [patchStop],
  )

  return useMemo(
    () => ({
      clockIn,
      clockOut,
      cancelClockIn,
      transitionClock,
      setTestOutcome,
      createDeficiency,
      updateDeficiency,
      verifyDeficiency,
      resetStop,
      refreshDeficiencies,
      mergeStop,
    }),
    [
      clockIn,
      clockOut,
      cancelClockIn,
      transitionClock,
      setTestOutcome,
      createDeficiency,
      updateDeficiency,
      verifyDeficiency,
      resetStop,
      refreshDeficiencies,
      mergeStop,
    ],
  )
}
