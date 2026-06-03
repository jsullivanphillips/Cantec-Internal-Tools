import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetPayload, TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  optimisticCancelClockInPatch,
  optimisticClockInPatch,
  optimisticClockOutPatch,
  optimisticCreateDeficiencyPatch,
  optimisticOutcomePatch,
  optimisticResetStopPatch,
  optimisticUpdateDeficiencyPatch,
  optimisticVerifyDeficiencyPatch,
  portalHhmmNow,
  type PortalSkipCategory,
  type PortalTestOutcome,
} from './portalWorkflowShared'
import type { PortalWorksheetSyncState } from './usePortalWorksheet'
import { waitForWorkflowQueueItem, resolveWorkflowQueueItem } from './portalWorkflowQueueWaiters'
import {
  enqueuePortalWorkflowAction,
  hasPendingWorkflowForRouteMonth,
  saveWorksheetCache,
  saveWorkflowSyncQueue,
  type PortalWorkflowAction,
} from './worksheetOfflineStore'
import {
  cancelClockInRevertPatch,
  pendingClockInForStop,
  routeWorkflowQueueItems,
  isPendingClockInQueueHead,
} from './portalCancelClockIn'

function extendSuppressWhileWorkflowPending(
  ref: MutableRefObject<number>,
  routeId: number,
  monthIso: string,
): void {
  if (hasPendingWorkflowForRouteMonth(routeId, monthIso)) {
    ref.current = Math.max(ref.current, Date.now() + 60_000)
  }
}

type WorkflowHookParams = {
  routeId: number
  monthIso: string
  runId: number | null
  setPayload: Dispatch<SetStateAction<TechnicianWorksheetPayload | null>>
  setSyncState: (s: PortalWorksheetSyncState) => void
  suppressRemoteRefreshUntilRef: MutableRefObject<number>
  triggerSyncRef: MutableRefObject<() => void>
}

export function usePortalWorkflowActions({
  routeId,
  monthIso,
  runId,
  setPayload,
  setSyncState,
  suppressRemoteRefreshUntilRef,
  triggerSyncRef,
}: WorkflowHookParams) {
  const mergeStop = useCallback(
    (stop: TechnicianWorksheetStop) => {
      setPayload((prev) => {
        if (!prev?.stops?.length) return prev
        const nextStops = prev.stops.map((s) =>
          s.testing_site_id === stop.testing_site_id ? stop : s,
        )
        const next = { ...prev, stops: nextStops }
        saveWorksheetCache(next)
        return next
      })
      suppressRemoteRefreshUntilRef.current = Date.now() + 2500
      extendSuppressWhileWorkflowPending(suppressRemoteRefreshUntilRef, routeId, monthIso)
    },
    [setPayload, suppressRemoteRefreshUntilRef, routeId, monthIso],
  )

  const patchStopLocal = useCallback(
    (testingSiteId: number, patch: Partial<TechnicianWorksheetStop>) => {
      setPayload((prev) => {
        if (!prev?.stops?.length) return prev
        const nextStops = prev.stops.map((s) =>
          s.testing_site_id === testingSiteId ? { ...s, ...patch } : s,
        )
        const next = { ...prev, stops: nextStops }
        saveWorksheetCache(next)
        return next
      })
      extendSuppressWhileWorkflowPending(suppressRemoteRefreshUntilRef, routeId, monthIso)
    },
    [setPayload, suppressRemoteRefreshUntilRef, routeId, monthIso],
  )

  const runAction = useCallback(
    async (
      stop: TechnicianWorksheetStop,
      action: PortalWorkflowAction,
      payload: Record<string, unknown>,
      optimistic?: Partial<TechnicianWorksheetStop>,
      options?: { awaitServer?: boolean },
    ): Promise<{ ok: boolean; stop?: TechnicianWorksheetStop; queued?: boolean }> => {
      if (optimistic) {
        patchStopLocal(stop.testing_site_id, optimistic)
      }

      const item = enqueuePortalWorkflowAction({
        action,
        routeId,
        monthIso,
        testingSiteId: stop.testing_site_id,
        payload: {
          ...payload,
          stop_number: stop.stop_number,
        },
      })

      if (!navigator.onLine) {
        setSyncState('saved_offline')
      }
      extendSuppressWhileWorkflowPending(suppressRemoteRefreshUntilRef, routeId, monthIso)
      triggerSyncRef.current()

      if (options?.awaitServer) {
        return waitForWorkflowQueueItem(item.id)
      }
      return { ok: true }
    },
    [routeId, monthIso, patchStopLocal, setSyncState, triggerSyncRef],
  )

  const clockIn = useCallback(
    async (stop: TechnicianWorksheetStop) => {
      const timeIn = portalHhmmNow()
      return runAction(stop, 'clock_in', { time_in: timeIn }, optimisticClockInPatch(stop, timeIn))
    },
    [runAction],
  )

  const clockOut = useCallback(
    async (stop: TechnicianWorksheetStop, opts?: { awaitServer?: boolean }) => {
      const timeOut = portalHhmmNow()
      return runAction(
        stop,
        'clock_out',
        { time_out: timeOut },
        optimisticClockOutPatch(stop, timeOut),
        { awaitServer: opts?.awaitServer },
      )
    },
    [runAction],
  )

  const cancelClockIn = useCallback(
    async (stop: TechnicianWorksheetStop) => {
      const queue = routeWorkflowQueueItems(routeId, monthIso)
      const pendingClockIn = pendingClockInForStop(queue, stop.testing_site_id)

      if (pendingClockIn) {
        const revertPatch = cancelClockInRevertPatch(stop, pendingClockIn)

        if (isPendingClockInQueueHead(queue, pendingClockIn)) {
          patchStopLocal(stop.testing_site_id, revertPatch)

          const cancelItem = enqueuePortalWorkflowAction({
            action: 'cancel_clock_in',
            routeId,
            monthIso,
            testingSiteId: stop.testing_site_id,
            payload: {},
          })

          if (!navigator.onLine) {
            setSyncState('saved_offline')
          }
          extendSuppressWhileWorkflowPending(suppressRemoteRefreshUntilRef, routeId, monthIso)
          triggerSyncRef.current()

          const clockInResult = await waitForWorkflowQueueItem(pendingClockIn.id)
          if (!clockInResult.ok) {
            return { ok: false }
          }
          return waitForWorkflowQueueItem(cancelItem.id)
        }

        saveWorkflowSyncQueue(queue.filter((q) => q.id !== pendingClockIn.id))
        resolveWorkflowQueueItem(pendingClockIn.id, { ok: true })
        patchStopLocal(stop.testing_site_id, revertPatch)
        extendSuppressWhileWorkflowPending(suppressRemoteRefreshUntilRef, routeId, monthIso)
        triggerSyncRef.current()
        return { ok: true }
      }

      return runAction(stop, 'cancel_clock_in', {}, optimisticCancelClockInPatch(stop))
    },
    [
      routeId,
      monthIso,
      patchStopLocal,
      runAction,
      setSyncState,
      suppressRemoteRefreshUntilRef,
      triggerSyncRef,
    ],
  )

  const transitionClock = useCallback(
    async (fromStop: TechnicianWorksheetStop, toStop: TechnicianWorksheetStop) => {
      const timeOut = portalHhmmNow()
      const timeIn = portalHhmmNow()
      const fromPatch = optimisticClockOutPatch(fromStop, timeOut)
      const toPatch = optimisticClockInPatch(toStop, timeIn)
      patchStopLocal(fromStop.testing_site_id, fromPatch)
      patchStopLocal(toStop.testing_site_id, toPatch)

      const item = enqueuePortalWorkflowAction({
        action: 'transition_clock',
        routeId,
        monthIso,
        testingSiteId: toStop.testing_site_id,
        payload: {
          from_testing_site_id: fromStop.testing_site_id,
          to_testing_site_id: toStop.testing_site_id,
          time_out: timeOut,
          time_in: timeIn,
          from_stop_number: fromStop.stop_number,
          to_stop_number: toStop.stop_number,
        },
      })

      if (!navigator.onLine) {
        setSyncState('saved_offline')
      }
      extendSuppressWhileWorkflowPending(suppressRemoteRefreshUntilRef, routeId, monthIso)
      triggerSyncRef.current()
      return { ok: true, item }
    },
    [
      routeId,
      monthIso,
      patchStopLocal,
      setSyncState,
      suppressRemoteRefreshUntilRef,
      triggerSyncRef,
    ],
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
      const payload: Record<string, unknown> = { test_outcome: testOutcome }
      if (testOutcome === 'skipped') {
        payload.skip_category = opts?.skipCategory
        payload.skip_note = opts?.skipNote ?? ''
      }
      if (opts?.confirmedNoDeficiencies) {
        payload.confirmed_no_deficiencies = true
      }
      const optimistic = optimisticOutcomePatch(stop, testOutcome, opts)
      return runAction(stop, 'test_outcome', payload, optimistic)
    },
    [runAction],
  )

  const createDeficiency = useCallback(
    async (
      stop: TechnicianWorksheetStop,
      body: { title: string; severity: string; status: string; description?: string },
    ) =>
      runAction(
        stop,
        'create_deficiency',
        { ...body, run_id: runId },
        optimisticCreateDeficiencyPatch(stop, body, runId),
      ),
    [runAction, runId],
  )

  const updateDeficiency = useCallback(
    async (
      stop: TechnicianWorksheetStop,
      deficiencyId: number,
      body: { title?: string; severity?: string; status?: string; description?: string },
    ) =>
      runAction(
        stop,
        'update_deficiency',
        { deficiency_id: deficiencyId, ...body },
        optimisticUpdateDeficiencyPatch(stop, deficiencyId, body),
      ),
    [runAction],
  )

  const verifyDeficiency = useCallback(
    async (stop: TechnicianWorksheetStop, deficiencyId: number, note?: string) =>
      runAction(
        stop,
        'verify_deficiency',
        { deficiency_id: deficiencyId, note: note ?? '' },
        optimisticVerifyDeficiencyPatch(stop, deficiencyId),
      ),
    [runAction],
  )

  const resetStop = useCallback(
    async (stop: TechnicianWorksheetStop) => {
      const resetPatch = optimisticResetStopPatch()
      const queue = routeWorkflowQueueItems(routeId, monthIso)
      const pendingClockIn = pendingClockInForStop(queue, stop.testing_site_id)

      if (pendingClockIn) {
        if (isPendingClockInQueueHead(queue, pendingClockIn)) {
          patchStopLocal(stop.testing_site_id, resetPatch)

          const resetItem = enqueuePortalWorkflowAction({
            action: 'reset_stop',
            routeId,
            monthIso,
            testingSiteId: stop.testing_site_id,
            payload: {},
          })

          if (!navigator.onLine) {
            setSyncState('saved_offline')
          }
          extendSuppressWhileWorkflowPending(suppressRemoteRefreshUntilRef, routeId, monthIso)
          triggerSyncRef.current()

          const clockInResult = await waitForWorkflowQueueItem(pendingClockIn.id)
          if (!clockInResult.ok) {
            return { ok: false }
          }
          return waitForWorkflowQueueItem(resetItem.id)
        }

        saveWorkflowSyncQueue(queue.filter((q) => q.id !== pendingClockIn.id))
        resolveWorkflowQueueItem(pendingClockIn.id, { ok: true })
        patchStopLocal(stop.testing_site_id, resetPatch)
        extendSuppressWhileWorkflowPending(suppressRemoteRefreshUntilRef, routeId, monthIso)
        triggerSyncRef.current()
        return { ok: true }
      }

      return runAction(stop, 'reset_stop', {}, resetPatch)
    },
    [
      routeId,
      monthIso,
      patchStopLocal,
      runAction,
      setSyncState,
      suppressRemoteRefreshUntilRef,
      triggerSyncRef,
    ],
  )

  const refreshDeficiencies = useCallback(
    async (stop: TechnicianWorksheetStop, includeHidden: boolean) => {
      const qs = new URLSearchParams({
        month: monthIso,
        tech_portal: '1',
        include_hidden: includeHidden ? '1' : '0',
      })
      const data = await apiJson<{ deficiencies: TechnicianWorksheetStop['deficiencies'] }>(
        `/api/monthly_routes/routes/${routeId}/worksheet/stops/${stop.testing_site_id}/deficiencies?${qs.toString()}`,
      )
      patchStopLocal(stop.testing_site_id, { deficiencies: data.deficiencies ?? [] })
    },
    [routeId, monthIso, patchStopLocal],
  )

  return {
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
  }
}
