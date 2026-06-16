import { apiFetch, formatApiErrorMessage } from '../../lib/apiClient'
import { serviceDateRangeParams } from './mondayMeetingServiceDateRange'

export type NonQuoteablePhrase = {
  id: number
  phrase: string
  label: string | null
  active: boolean
  notes: string | null
  created_at: string | null
  updated_at: string | null
  matches_in_range?: number
}

export type PhraseListResponse = {
  phrases: NonQuoteablePhrase[]
  window: { start_date: string; end_date: string }
}

export class PhraseAdminApiError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'PhraseAdminApiError'
    this.status = status
    this.body = body
  }
}

async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function throwPhraseAdminError(res: Response, body: unknown, fallback: string): never {
  throw new PhraseAdminApiError(formatApiErrorMessage(res.status, body, fallback), res.status, body)
}

export type ReclassifySummary = {
  total: number
  eligible: number
  excluded_keyword: number
  excluded_stale_cluster: number
  excluded_non_quoteable: number
  classified_at: string
}

export async function fetchNonQuoteablePhrases(
  startDate: string,
  endDate: string,
): Promise<PhraseListResponse> {
  const res = await apiFetch(
    `/api/monday_meeting/service/non_quoteable_phrases${serviceDateRangeParams(startDate, endDate)}`,
  )
  if (!res.ok) throw new Error('load_phrases_failed')
  return (await res.json()) as PhraseListResponse
}

export async function createNonQuoteablePhrase(payload: {
  phrase: string
  label?: string
  notes?: string
  active?: boolean
}): Promise<NonQuoteablePhrase> {
  const res = await apiFetch('/api/monday_meeting/service/non_quoteable_phrases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await readJsonBody(res)
  if (!res.ok) throwPhraseAdminError(res, body, 'Failed to create phrase.')
  const data = body as { phrase: NonQuoteablePhrase }
  return data.phrase
}

export async function updateNonQuoteablePhrase(
  id: number,
  payload: Partial<Pick<NonQuoteablePhrase, 'phrase' | 'label' | 'notes' | 'active'>>,
): Promise<NonQuoteablePhrase> {
  const res = await apiFetch(`/api/monday_meeting/service/non_quoteable_phrases/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await readJsonBody(res)
  if (!res.ok) throwPhraseAdminError(res, body, 'Failed to update phrase.')
  const data = body as { phrase: NonQuoteablePhrase }
  return data.phrase
}

export async function deleteNonQuoteablePhrase(id: number): Promise<void> {
  const res = await apiFetch(`/api/monday_meeting/service/non_quoteable_phrases/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('delete_phrase_failed')
}

export async function reclassifyDeficiencies(): Promise<ReclassifySummary> {
  const res = await apiFetch('/api/monday_meeting/service/reclassify', { method: 'POST' })
  if (!res.ok) throw new Error('reclassify_failed')
  return (await res.json()) as ReclassifySummary
}
