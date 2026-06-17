import { apiFetch, formatApiErrorMessage, readApiErrorBody } from '../../lib/apiClient'

export type StBulkReleaseAction = 'release' | 'unrelease'

export type StBulkReleaseStatus = {
  month_date: string
  month_allowed: boolean
  eligible_count: number
  all_released: boolean
  action: StBulkReleaseAction | null
}

export type StBulkReleaseProgressEvent =
  | { type: 'start'; total: number; action: StBulkReleaseAction }
  | {
      type: 'progress'
      index: number
      total: number
      route_number: number
      status: 'success' | 'skipped' | 'failed'
      message: string
    }
  | {
      type: 'done'
      success_count: number
      skipped_count: number
      failed_count: number
      failures: { route_number: number; message: string }[]
    }
  | { type: 'error'; error: string }

export async function fetchStBulkReleaseStatus(monthFirstIso: string): Promise<StBulkReleaseStatus> {
  const qs = new URLSearchParams({ month_date: monthFirstIso })
  const res = await apiFetch(`/api/monthly_routes/dashboard/st_job_release_status?${qs.toString()}`)
  if (!res.ok) {
    const body = await readApiErrorBody(res)
    throw new Error(
      formatApiErrorMessage(res.status, body, 'Unable to load ServiceTrade release status.'),
    )
  }
  return (await res.json()) as StBulkReleaseStatus
}

export async function streamBulkStJobRelease(
  monthFirstIso: string,
  action: StBulkReleaseAction,
  onEvent: (event: StBulkReleaseProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiFetch('/api/monthly_routes/dashboard/st_job_release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month_date: monthFirstIso, action }),
    signal,
  })
  if (!res.ok) {
    const body = await readApiErrorBody(res)
    throw new Error(
      formatApiErrorMessage(res.status, body, 'Unable to update ServiceTrade job release status.'),
    )
  }
  if (!res.body) {
    throw new Error('No response body from bulk release endpoint.')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      onEvent(JSON.parse(trimmed) as StBulkReleaseProgressEvent)
    }
  }

  const tail = buffer.trim()
  if (tail) {
    onEvent(JSON.parse(tail) as StBulkReleaseProgressEvent)
  }
}
