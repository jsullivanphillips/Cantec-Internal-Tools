import { apiJson } from '../../lib/apiClient'

import type { TechnicianWorksheetStop } from './monthlyRoutesShared'

import type { PortalSkipCategory, PortalTestOutcome } from './portalWorkflowShared'



function monthQuery(monthDate: string): string {

  return new URLSearchParams({ month: monthDate }).toString()

}



export async function officeCreateDeficiency(

  routeId: number,

  monthDate: string,

  testingSiteId: number,

  body: { title: string; severity: string; status: string; description?: string; run_id?: number | null },

): Promise<TechnicianWorksheetStop> {

  const res = await apiJson<{ ok: boolean; stop: TechnicianWorksheetStop }>(

    `/api/monthly_routes/routes/${routeId}/worksheet/stops/${testingSiteId}/deficiencies?${monthQuery(monthDate)}`,

    { method: 'POST', body: JSON.stringify(body) },

  )

  return res.stop

}



export async function officeUpdateDeficiency(

  routeId: number,

  monthDate: string,

  testingSiteId: number,

  deficiencyId: number,

  body: { title?: string; severity?: string; status?: string; description?: string },

): Promise<TechnicianWorksheetStop> {

  const res = await apiJson<{ ok: boolean; stop: TechnicianWorksheetStop }>(

    `/api/monthly_routes/routes/${routeId}/worksheet/stops/${testingSiteId}/deficiencies/${deficiencyId}?${monthQuery(monthDate)}`,

    { method: 'PATCH', body: JSON.stringify(body) },

  )

  return res.stop

}



export async function officeVerifyDeficiency(

  routeId: number,

  monthDate: string,

  testingSiteId: number,

  deficiencyId: number,

  note?: string,

): Promise<TechnicianWorksheetStop> {

  const res = await apiJson<{ ok: boolean; stop: TechnicianWorksheetStop }>(

    `/api/monthly_routes/routes/${routeId}/worksheet/stops/${testingSiteId}/deficiencies/${deficiencyId}/verify?${monthQuery(monthDate)}`,

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

  testingSiteId: number,

  body: OfficeSetTestOutcomeBody,

): Promise<TechnicianWorksheetStop> {

  const res = await apiJson<{ ok: boolean; stop: TechnicianWorksheetStop }>(

    `/api/monthly_routes/routes/${routeId}/worksheet/stops/${testingSiteId}/test_outcome?${monthQuery(monthDate)}`,

    { method: 'PUT', body: JSON.stringify(body) },

  )

  return res.stop

}



export async function officeClearStopTestOutcome(

  routeId: number,

  monthDate: string,

  testingSiteId: number,

): Promise<TechnicianWorksheetStop> {

  const res = await apiJson<{ ok: boolean; stop: TechnicianWorksheetStop }>(

    `/api/monthly_routes/routes/${routeId}/worksheet/stops/${testingSiteId}/test_outcome?${monthQuery(monthDate)}`,

    { method: 'PUT', body: JSON.stringify({ clear: true }) },

  )

  return res.stop

}


