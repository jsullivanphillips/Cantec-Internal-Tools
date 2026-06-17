import type { LibraryLocation } from './monthlyRoutesShared'
import {
  billingStatusLabel,
  billingStatusVariant,
} from './officeRunReviewShared'
import {
  compareYearMonth,
  monthFirstIsoPacificToday,
  parseYearMonth,
} from './monthlyRoutesShared'
import { apiJson } from '../../lib/apiClient'

export function isPastPacificMonth(monthFirstIso: string, reference: Date = new Date()): boolean {
  const ym = parseYearMonth(monthFirstIso)
  const currentYm = parseYearMonth(monthFirstIsoPacificToday(reference))
  if (!ym || !currentYm) return false
  return compareYearMonth(ym, currentYm) < 0
}

export function billingBoardShowUnsetDash(
  cell: BillingBoardMonthCell | undefined,
  monthFirstIso: string,
  reference: Date = new Date(),
): boolean {
  const billing = cell?.billing_status ?? 'unset'
  const fieldWorkEnded = cell?.field_work_ended ?? false
  return billing === 'unset' && !fieldWorkEnded && !isPastPacificMonth(monthFirstIso, reference)
}

const BILLING_PILL_CLICKABLE_STATUSES = new Set(['bill', 'do_not_bill', 'legacy'])

export type BillingBoardPillTone = 'bill' | 'do_not_bill' | 'unset' | 'legacy'

export function billingBoardPillTone(status: string | null | undefined): BillingBoardPillTone {
  const s = (status ?? 'unset').trim().toLowerCase()
  if (s === 'bill' || s === 'do_not_bill' || s === 'legacy') return s
  return 'unset'
}

export function billingMonthPaperworkRouteId(
  row: BillingBoardLocationRow,
  cell: BillingBoardMonthCell | undefined,
): number | null {
  if (cell?.test_monthly_route_id != null) return cell.test_monthly_route_id
  if (row.monthly_route_id != null) return row.monthly_route_id
  return null
}

export function billingMonthPillClickable(
  row: BillingBoardLocationRow,
  cell: BillingBoardMonthCell | undefined,
  monthFirstIso: string,
  reference: Date = new Date(),
): boolean {
  if (billingBoardShowUnsetDash(cell, monthFirstIso, reference)) return false
  const billing = (cell?.billing_status ?? 'unset').trim().toLowerCase()
  if (!BILLING_PILL_CLICKABLE_STATUSES.has(billing)) return false
  return billingMonthPaperworkRouteId(row, cell) != null
}

/** Category and note for waive-pill hover text and aria labels. */
export function billingBoardWaiveTooltipText(cell: BillingBoardMonthCell | undefined): string | null {
  if (!cell || cell.billing_status !== 'do_not_bill') return null
  const category = cell.skip_reason_category?.trim()
  const note = cell.skip_reason_note?.trim()
  const parts: string[] = []
  if (category) parts.push(category)
  if (note) {
    const noteLow = note.toLowerCase()
    const categoryLow = category?.toLowerCase()
    const redundant =
      categoryLow != null &&
      (noteLow === categoryLow || noteLow === `${categoryLow}: ${noteLow}`)
    if (!redundant) parts.push(note)
  }
  return parts.length ? parts.join(' · ') : null
}

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
  /** Human-readable skip category when billing is waive (e.g. Annual). */
  skip_reason_category?: string | null
  /** Free-text skip note when billing is waive. */
  skip_reason_note?: string | null
  /** False while the route-month run is still in field work (billing not yet actionable). */
  field_work_ended?: boolean
}

export type BillingBoardLocationRow = {
  location_id: number
  address: string
  display_address: string | null
  location_label: string
  testing_site_labels?: string[] | null
  building: string | null
  property_management_company: string | null
  billing_comments: string | null
  test_day: string | null
  /** Resolved route number for display/filtering (``R{n}``). */
  route_number: number | null
  monthly_route_id: number | null
  rollup_price_per_month: number | null
  pricing_updated: boolean
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

export const QUARTER_MONTH_LABELS: Record<number, string> = {
  1: 'January, February, March',
  2: 'April, May, June',
  3: 'July, August, September',
  4: 'October, November, December',
}

export function quarterFromCalendarMonth(month: number): number {
  return Math.floor((month - 1) / 3) + 1
}

export function currentBillingQuarter(reference: Date = new Date()): { year: number; quarter: number } {
  const ym = parseYearMonth(monthFirstIsoPacificToday(reference))
  if (!ym) {
    const now = reference
    return { year: now.getFullYear(), quarter: quarterFromCalendarMonth(now.getMonth() + 1) }
  }
  return { year: ym.year, quarter: quarterFromCalendarMonth(ym.month) }
}

export function quarterSelectionKey(year: number, quarter: number): string {
  return `${year}-Q${quarter}`
}

export function parseQuarterSelectionKey(key: string): { year: number; quarter: number } | null {
  const match = key.match(/^(\d{4})-Q([1-4])$/)
  if (!match) return null
  return { year: Number(match[1]), quarter: Number(match[2]) }
}

export function quarterOptionLabel(year: number, quarter: number): string {
  const months = QUARTER_MONTH_LABELS[quarter] ?? ''
  return `Q${quarter} ${year} (${months})`
}

export function quarterSelectionOptions(
  countBackQuarters = 6,
  countForwardQuarters = 1,
  reference: Date = new Date(),
): string[] {
  const { year, quarter } = currentBillingQuarter(reference)
  const anchorIndex = year * 4 + (quarter - 1)
  const keys: string[] = []
  for (let offset = -countBackQuarters; offset <= countForwardQuarters; offset += 1) {
    const index = anchorIndex + offset
    const optionYear = Math.floor(index / 4)
    const optionQuarter = (index % 4) + 1
    keys.push(quarterSelectionKey(optionYear, optionQuarter))
  }
  return keys.reverse()
}

export type BillingBoardQuery = {
  year: number
  quarter: number
  q?: string
  route?: string
  page?: number
  pageSize?: number
  doNotBillAnyMonth?: boolean
  unsetAnyMonth?: boolean
  notBilledQuarter?: boolean
  nonEmptyBillingNotes?: boolean
  pricingUpdated?: boolean
}

export function billingBoardQueryString(params: BillingBoardQuery): string {
  const qs = new URLSearchParams()
  qs.set('year', String(params.year))
  qs.set('quarter', String(params.quarter))
  if (params.q?.trim()) qs.set('q', params.q.trim())
  if (params.route?.trim()) qs.set('route', params.route.trim())
  if (params.page != null) qs.set('page', String(params.page))
  if (params.pageSize != null) qs.set('page_size', String(params.pageSize))
  if (params.doNotBillAnyMonth) qs.set('do_not_bill_any_month', 'true')
  if (params.unsetAnyMonth) qs.set('unset_any_month', 'true')
  if (params.notBilledQuarter) qs.set('not_billed_quarter', 'true')
  if (params.nonEmptyBillingNotes) qs.set('non_empty_billing_notes', 'true')
  if (params.pricingUpdated) qs.set('pricing_updated', 'true')
  return qs.toString()
}

export async function fetchBillingBoard(params: BillingBoardQuery): Promise<BillingBoardPayload> {
  return apiJson<BillingBoardPayload>(
    `/api/monthly_routes/billing_board?${billingBoardQueryString(params)}`,
  )
}

export async function patchQuarterBilled(
  locationId: number,
  year: number,
  quarter: number,
  billed: boolean,
): Promise<{
  location_id: number
  year: number
  quarter: number
  quarter_billed: boolean
  billed_at: string | null
  billed_by: string | null
}> {
  const qs = new URLSearchParams({
    year: String(year),
    quarter: String(quarter),
  })
  return apiJson(
    `/api/monthly_routes/billing_board/locations/${locationId}/quarter_billed?${qs.toString()}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ billed }),
    },
  )
}

export async function patchLocationPricingUpdated(
  locationId: number,
  pricingUpdated: boolean,
): Promise<{ location: LibraryLocation }> {
  return apiJson(`/api/monthly_routes/library/${locationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ pricing_updated: pricingUpdated }),
  })
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

export function quarterTitle(year: number, quarter: number): string {
  return quarterOptionLabel(year, quarter)
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
