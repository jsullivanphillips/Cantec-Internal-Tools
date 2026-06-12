import { apiJson } from '../../lib/apiClient'

export const MAX_TICKET_TAGS = 16
export const MAX_TAG_LENGTH = 64

export type LocationTicketStatus = 'open' | 'in_progress' | 'closed'
export type LocationTicketCloseReason = 'completed' | 'invalid'

export type LocationTicketComment = {
  id: number
  ticket_id: number
  body: string
  created_by: string | null
  created_at: string | null
  updated_at: string | null
}

export type LocationTicketEvent = {
  id: number
  ticket_id: number
  from_status: string | null
  to_status: string
  note: string | null
  created_by: string | null
  created_at: string | null
}

export type LocationTicket = {
  id: number
  location_id: number
  route_id?: number | null
  run_id: number | null
  month_date: string | null
  title: string
  description: string | null
  tags: string[]
  status: LocationTicketStatus
  close_reason: LocationTicketCloseReason | null
  created_by: string | null
  closed_at: string | null
  created_at: string | null
  updated_at: string | null
  location_label?: string
  route_label?: string | null
  comments?: LocationTicketComment[]
  events?: LocationTicketEvent[]
}

export const TICKET_STATUS_LABELS: Record<LocationTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  closed: 'Closed',
}

export const TICKET_CLOSE_REASON_LABELS: Record<LocationTicketCloseReason, string> = {
  completed: 'Completed',
  invalid: 'Invalid',
}

export function ticketStatusBadgeVariant(status: LocationTicketStatus): string {
  switch (status) {
    case 'open':
      return 'warning'
    case 'in_progress':
      return 'info'
    case 'closed':
      return 'secondary'
    default:
      return 'secondary'
  }
}

export function normalizeTagInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_TAG_LENGTH) return null
  return trimmed
}

export function addTagToList(tags: string[], raw: string): { tags: string[]; error: string | null } {
  const tag = normalizeTagInput(raw)
  if (!tag) {
    return { tags, error: 'Enter a tag up to 64 characters.' }
  }
  const exists = tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())
  if (exists) {
    return { tags, error: null }
  }
  if (tags.length >= MAX_TICKET_TAGS) {
    return { tags, error: `A ticket may have at most ${MAX_TICKET_TAGS} tags.` }
  }
  return { tags: [...tags, tag], error: null }
}

export function removeTagFromList(tags: string[], tag: string): string[] {
  return tags.filter((item) => item !== tag)
}

export function ticketAuthorsMatch(sessionUsername: string | null | undefined, author: string | null | undefined): boolean {
  const session = (sessionUsername ?? '').trim().toLowerCase()
  const created = (author ?? '').trim().toLowerCase()
  return Boolean(session) && session === created
}

export async function fetchLocationTickets(
  routeId: number,
  locationId: number,
  includeClosed = false,
): Promise<LocationTicket[]> {
  const params = new URLSearchParams()
  if (includeClosed) params.set('include_closed', '1')
  const qs = params.toString()
  const data = await apiJson<{ tickets: LocationTicket[] }>(
    `/api/monthly_routes/routes/${routeId}/locations/${locationId}/tickets${qs ? `?${qs}` : ''}`,
  )
  return data.tickets ?? []
}

export async function fetchDashboardTickets(includeClosed = false): Promise<LocationTicket[]> {
  const params = new URLSearchParams()
  if (includeClosed) params.set('include_closed', '1')
  const qs = params.toString()
  const data = await apiJson<{ tickets: LocationTicket[] }>(
    `/api/monthly_routes/tickets${qs ? `?${qs}` : ''}`,
  )
  return data.tickets ?? []
}

export async function fetchTicketDetail(ticketId: number): Promise<LocationTicket> {
  const data = await apiJson<{ ticket: LocationTicket }>(`/api/monthly_routes/tickets/${ticketId}`)
  return data.ticket
}

export type CreateLocationTicketInput = {
  title: string
  description?: string | null
  tags?: string[]
  monthDate?: string | null
}

export async function createLocationTicket(
  routeId: number,
  locationId: number,
  input: CreateLocationTicketInput,
): Promise<LocationTicket> {
  const data = await apiJson<{ ticket: LocationTicket }>(
    `/api/monthly_routes/routes/${routeId}/locations/${locationId}/tickets`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        description: input.description ?? null,
        tags: input.tags ?? [],
        month_date: input.monthDate ?? null,
      }),
    },
  )
  return data.ticket
}

export async function patchLocationTicket(
  ticketId: number,
  patch: {
    status?: LocationTicketStatus
    close_reason?: LocationTicketCloseReason
    title?: string
    description?: string | null
    tags?: string[]
    note?: string | null
  },
): Promise<LocationTicket> {
  const data = await apiJson<{ ticket: LocationTicket }>(`/api/monthly_routes/tickets/${ticketId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return data.ticket
}

export async function addTicketComment(ticketId: number, body: string): Promise<LocationTicketComment> {
  const data = await apiJson<{ comment: LocationTicketComment }>(
    `/api/monthly_routes/tickets/${ticketId}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    },
  )
  return data.comment
}

export async function patchTicketComment(
  ticketId: number,
  commentId: number,
  body: string,
): Promise<LocationTicketComment> {
  const data = await apiJson<{ comment: LocationTicketComment }>(
    `/api/monthly_routes/tickets/${ticketId}/comments/${commentId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    },
  )
  return data.comment
}

export async function deleteTicketComment(ticketId: number, commentId: number): Promise<void> {
  await apiJson(`/api/monthly_routes/tickets/${ticketId}/comments/${commentId}`, {
    method: 'DELETE',
  })
}
