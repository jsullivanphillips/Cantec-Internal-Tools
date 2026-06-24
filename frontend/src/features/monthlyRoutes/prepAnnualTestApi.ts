import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetLocation, TechnicianWorksheetRun } from './monthlyRoutesShared'

type PrepAnnualTestResponse = {
  ok: boolean
  stop: TechnicianWorksheetLocation
  run?: TechnicianWorksheetRun
}

export async function postPrepAnnualTest(
  routeId: number,
  locationId: number,
  monthDate: string,
): Promise<PrepAnnualTestResponse> {
  const qs = new URLSearchParams({ month: monthDate })
  return apiJson<PrepAnnualTestResponse>(
    `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}/prep_annual_test?${qs.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}

export async function deletePrepAnnualTest(
  routeId: number,
  locationId: number,
  monthDate: string,
): Promise<PrepAnnualTestResponse> {
  const qs = new URLSearchParams({ month: monthDate })
  return apiJson<PrepAnnualTestResponse>(
    `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}/prep_annual_test?${qs.toString()}`,
    { method: 'DELETE' },
  )
}
