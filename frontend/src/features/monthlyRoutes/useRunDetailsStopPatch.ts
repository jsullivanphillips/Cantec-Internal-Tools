import { useCallback, useRef, useState } from 'react'
import type { MonthlyRunDetailLocationStop, TechnicianWorksheetStop } from './monthlyRoutesShared'
import { patchRunDetailsStop } from './patchRunDetailsStop'
import {
  enrichmentPatchFromWorksheetStop,
  prepChangesToStopPatch,
  rollbackPatchForChanges,
  syncPrepChangesForApi,
  type PrepStopPatchChanges,
} from './runDetailsPrepPatch'

export type RunDetailsStopPatchSaving = { siteId: number; fieldKey: string } | null

/** True when a PATCH response still matches the latest save attempt for that stop. */
export function isStopPatchGenerationCurrent(
  generations: Map<number, number>,
  testingSiteId: number,
  generation: number,
): boolean {
  return generations.get(testingSiteId) === generation
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
  testingSiteId: number,
  task: () => Promise<void>,
): Promise<void> {
  const prior = queues.get(testingSiteId) ?? Promise.resolve()
  const chained = prior.then(task, task)
  const tracked = chained.finally(() => {
    if (queues.get(testingSiteId) === tracked) {
      queues.delete(testingSiteId)
    }
  })
  queues.set(testingSiteId, tracked)
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
  onStopPatched: (testingSiteId: number, patch: Partial<MonthlyRunDetailLocationStop>) => void
  /** Updates modal stop cache only — do not merge full stop into run-details payload here. */
  onWorksheetStopSynced?: (stop: TechnicianWorksheetStop) => void
  /** Current run-details stop row, read immediately before optimistic merge (for rollback). */
  getStopSnapshot?: (testingSiteId: number) => MonthlyRunDetailLocationStop | undefined
}) {
  const [saving, setSaving] = useState<RunDetailsStopPatchSaving>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasPendingPatches, setHasPendingPatches] = useState(false)
  const generationRef = useRef<Map<number, number>>(new Map())
  const sitePatchQueuesRef = useRef<Map<number, Promise<void>>>(new Map())
  const pendingPatchCountRef = useRef(0)

  const patchStop = useCallback(
    async (
      testingSiteId: number,
      fieldKey: string,
      changes: PrepStopPatchChanges,
      rollback: Partial<MonthlyRunDetailLocationStop>,
      stopNumber?: number,
    ) => {
      const normalizedChanges = syncPrepChangesForApi(changes)
      const changeKeys = Object.keys(normalizedChanges)
      if (changeKeys.length === 0) return

      const nextGen = (generationRef.current.get(testingSiteId) ?? 0) + 1
      generationRef.current.set(testingSiteId, nextGen)
      const clientMutationId = `run-prep-${testingSiteId}-${newPatchAttemptId()}`

      const snapshot = getStopSnapshot?.(testingSiteId)
      const rollbackPatch = snapshot
        ? rollbackPatchForChanges(snapshot, normalizedChanges)
        : rollback

      onStopPatched(testingSiteId, prepChangesToStopPatch(normalizedChanges))
      setSaving({ siteId: testingSiteId, fieldKey })
      setError(null)

      pendingPatchCountRef.current += 1
      setHasPendingPatches(true)

      await enqueueSitePatch(sitePatchQueuesRef.current, testingSiteId, async () => {
        try {
          const stop = await patchRunDetailsStop(routeId, monthDate, testingSiteId, normalizedChanges, {
            clientMutationId,
            stopNumber,
          })
          if (!isStopPatchGenerationCurrent(generationRef.current, testingSiteId, nextGen)) {
            onWorksheetStopSynced?.(stop)
            return
          }
          const enrichment = enrichmentPatchFromWorksheetStop(stop, changeKeys)
          if (Object.keys(enrichment).length > 0) {
            onStopPatched(testingSiteId, enrichment)
          }
          onWorksheetStopSynced?.(stop)
        } catch (e) {
          if (isStopPatchGenerationCurrent(generationRef.current, testingSiteId, nextGen)) {
            onStopPatched(testingSiteId, rollbackPatch)
          }
          const message = patchErrorMessage(e)
          setError(message)
          throw new Error(message)
        } finally {
          pendingPatchCountRef.current = Math.max(0, pendingPatchCountRef.current - 1)
          if (pendingPatchCountRef.current === 0) {
            setHasPendingPatches(false)
          }
          if (isStopPatchGenerationCurrent(generationRef.current, testingSiteId, nextGen)) {
            setSaving((current) =>
              current?.siteId === testingSiteId && current?.fieldKey === fieldKey ? null : current,
            )
          }
        }
      })
    },
    [routeId, monthDate, onStopPatched, onWorksheetStopSynced, getStopSnapshot],
  )

  const patchStopFields = useCallback(
    async (
      stop: Pick<MonthlyRunDetailLocationStop, 'testing_site_id'> & Partial<MonthlyRunDetailLocationStop>,
      fieldKey: string,
      changes: PrepStopPatchChanges,
      rollback: Partial<MonthlyRunDetailLocationStop>,
    ) => patchStop(stop.testing_site_id, fieldKey, changes, rollback, stop.stop_number),
    [patchStop],
  )

  const patchStopForRow = useCallback(
    (stopNumber?: number) => {
      return (
        testingSiteId: number,
        fieldKey: string,
        changes: PrepStopPatchChanges,
        rollback: Partial<MonthlyRunDetailLocationStop>,
      ) => {
        void patchStop(testingSiteId, fieldKey, changes, rollback, stopNumber)
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
