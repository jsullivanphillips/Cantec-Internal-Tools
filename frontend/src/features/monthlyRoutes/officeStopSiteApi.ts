import { apiJson } from '../../lib/apiClient'

import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'

import type { PortalSkipCategory, PortalTestOutcome } from './portalWorkflowShared'



function monthQuery(monthDate: string): string {

  return new URLSearchParams({ month: monthDate }).toString()

}



export async function officeCreateDeficiency(

  routeId: number,

  monthDate: string,

  locationId: number,

  body: { title: string; severity: string; status: string; description?: string; run_id?: number | null },

): Promise<TechnicianWorksheetLocation> {

  const res = await apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(

    `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}/deficiencies?${monthQuery(monthDate)}`,

    { method: 'POST', body: JSON.stringify(body) },

  )

  return res.stop

}



export async function officeUpdateDeficiency(

  routeId: number,

  monthDate: string,

  locationId: number,

  deficiencyId: number,

  body: { title?: string; severity?: string; status?: string; description?: string },

): Promise<TechnicianWorksheetLocation> {

  const res = await apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(

    `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}/deficiencies/${deficiencyId}?${monthQuery(monthDate)}`,

    { method: 'PATCH', body: JSON.stringify(body) },

  )

  return res.stop

}



export async function officeVerifyDeficiency(

  routeId: number,

  monthDate: string,

  locationId: number,

  deficiencyId: number,

  note?: string,

): Promise<TechnicianWorksheetLocation> {

  const res = await apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(

    `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}/deficiencies/${deficiencyId}/verify?${monthQuery(monthDate)}`,

    { method: 'POST', body: JSON.stringify({ note: note ?? '' }) },

  )

  return res.stop

}



export type OfficeSetTestOutcomeBody = {

  test_outcome: PortalTestOutcome

  skip_category?: PortalSkipCategory

  skip_note?: string

  confirmed_no_deficiencies?: boolean

}



export async function officeSetStopTestOutcome(

  routeId: number,

  monthDate: string,

  locationId: number,

  body: OfficeSetTestOutcomeBody,

): Promise<TechnicianWorksheetLocation> {

  const res = await apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(

    `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}/test_outcome?${monthQuery(monthDate)}`,

    { method: 'PUT', body: JSON.stringify(body) },

  )

  return res.stop

}



export async function officeClearStopTestOutcome(

  routeId: number,

  monthDate: string,

  locationId: number,

): Promise<TechnicianWorksheetLocation> {

  const res = await apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(

    `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}/test_outcome?${monthQuery(monthDate)}`,

    { method: 'PUT', body: JSON.stringify({ clear: true }) },

  )

  return res.stop

}


