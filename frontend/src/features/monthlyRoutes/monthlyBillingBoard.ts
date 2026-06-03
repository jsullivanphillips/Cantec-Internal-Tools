import { apiJson } from '../../lib/apiClient'
import {
  billingStatusLabel,
  billingStatusVariant,
} from './officeRunReviewShared'

export type BillingBoardTestSummaryKey =
  | 'failed'
  | 'passed_with_problems'
  | 'skipped'
  | 'all_good'
  | 'tested'
  | 'annual'
  | 'pending'

export type BillingBoardMonthCell = {
  billing_status: string
  test_summary: {
    summary_key: BillingBoardTestSummaryKey
    outcomes: string[]
    testing_site_count: number
  }
  test_monthly_route_id: number | null
}

export type BillingBoardLocationRow = {
  location_id: number
  address: string
  display_address: string | null
  location_label: string
  testing_site_labels?: string[] | null
  building: string | null
  billing_comments: string | null
  test_day: string | null
  /** Resolved route number for display/filtering (``R{n}``). */
  route_number: number | null
  monthly_route_id: number | null
  rollup_price_per_month: number | null
  months: Record<string, BillingBoardMonthCell>
  quarter_billed: boolean
  billed_at: string | null
  billed_by: string | null
}

export type BillingBoardPayload = {
  year: number
  quarter: number
  month_dates: string[]
  locations: BillingBoardLocationRow[]
  pagination: {
    page: number
    page_size: number
    total: number
    total_pages: number
  }
  meta: {
    routes: string[]
  }
}

export type BillingBoardQuery = {
  anchorMonth: string
  q?: string
  route?: string
  page?: number
  pageSize?: number
  billAnyMonth?: boolean
  unsetAnyMonth?: boolean
  notBilledQuarter?: boolean
  failedAnyMonth?: boolean
}

export function billingBoardQueryString(params: BillingBoardQuery): string {
  const qs = new URLSearchParams()
  qs.set('anchor_month', params.anchorMonth)
  if (params.q?.trim()) qs.set('q', params.q.trim())
  if (params.route?.trim()) qs.set('route', params.route.trim())
  if (params.page != null) qs.set('page', String(params.page))
  if (params.pageSize != null) qs.set('page_size', String(params.pageSize))
  if (params.billAnyMonth) qs.set('bill_any_month', 'true')
  if (params.unsetAnyMonth) qs.set('unset_any_month', 'true')
  if (params.notBilledQuarter) qs.set('not_billed_quarter', 'true')
  if (params.failedAnyMonth) qs.set('failed_any_month', 'true')
  return qs.toString()
}

export async function fetchBillingBoard(params: BillingBoardQuery): Promise<BillingBoardPayload> {
  return apiJson<BillingBoardPayload>(
    `/api/monthly_routes/billing_board?${billingBoardQueryString(params)}`,
  )
}

export async function patchQuarterBilled(
  locationId: number,
  anchorMonth: string,
  billed: boolean,
): Promise<{
  location_id: number
  year: number
  quarter: number
  quarter_billed: boolean
  billed_at: string | null
  billed_by: string | null
}> {
  const qs = new URLSearchParams({ anchor_month: anchorMonth })
  return apiJson(
    `/api/monthly_routes/billing_board/locations/${locationId}/quarter_billed?${qs.toString()}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ billed }),
    },
  )
}

export function formatMonthHeader(monthIso: string): string {
  const match = monthIso.match(/^(\d{4})-(\d{2})/)
  if (!match) return monthIso
  const year = Number(match[1])
  const month = Number(match[2])
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

export function quarterTitle(year: number, quarter: number, monthDates: string[]): string {
  const months = monthDates.map(formatMonthHeader).join(' – ')
  return `Q${quarter} ${year} (${months})`
}

const TEST_SUMMARY_LABELS: Record<BillingBoardTestSummaryKey, string> = {
  failed: 'Failed',
  passed_with_problems: 'Passed w/ problems',
  skipped: 'Skipped',
  all_good: 'All good',
  tested: 'Tested',
  annual: 'Annual',
  pending: 'Pending',
}

export function testSummaryLabel(key: BillingBoardTestSummaryKey): string {
  return TEST_SUMMARY_LABELS[key] ?? 'Pending'
}

export function testSummaryBadgeVariant(key: BillingBoardTestSummaryKey): string {
  switch (key) {
    case 'all_good':
    case 'tested':
      return 'success'
    case 'passed_with_problems':
      return 'warning'
    case 'failed':
      return 'danger'
    case 'skipped':
      return 'secondary'
    case 'annual':
      return 'info'
    default:
      return 'light'
  }
}

export { billingStatusLabel, billingStatusVariant }
