import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MonthlyRouteHeroSummary } from './monthlyRoutesShared'
import {
  clearRouteHeroSummaryCache,
  readRouteHeroSummaryCache,
  ROUTE_HERO_SUMMARY_CACHE_MAX_AGE_MS,
  writeRouteHeroSummaryCache,
} from './routeHeroSummaryCache'

const sampleSummary = {
  typical_end_time: '17:30',
  typical_end_time_runs_sampled: 12,
  avg_net_pct: 92.5,
  net_pct_months_sampled: 6,
  avg_skipped_non_annual: 1.2,
  skipped_months_sampled: 6,
} satisfies MonthlyRouteHeroSummary

describe('routeHeroSummaryCache', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
    })
    storage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns cached hero summary within ttl', () => {
    writeRouteHeroSummaryCache(42, sampleSummary)
    expect(readRouteHeroSummaryCache(42)).toEqual(sampleSummary)
  })

  it('returns null after ttl expires', () => {
    writeRouteHeroSummaryCache(42, sampleSummary)
    vi.setSystemTime(new Date(Date.now() + ROUTE_HERO_SUMMARY_CACHE_MAX_AGE_MS + 1))
    expect(readRouteHeroSummaryCache(42)).toBeNull()
  })

  it('keeps routes separate', () => {
    writeRouteHeroSummaryCache(42, sampleSummary)
    expect(readRouteHeroSummaryCache(99)).toBeNull()
  })

  it('clears cache for a route', () => {
    writeRouteHeroSummaryCache(42, sampleSummary)
    clearRouteHeroSummaryCache(42)
    expect(readRouteHeroSummaryCache(42)).toBeNull()
  })
})
