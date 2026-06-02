import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  worksheetStopChangesForSync,
  type WorksheetStopChangeSet,
} from './worksheetOfflineStore'

export type RunDetailsStopPatchChanges = Record<string, string | number | boolean | null>

export async function patchRunDetailsStop(
  routeId: number,
  monthDate: string,
  testingSiteId: number,
  changes: WorksheetStopChangeSet | RunDetailsStopPatchChanges,
  options?: { clientMutationId?: string },
): Promise<TechnicianWorksheetStop> {
  const syncChanges = worksheetStopChangesForSync(
    changes as WorksheetStopChangeSet,
  ) as RunDetailsStopPatchChanges
  const qs = new URLSearchParams({ month: monthDate })
  const clientMutationId =
    options?.clientMutationId ?? `run-prep-${testingSiteId}-${Date.now()}`
  const body = await apiJson<{ ok: boolean; stop: TechnicianWorksheetStop }>(
    `/api/monthly_routes/routes/${routeId}/worksheet/stops/${testingSiteId}?${qs.toString()}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_mutation_id: clientMutationId,
        changes: syncChanges,
      }),
    },
  )
  return body.stop
}
