import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetLocation, TechnicianWorksheetRun } from './monthlyRoutesShared'
import type { OfficeSkipSitePayload } from './OfficeSkipSiteModal'

type PrepSkipResponse = {
  ok: boolean
  stop: TechnicianWorksheetLocation
  run?: TechnicianWorksheetRun
}

export async function postPrepSiteSkip(
  routeId: number,
  locationId: number,
  monthDate: string,
  payload: OfficeSkipSitePayload,
): Promise<PrepSkipResponse> {
  const qs = new URLSearchParams({ month: monthDate })
  return apiJson<PrepSkipResponse>(
    `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}/prep_skip?${qs.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
}

export async function deletePrepSiteSkip(
  routeId: number,
  locationId: number,
  monthDate: string,
): Promise<PrepSkipResponse> {
  const qs = new URLSearchParams({ month: monthDate })
  return apiJson<PrepSkipResponse>(
    `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}/prep_skip?${qs.toString()}`,
    { method: 'DELETE' },
  )
}
