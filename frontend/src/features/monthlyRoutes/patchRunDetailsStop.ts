import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'

export type RunDetailsStopPatchChanges = Record<string, string | number | null>

export async function patchRunDetailsStop(
  routeId: number,
  monthDate: string,
  testingSiteId: number,
  changes: RunDetailsStopPatchChanges,
): Promise<TechnicianWorksheetStop> {
  const qs = new URLSearchParams({ month: monthDate })
  const body = await apiJson<{ ok: boolean; stop: TechnicianWorksheetStop }>(
    `/api/monthly_routes/routes/${routeId}/worksheet/stops/${testingSiteId}?${qs.toString()}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_mutation_id: `run-prep-${testingSiteId}-${Date.now()}`,
        changes,
      }),
    },
  )
  return body.stop
}
