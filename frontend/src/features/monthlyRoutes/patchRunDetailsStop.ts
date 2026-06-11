import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  worksheetStopChangesForSync,
  type WorksheetStopChangeSet,
} from './worksheetOfflineStore'

export type RunDetailsStopPatchChanges = Record<string, string | number | boolean | null>

export async function patchRunDetailsStop(
  routeId: number,
  monthDate: string,
  locationId: number,
  changes: WorksheetStopChangeSet | RunDetailsStopPatchChanges,
  options?: { clientMutationId?: string; stopNumber?: number },
): Promise<TechnicianWorksheetLocation> {
  const syncChanges = worksheetStopChangesForSync(
    changes as WorksheetStopChangeSet,
  ) as RunDetailsStopPatchChanges
  const qs = new URLSearchParams({ month: monthDate })
  const clientMutationId =
    options?.clientMutationId ?? `run-prep-${locationId}-${Date.now()}`
  const body = await apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(
    `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}?${qs.toString()}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_mutation_id: clientMutationId,
        changes: syncChanges,
        ...(options?.stopNumber != null && options.stopNumber > 0
          ? { stop_number: options.stopNumber }
          : {}),
      }),
    },
  )
  return body.stop
}
