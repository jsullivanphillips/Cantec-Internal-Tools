import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pickDefaultPerformanceMonth } from './RoutePerformanceBreakdown'

describe('pickDefaultPerformanceMonth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00-07:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('selects the previous Pacific calendar month when available', () => {
    expect(
      pickDefaultPerformanceMonth(['2026-08-01', '2026-05-01', '2026-06-01']),
    ).toBe('2026-05-01')
  })

  it('falls back to the newest month on or before the previous month', () => {
    expect(pickDefaultPerformanceMonth(['2026-08-01', '2026-06-01', '2026-04-01'])).toBe('2026-04-01')
  })

  it('falls back to the newest available month when nothing is on or before the previous month', () => {
    expect(pickDefaultPerformanceMonth(['2026-08-01', '2026-07-01'])).toBe('2026-08-01')
  })
})
