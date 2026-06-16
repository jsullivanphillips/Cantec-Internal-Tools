import { apiFetch } from '../../lib/apiClient'

export type NonQuoteablePhrase = {
  id: number
  phrase: string
  label: string | null
  active: boolean
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export type ReclassifySummary = {
  total: number
  eligible: number
  excluded_keyword: number
  excluded_stale_cluster: number
  excluded_non_quoteable: number
  classified_at: string
}

export async function fetchNonQuoteablePhrases(): Promise<NonQuoteablePhrase[]> {
  const res = await apiFetch('/api/monday_meeting/service/non_quoteable_phrases')
  if (!res.ok) throw new Error('load_phrases_failed')
  const data = (await res.json()) as { phrases: NonQuoteablePhrase[] }
  return data.phrases
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
  if (!res.ok) throw new Error('create_phrase_failed')
  const data = (await res.json()) as { phrase: NonQuoteablePhrase }
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
  if (!res.ok) throw new Error('update_phrase_failed')
  const data = (await res.json()) as { phrase: NonQuoteablePhrase }
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
