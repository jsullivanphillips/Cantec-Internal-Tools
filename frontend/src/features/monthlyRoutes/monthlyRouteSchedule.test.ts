import { describe, expect, it } from 'vitest'
import {
  effectiveRouteTestDayIso,
  formatRouteTestDayLabel,
  buildPacificWorkweekCalendarGrid,
  monthlyRouteOccurrenceDateUtc,
  scheduledRouteTestDayIso,
} from './monthlyRoutesShared'
import type { MonthlyRouteSummary } from './monthlyRoutesShared'

function route(partial: Partial<MonthlyRouteSummary> & Pick<MonthlyRouteSummary, 'weekday_iso' | 'week_occurrence'>): MonthlyRouteSummary {
  return {
    id: 1,
    route_number: 7,
    label: 'R7 · 3rd Monday',
    ...partial,
  }
}

describe('monthlyRouteSchedule', () => {
  it('uses nominal date when not a stat holiday', () => {
    const r = route({ weekday_iso: 2, week_occurrence: 1 }) // 1st Wed Jun 2026 = Jun 3
    expect(effectiveRouteTestDayIso('2026-06-01', r)).toBe('2026-06-03')
    expect(scheduledRouteTestDayIso('2026-06-01', r)).toBe('2026-06-03')
  })

  it('bumps 3rd Monday to 4th Monday when 3rd Monday is Victoria Day', () => {
    const r = route({ weekday_iso: 0, week_occurrence: 3 })
    const nominal = monthlyRouteOccurrenceDateUtc('2026-05-01', r)
    expect(nominal).not.toBeNull()
    expect(effectiveRouteTestDayIso('2026-05-01', r)).toBe('2026-05-25')
  })

  it('returns null when no non-holiday occurrence remains in month', () => {
    const r = route({ weekday_iso: 0, week_occurrence: 5 })
    expect(effectiveRouteTestDayIso('2026-05-01', r)).toBeNull()
  })

  it('formatRouteTestDayLabel renders en-CA weekday and date', () => {
    const label = formatRouteTestDayLabel('2026-06-03')
    expect(label).toContain('2026')
    expect(label.toLowerCase()).toMatch(/wed/)
  })

  it('workweek calendar grid omits weekends', () => {
    const cells = buildPacificWorkweekCalendarGrid('2026-06-01')
    const active = cells.filter((c) => !c.isPadding)
    expect(active.every((c) => {
      const jsDow = new Date(`${c.iso}T00:00:00Z`).getUTCDay()
      return jsDow >= 1 && jsDow <= 5
    })).toBe(true)
    expect(cells.length % 5).toBe(0)
  })
})
