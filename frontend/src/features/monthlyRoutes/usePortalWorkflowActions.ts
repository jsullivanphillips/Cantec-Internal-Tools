import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetPayload, TechnicianWorksheetLocation } from './monthlyRoutesShared'
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
  purgePendingFieldChangesForStop,
  purgePendingWorkflowForStop,
  saveWorksheetCache,
  saveWorkflowSyncQueue,
  type PortalWorkflowAction,
} from './worksheetOfflineStore'
import { cancelClockInRevertPatch, pendingClockInForStop, routeWorkflowQueueItems, isPendingClockInQueueHead } from './portalCancelClockIn'

function extendSuppressWhileWorkflowPending(
  ref: MutableRefObject<number>,
  _routeId: number,
  _monthIso: string,
): void {
  ref.current = Math.max(ref.current, Date.now() + 2500)
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
    (stop: TechnicianWorksheetLocation) => {
      setPayload((prev) => {
        if (!prev?.locations?.length) return prev
        const nextStops = prev.locations.map((s) =>
          s.location_id === stop.location_id ? stop : s,
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
    (locationId: number, patch: Partial<TechnicianWorksheetLocation>) => {
      setPayload((prev) => {
        if (!prev?.locations?.length) return prev
        const nextStops = prev.locations.map((s) =>
          s.location_id === locationId ? { ...s, ...patch } : s,
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
      stop: TechnicianWorksheetLocation,
      action: PortalWorkflowAction,
      payload: Record<string, unknown>,
      optimistic?: Partial<TechnicianWorksheetLocation>,
      options?: { awaitServer?: boolean },
    ): Promise<{ ok: boolean; stop?: TechnicianWorksheetLocation; queued?: boolean }> => {
      if (optimistic) {
        patchStopLocal(stop.location_id, optimistic)
      }

      const item = enqueuePortalWorkflowAction({
        action,
        routeId,
        monthIso,
        locationId: stop.location_id,
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
    async (stop: TechnicianWorksheetLocation) => {
      const timeIn = portalHhmmNow()
      return runAction(stop, 'clock_in', { time_in: timeIn }, optimisticClockInPatch(stop, timeIn))
    },
    [runAction],
  )

  const clockOut = useCallback(
    async (stop: TechnicianWorksheetLocation, opts?: { awaitServer?: boolean }) => {
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
    async (stop: TechnicianWorksheetLocation) => {
      const queue = routeWorkflowQueueItems(routeId, monthIso)
      const pendingClockIn = pendingClockInForStop(queue, stop.location_id)

      if (pendingClockIn) {
        const revertPatch = cancelClockInRevertPatch(stop, pendingClockIn)

        if (isPendingClockInQueueHead(queue, pendingClockIn)) {
          patchStopLocal(stop.location_id, revertPatch)

          const cancelItem = enqueuePortalWorkflowAction({
            action: 'cancel_clock_in',
            routeId,
            monthIso,
            locationId: stop.location_id,
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
        patchStopLocal(stop.location_id, revertPatch)
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
    async (fromStop: TechnicianWorksheetLocation, toStop: TechnicianWorksheetLocation) => {
      const timeOut = portalHhmmNow()
      const timeIn = portalHhmmNow()
      const fromPatch = optimisticClockOutPatch(fromStop, timeOut)
      const toPatch = optimisticClockInPatch(toStop, timeIn)
      patchStopLocal(fromStop.location_id, fromPatch)
      patchStopLocal(toStop.location_id, toPatch)

      const item = enqueuePortalWorkflowAction({
        action: 'transition_clock',
        routeId,
        monthIso,
        locationId: toStop.location_id,
        payload: {
          from_location_id: fromStop.location_id,
          to_location_id: toStop.location_id,
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
      stop: TechnicianWorksheetLocation,
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
      stop: TechnicianWorksheetLocation,
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
      stop: TechnicianWorksheetLocation,
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
    async (stop: TechnicianWorksheetLocation, deficiencyId: number, note?: string) =>
      runAction(
        stop,
        'verify_deficiency',
        { deficiency_id: deficiencyId, note: note ?? '' },
        optimisticVerifyDeficiencyPatch(stop, deficiencyId),
      ),
    [runAction],
  )

  const resetStop = useCallback(
    async (stop: TechnicianWorksheetLocation) => {
      const resetPatch = optimisticResetStopPatch()
      const removed = purgePendingWorkflowForStop(routeId, monthIso, stop.location_id)
      for (const item of removed) {
        resolveWorkflowQueueItem(item.id, { ok: true })
      }
      purgePendingFieldChangesForStop(routeId, monthIso, stop.location_id)
      patchStopLocal(stop.location_id, resetPatch)

      const resetItem = enqueuePortalWorkflowAction({
        action: 'reset_stop',
        routeId,
        monthIso,
        locationId: stop.location_id,
        payload: {
          stop_number: stop.stop_number,
        },
      })

      if (!navigator.onLine) {
        setSyncState('saved_offline')
      }
      extendSuppressWhileWorkflowPending(suppressRemoteRefreshUntilRef, routeId, monthIso)
      triggerSyncRef.current()

      if (!navigator.onLine) {
        return { ok: true, queued: true }
      }
      return waitForWorkflowQueueItem(resetItem.id)
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

  const refreshDeficiencies = useCallback(
    async (stop: TechnicianWorksheetLocation, includeHidden: boolean) => {
      const qs = new URLSearchParams({
        month: monthIso,
        tech_portal: '1',
        include_hidden: includeHidden ? '1' : '0',
      })
      const data = await apiJson<{ deficiencies: TechnicianWorksheetLocation['deficiencies'] }>(
        `/api/monthly_routes/routes/${routeId}/worksheet/locations/${stop.location_id}/deficiencies?${qs.toString()}`,
      )
      patchStopLocal(stop.location_id, { deficiencies: data.deficiencies ?? [] })
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
