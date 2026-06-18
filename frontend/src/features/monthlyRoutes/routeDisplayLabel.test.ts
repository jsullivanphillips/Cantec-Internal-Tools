import { describe, expect, it } from 'vitest'
import { routeDisplayLabel, type MonthlyRouteSummary } from './monthlyRoutesShared'

function route(overrides: Partial<MonthlyRouteSummary> = {}): MonthlyRouteSummary {
  return {
    id: 1,
    route_number: 17,
    weekday_iso: 0,
    week_occurrence: 3,
    label: 'R17 · 3rd Monday',
    ...overrides,
  }
}

describe('routeDisplayLabel', () => {
  it('returns schedule label when no display_name', () => {
    expect(routeDisplayLabel(route())).toBe('R17 · 3rd Monday')
  })

  it('appends trimmed display_name suffix with middle dot', () => {
    expect(routeDisplayLabel(route({ display_name: "  Thrifty's 2  " }))).toBe(
      "R17 · 3rd Monday · Thrifty's 2",
    )
  })

  it('composes from display_name even when display_label is stale', () => {
    expect(
      routeDisplayLabel(
        route({
          display_name: "Thrifty's 2",
          display_label: 'R17 · 3rd Monday',
        }),
      ),
    ).toBe("R17 · 3rd Monday · Thrifty's 2")
  })

  it('prefers API display_label when display_name is unset', () => {
    expect(
      routeDisplayLabel(
        route({
          display_label: 'R17 · 3rd Monday · From API',
        }),
      ),
    ).toBe('R17 · 3rd Monday · From API')
  })

  it('falls back to route_number when label missing', () => {
    expect(routeDisplayLabel(route({ label: '', route_number: 5 }))).toBe('R5')
  })
})
