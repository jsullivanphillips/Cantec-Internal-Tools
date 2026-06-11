import { useCallback, useRef, useState } from 'react'
import type { MonthlyRunDetailLocation, TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { patchRunDetailsStop } from './patchRunDetailsStop'
import {
  enrichmentPatchFromWorksheetStop,
  prepChangesToStopPatch,
  prepPatchFromWorksheetStop,
  rollbackPatchForChanges,
  syncPrepChangesForApi,
  type PrepStopPatchChanges,
} from './runDetailsPrepPatch'

export type RunDetailsStopPatchSaving = { siteId: number; fieldKey: string } | null

/** True when a PATCH response still matches the latest save attempt for that stop. */
export function isStopPatchGenerationCurrent(
  generations: Map<number, number>,
  locationId: number,
  generation: number,
): boolean {
  return generations.get(locationId) === generation
}

function newPatchAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function patchErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const message = (error as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Could not save.'
}

function enqueueSitePatch(
  queues: Map<number, Promise<void>>,
  locationId: number,
  task: () => Promise<void>,
): Promise<void> {
  const prior = queues.get(locationId) ?? Promise.resolve()
  const chained = prior.then(task, task)
  const tracked = chained.finally(() => {
    if (queues.get(locationId) === tracked) {
      queues.delete(locationId)
    }
  })
  queues.set(locationId, tracked)
  return tracked
}

export function useRunDetailsStopPatch({
  routeId,
  monthDate,
  onStopPatched,
  onWorksheetStopSynced,
  getStopSnapshot,
}: {
  routeId: number
  monthDate: string
  onStopPatched: (locationId: number, patch: Partial<MonthlyRunDetailLocation>) => void
  /** Updates modal stop cache only — do not merge full stop into run-details payload here. */
  onWorksheetStopSynced?: (stop: TechnicianWorksheetLocation) => void
  /** Current run-details stop row, read immediately before optimistic merge (for rollback). */
  getStopSnapshot?: (locationId: number) => MonthlyRunDetailLocation | undefined
}) {
  const [saving, setSaving] = useState<RunDetailsStopPatchSaving>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasPendingPatches, setHasPendingPatches] = useState(false)
  const generationRef = useRef<Map<number, number>>(new Map())
  const sitePatchQueuesRef = useRef<Map<number, Promise<void>>>(new Map())
  const pendingPatchCountRef = useRef(0)

  const patchStop = useCallback(
    async (
      locationId: number,
      fieldKey: string,
      changes: PrepStopPatchChanges,
      rollback: Partial<MonthlyRunDetailLocation>,
      stopNumber?: number,
    ) => {
      const normalizedChanges = syncPrepChangesForApi(changes)
      const changeKeys = Object.keys(normalizedChanges)
      if (changeKeys.length === 0) return

      const nextGen = (generationRef.current.get(locationId) ?? 0) + 1
      generationRef.current.set(locationId, nextGen)
      const clientMutationId = `run-prep-${locationId}-${newPatchAttemptId()}`

      const snapshot = getStopSnapshot?.(locationId)
      const rollbackPatch = snapshot
        ? rollbackPatchForChanges(snapshot, normalizedChanges)
        : rollback

      onStopPatched(locationId, prepChangesToStopPatch(normalizedChanges))
      setSaving({ siteId: locationId, fieldKey })
      setError(null)

      pendingPatchCountRef.current += 1
      setHasPendingPatches(true)

      await enqueueSitePatch(sitePatchQueuesRef.current, locationId, async () => {
        try {
          const stop = await patchRunDetailsStop(routeId, monthDate, locationId, normalizedChanges, {
            clientMutationId,
            stopNumber,
          })
          if (!isStopPatchGenerationCurrent(generationRef.current, locationId, nextGen)) {
            onWorksheetStopSynced?.(stop)
            return
          }
          onStopPatched(locationId, prepPatchFromWorksheetStop(stop, changeKeys))
          const enrichment = enrichmentPatchFromWorksheetStop(stop, changeKeys)
          if (Object.keys(enrichment).length > 0) {
            onStopPatched(locationId, enrichment)
          }
          onWorksheetStopSynced?.(stop)
        } catch (e) {
          if (isStopPatchGenerationCurrent(generationRef.current, locationId, nextGen)) {
            onStopPatched(locationId, rollbackPatch)
          }
          const message = patchErrorMessage(e)
          setError(message)
          throw new Error(message)
        } finally {
          pendingPatchCountRef.current = Math.max(0, pendingPatchCountRef.current - 1)
          if (pendingPatchCountRef.current === 0) {
            setHasPendingPatches(false)
          }
          if (isStopPatchGenerationCurrent(generationRef.current, locationId, nextGen)) {
            setSaving((current) =>
              current?.siteId === locationId && current?.fieldKey === fieldKey ? null : current,
            )
          }
        }
      })
    },
    [routeId, monthDate, onStopPatched, onWorksheetStopSynced, getStopSnapshot],
  )

  const patchStopFields = useCallback(
    async (
      stop: Pick<MonthlyRunDetailLocation, 'location_id'> & Partial<MonthlyRunDetailLocation>,
      fieldKey: string,
      changes: PrepStopPatchChanges,
      rollback: Partial<MonthlyRunDetailLocation>,
    ) => patchStop(stop.location_id, fieldKey, changes, rollback, stop.stop_number),
    [patchStop],
  )

  const patchStopForRow = useCallback(
    (stopNumber?: number) => {
      return (
        locationId: number,
        fieldKey: string,
        changes: PrepStopPatchChanges,
        rollback: Partial<MonthlyRunDetailLocation>,
      ) => {
        void patchStop(locationId, fieldKey, changes, rollback, stopNumber)
      }
    },
    [patchStop],
  )

  const isRowSaving = useCallback(
    (siteId: number) => saving?.siteId === siteId,
    [saving],
  )

  const isFieldSaving = useCallback(
    (siteId: number, key: string) => saving?.siteId === siteId && saving?.fieldKey === key,
    [saving],
  )

  return {
    patchStop,
    patchStopForRow,
    patchStopFields,
    saving,
    error,
    setError,
    isRowSaving,
    isFieldSaving,
    hasPendingPatches,
  }
}

export type RunDetailsStopPatchApi = Pick<
  ReturnType<typeof useRunDetailsStopPatch>,
  | 'patchStop'
  | 'patchStopForRow'
  | 'patchStopFields'
  | 'error'
  | 'setError'
  | 'isRowSaving'
  | 'isFieldSaving'
  | 'hasPendingPatches'
>
