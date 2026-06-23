import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  lastRecordedTestSummary,
  monthHasRecordedTestOutcome,
  nextSiteRouteTestDayLabel,
  nextUntestedMonthIso,
  resolveMonthOutcomeLabel,
  siteUpcomingAnnualDue,
  splitHeroAddressLines,
  testingHistoryChipLabel,
  testingHistoryIsNextSlot,
  testingHistoryShowRouteContext,
  type LibraryLocation,
  type MonthCell,
  type MonthlyRouteSummary,
} from './monthlyRoutesShared'

describe('splitHeroAddressLines', () => {
  it('splits display_address into street and locality', () => {
    expect(
      splitHeroAddressLines({
        display_address: '9851 Seaport Place, Sidney, BC V8L 0B1',
        address: '9851 Seaport Place',
      }),
    ).toEqual({
      streetLine: '9851 Seaport Place',
      localityLine: 'Sidney, BC V8L 0B1',
    })
  })

  it('falls back to address and returns em dash when empty', () => {
    expect(splitHeroAddressLines({ display_address: null, address: '100 Main St' })).toEqual({
      streetLine: '100 Main St',
      localityLine: null,
    })
    expect(splitHeroAddressLines({ display_address: undefined, address: '' })).toEqual({
      streetLine: '—',
      localityLine: null,
    })
  })
})

describe('nextUntestedMonthIso', () => {
  const june2026 = new Date(2026, 5, 17)

  it('treats prepared placeholder months as still untested', () => {
    const months: Record<string, MonthCell> = {
      '2026-06-01': { result_status: 'tested', skip_reason: null },
      '2026-07-01': { result_status: null, skip_reason: null },
    }
    expect(nextUntestedMonthIso(months, june2026)).toBe('2026-07-01')
  })

  it('skips months with tested or skipped outcomes', () => {
    const months: Record<string, MonthCell> = {
      '2026-06-01': { result_status: 'tested', skip_reason: null },
      '2026-07-01': { result_status: 'skipped', skip_reason: 'annual' },
    }
    expect(nextUntestedMonthIso(months, june2026)).toBe('2026-08-01')
  })

  it('does not treat prepared annual billing-only rows as recorded', () => {
    const months: Record<string, MonthCell> = {
      '2026-06-01': { result_status: 'tested', skip_reason: null },
      '2026-07-01': {
        result_status: null,
        skip_reason: null,
        billing_status: 'do_not_bill',
        run_id: 42,
        run_workflow_stage: 'prepared',
      },
    }
    expect(nextUntestedMonthIso(months, june2026, 'July')).toBe('2026-07-01')
  })

  it('does not treat annual_booked on a prepared run as recorded', () => {
    const months: Record<string, MonthCell> = {
      '2026-06-01': { result_status: 'tested', skip_reason: null },
      '2026-07-01': {
        result_status: 'skipped',
        skip_reason: 'annual_booked',
        run_id: 53,
        run_workflow_stage: 'prepared',
      },
    }
    expect(nextUntestedMonthIso(months, june2026, 'July')).toBe('2026-07-01')
  })
})

describe('monthHasRecordedTestOutcome', () => {
  it('returns false for prepared placeholders without result_status', () => {
    expect(
      monthHasRecordedTestOutcome(
        {
          result_status: null,
          skip_reason: null,
          run_id: 10,
          run_workflow_stage: 'prepared',
        },
        '2026-07-01',
        'July',
      ),
    ).toBe(false)
  })

  it('returns true after annual skip is recorded', () => {
    expect(
      monthHasRecordedTestOutcome(
        { result_status: 'skipped', skip_reason: 'annual' },
        '2026-07-01',
        'July',
      ),
    ).toBe(true)
  })

  it('ignores sheet annual_booked on a prepared run until field work', () => {
    expect(
      monthHasRecordedTestOutcome(
        {
          result_status: 'skipped',
          skip_reason: 'annual_booked',
          run_id: 53,
          run_workflow_stage: 'prepared',
        },
        '2026-07-01',
        'July',
      ),
    ).toBe(false)
  })
})

describe('testingHistoryIsNextSlot', () => {
  it('treats prepared placeholder cells as the next slot', () => {
    expect(
      testingHistoryIsNextSlot(
        '2026-07-01',
        '2026-07-01',
        { result_status: null, skip_reason: null, run_id: 9, run_workflow_stage: 'prepared' },
        'July',
      ),
    ).toBe(true)
  })
})

describe('testingHistoryChipLabel', () => {
  it('shows Annual for next slot when ST annual is scheduled', () => {
    expect(
      testingHistoryChipLabel(
        { result_status: null, skip_reason: null, run_id: 9, run_workflow_stage: 'prepared' },
        '2026-07-01',
        'July',
        {
          isNextSlot: true,
          isAnnualMonthRow: true,
          annualDueOnSchedule: true,
        },
      ),
    ).toBe('Annual')
  })

  it('shows Pending for next slot when annual month lacks ST schedule match', () => {
    expect(
      testingHistoryChipLabel(
        { result_status: null, skip_reason: null },
        '2026-07-01',
        'July',
        {
          isNextSlot: true,
          isAnnualMonthRow: true,
          annualDueOnSchedule: false,
        },
      ),
    ).toBe('Pending')
  })
})

describe('testingHistoryShowRouteContext', () => {
  it('hides route context until a result is recorded', () => {
    expect(
      testingHistoryShowRouteContext(
        { result_status: null, skip_reason: null, run_id: 9, run_workflow_stage: 'prepared' },
        '2026-07-01',
        'July',
      ),
    ).toBe(false)
    expect(
      testingHistoryShowRouteContext(
        { result_status: 'skipped', skip_reason: 'annual_booked', run_workflow_stage: 'prepared' },
        '2026-07-01',
        'July',
      ),
    ).toBe(false)
    expect(
      testingHistoryShowRouteContext(
        { result_status: 'skipped', skip_reason: 'annual', run_workflow_stage: 'completed' },
        '2026-07-01',
        'July',
      ),
    ).toBe(true)
  })
})

describe('siteUpcomingAnnualDue', () => {
  it('requires both annual month match and scheduled inspection', () => {
    expect(
      siteUpcomingAnnualDue('July', '2026-07-01', { has_scheduled_annual_in_month: true }),
    ).toBe(true)
    expect(
      siteUpcomingAnnualDue('July', '2026-06-01', { has_scheduled_annual_in_month: true }),
    ).toBe(false)
    expect(siteUpcomingAnnualDue('July', '2026-07-01', { has_scheduled_annual_in_month: false })).toBe(
      false,
    )
  })
})

describe('resolveMonthOutcomeLabel', () => {
  it('labels annual skips as Annual', () => {
    expect(
      resolveMonthOutcomeLabel(
        { result_status: 'skipped', skip_reason: 'annual' },
        '2026-05-01',
        'May',
      ),
    ).toBe('Annual')
  })

  it('infers Annual from billing when the site annual month row lacks result_status', () => {
    expect(
      resolveMonthOutcomeLabel(
        { result_status: null, skip_reason: null, billing_status: 'do_not_bill', run_id: 99 },
        '2026-06-01',
        'June',
      ),
    ).toBe('Annual')
  })
})

describe('lastRecordedTestSummary', () => {
  const july2026 = new Date(2026, 6, 10)
  const route: MonthlyRouteSummary = {
    id: 15,
    route_number: 15,
    label: 'R15',
    week_occurrence: 2,
    weekday_iso: 3,
  }

  it('returns the month before the upcoming test month', () => {
    const months: Record<string, MonthCell> = {
      '2026-05-01': { result_status: 'skipped', skip_reason: 'annual' },
      '2026-06-01': { result_status: 'tested', skip_reason: null },
      '2026-07-01': { result_status: null, skip_reason: null },
    }
    expect(
      lastRecordedTestSummary(months, {
        reference: july2026,
        monthly_route: route,
        annualMonth: 'June',
      }),
    ).toBe('June 2026 — Tested')
  })

  it('shows June Annual when June is open in history but billed as annual before July test', () => {
    const months: Record<string, MonthCell> = {
      '2026-05-01': { result_status: 'tested', skip_reason: null },
      '2026-06-01': {
        result_status: null,
        skip_reason: null,
        billing_status: 'do_not_bill',
        run_id: 42,
      },
      '2026-07-01': { result_status: null, skip_reason: null },
    }
    expect(
      lastRecordedTestSummary(months, {
        reference: july2026,
        monthly_route: route,
        annualMonth: 'June',
      }),
    ).toBe('June 2026 — Annual')
  })

  it('shows Annual for the previous month when that run was skipped for annual', () => {
    const months: Record<string, MonthCell> = {
      '2026-03-01': { result_status: 'tested', skip_reason: null },
      '2026-06-01': { result_status: 'skipped', skip_reason: 'annual' },
      '2026-07-01': { result_status: null, skip_reason: null },
    }
    expect(
      lastRecordedTestSummary(months, {
        reference: july2026,
        monthly_route: route,
        annualMonth: 'June',
      }),
    ).toBe('June 2026 — Annual')
  })

  it('returns null when the previous month has no recorded outcome', () => {
    expect(lastRecordedTestSummary({}, { reference: july2026, monthly_route: route })).toBeNull()
    expect(
      lastRecordedTestSummary(
        {
          '2026-07-01': { result_status: null, skip_reason: null },
        },
        { reference: july2026, monthly_route: route },
      ),
    ).toBeNull()
  })
})

describe('nextSiteRouteTestDayLabel', () => {
  const baseLocation = (overrides: Partial<LibraryLocation> = {}): LibraryLocation =>
    ({
      id: 1,
      address: '100 Test Ave',
      status_normalized: 'active',
      keys: null,
      test_day: null,
      annual_month: null,
      price_per_month: null,
      months: {},
      ...overrides,
    }) as LibraryLocation

  it('returns formatted next test day when route is assigned', () => {
    const label = nextSiteRouteTestDayLabel(
      baseLocation({
        months: { '2026-05-01': { result_status: 'tested', skip_reason: null } },
        monthly_route: {
          id: 10,
          route_number: 2,
          label: 'M1-R2',
          week_occurrence: 1,
          weekday_iso: 2,
        },
      }),
    )
    expect(label).not.toBe('—')
    expect(label).toMatch(/20\d{2}/)
    expect(label).toMatch(/day/)
  })

  it('uses prepared but unrecorded months as the next test month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 17))
    try {
      const route: MonthlyRouteSummary = {
        id: 15,
        route_number: 15,
        label: 'R15',
        week_occurrence: 2,
        weekday_iso: 3,
      }
      const label = nextSiteRouteTestDayLabel(
        baseLocation({
          months: {
            '2026-06-01': { result_status: 'tested', skip_reason: null },
            '2026-07-01': { result_status: null, skip_reason: null },
          },
          monthly_route: route,
        }),
      )
      expect(label).toMatch(/Jul/i)
      expect(label).not.toMatch(/Aug/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips a past test day in the current open month and shows the next month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 18))
    try {
      const route: MonthlyRouteSummary = {
        id: 15,
        route_number: 15,
        label: 'R15',
        week_occurrence: 2,
        weekday_iso: 3,
      }
      const location = baseLocation({
        months: {
          '2026-05-01': { result_status: 'tested', skip_reason: null },
          '2026-06-01': { result_status: null, skip_reason: null },
          '2026-07-01': { result_status: null, skip_reason: null },
        },
        annual_month: 'June',
        monthly_route: route,
      })
      const label = nextSiteRouteTestDayLabel(location)
      expect(label).toMatch(/Jul/i)
      expect(label).not.toMatch(/Jun/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns em dash when unassigned or route has no test day pattern', () => {
    expect(nextSiteRouteTestDayLabel(baseLocation())).toBe('—')
    expect(
      nextSiteRouteTestDayLabel(
        baseLocation({
          monthly_route: {
            id: 10,
            route_number: 2,
            label: 'M1-R2',
          } as MonthlyRouteSummary,
        }),
      ),
    ).toBe('—')
  })
})

afterEach(() => {
  vi.useRealTimers()
})
