import { describe, expect, it, beforeEach } from 'vitest'
import type { MonthlyRunDetailPayload } from './monthlyRoutesShared'
import {
  clearPaperworkRouteCache,
  getCachedFieldSubmission,
  getCachedRunDetails,
  invalidatePaperworkRouteMonth,
  invalidatePaperworkCacheForRoute,
  setCachedFieldSubmission,
  setCachedRunDetails,
} from './paperworkRouteCache'

const ROUTE_ID = 26
const JUNE = '2026-06-01'
const MAY = '2026-05-01'

function runDetailsPayload(monthIso: string): MonthlyRunDetailPayload {
  return {
    route: {
      id: ROUTE_ID,
      route_number: 26,
      weekday_iso: 1,
      week_occurrence: 1,
      label: 'Route 26',
      location_count: 1,
    },
    month_date: monthIso,
    run: null,
    counts: {
      all_good_count: 0,
      passed_with_problems_count: 0,
      failed_count: 0,
      skipped_count: 0,
    },
    specialists_month: null,
    locations: [],
    review_meta: { stop_count: 0 },
  }
}

describe('paperworkRouteCache', () => {
  beforeEach(() => {
    clearPaperworkRouteCache()
  })

  it('stores and retrieves run details per route month', () => {
    setCachedRunDetails(ROUTE_ID, JUNE, runDetailsPayload(JUNE))
    expect(getCachedRunDetails(ROUTE_ID, JUNE)?.month_date).toBe(JUNE)
    expect(getCachedRunDetails(ROUTE_ID, MAY)).toBeNull()
  })

  it('rejects run details when month_date mismatches key', () => {
    setCachedRunDetails(ROUTE_ID, JUNE, runDetailsPayload(MAY))
    expect(getCachedRunDetails(ROUTE_ID, JUNE)).toBeNull()
  })

  it('stores field submission separately from run details', () => {
    setCachedFieldSubmission(ROUTE_ID, MAY, {
      stops: [],
      capturedAt: '2026-05-31T00:00:00Z',
      fieldWorkReopened: false,
    })

    expect(getCachedFieldSubmission(ROUTE_ID, MAY)?.capturedAt).toBe('2026-05-31T00:00:00Z')
  })

  it('invalidatePaperworkRouteMonth clears all caches for that month', () => {
    setCachedRunDetails(ROUTE_ID, JUNE, runDetailsPayload(JUNE))
    setCachedFieldSubmission(ROUTE_ID, JUNE, {
      stops: [],
      capturedAt: null,
      fieldWorkReopened: false,
    })

    invalidatePaperworkRouteMonth(ROUTE_ID, JUNE)

    expect(getCachedRunDetails(ROUTE_ID, JUNE)).toBeNull()
    expect(getCachedFieldSubmission(ROUTE_ID, JUNE)).toBeNull()
  })

  it('invalidatePaperworkCacheForRoute clears every month for the route', () => {
    setCachedRunDetails(ROUTE_ID, JUNE, runDetailsPayload(JUNE))
    setCachedRunDetails(ROUTE_ID, MAY, runDetailsPayload(MAY))
    setCachedFieldSubmission(ROUTE_ID, MAY, {
      stops: [],
      capturedAt: null,
      fieldWorkReopened: false,
    })

    invalidatePaperworkCacheForRoute(ROUTE_ID)

    expect(getCachedRunDetails(ROUTE_ID, JUNE)).toBeNull()
    expect(getCachedRunDetails(ROUTE_ID, MAY)).toBeNull()
    expect(getCachedFieldSubmission(ROUTE_ID, MAY)).toBeNull()
  })
})
