import { describe, expect, it } from 'vitest'

import {
  derivePrepAnnualScheduleWarning,
  mergePrepAnnualScheduleRow,
  prepAnnualScheduleWarningLabel,
  prepRowAnnualDue,
  prepRowAnnualDueForStop,
} from './prepAnnualSchedule'
import type { AnnualScheduleCheckLocation } from './monthlyRoutesShared'

const baseRow = (overrides: Partial<AnnualScheduleCheckLocation>): AnnualScheduleCheckLocation => ({
  location_id: 1,
  annual_month_matches_run: false,
  has_service_trade_link: true,
  service_trade_site_location_url: 'https://app.servicetrade.com/locations/1',
  has_scheduled_annual_in_month: false,
  prep_warning: null,
  ...overrides,
})

describe('prepRowAnnualDue', () => {
  it('returns false until schedule check is ready', () => {
    expect(prepRowAnnualDue(1, 'loading', null)).toBe(false)
  })

  it('returns true when annual month matches and ST appointment exists', () => {
    const byId = {
      1: baseRow({
        annual_month_matches_run: true,
        has_scheduled_annual_in_month: true,
      }),
    }
    expect(prepRowAnnualDue(1, 'ready', byId)).toBe(true)
  })
})

describe('prepAnnualScheduleWarningLabel', () => {
  it('maps warning codes to labels', () => {
    expect(prepAnnualScheduleWarningLabel('no_annual_scheduled')).toBe('No annual scheduled')
    expect(prepAnnualScheduleWarningLabel('no_servicetrade_link')).toBe('No ServiceTrade link')
    expect(prepAnnualScheduleWarningLabel('annual_scheduled_wrong_month')).toBe(
      'Annual scheduled for this month',
    )
  })
})

describe('mergePrepAnnualScheduleRow', () => {
  it('clears wrong-month warning when live annual month matches run month', () => {
    const stale = baseRow({
      annual_month_matches_run: false,
      has_scheduled_annual_in_month: true,
      prep_warning: 'annual_scheduled_wrong_month',
    })
    const merged = mergePrepAnnualScheduleRow(stale, 'June', '2026-06-01')
    expect(merged?.annual_month_matches_run).toBe(true)
    expect(merged?.prep_warning).toBeNull()
  })

  it('drives orange row styling when annual month and ST appointment align', () => {
    const stale = baseRow({
      annual_month_matches_run: false,
      has_scheduled_annual_in_month: true,
      prep_warning: 'annual_scheduled_wrong_month',
    })
    expect(
      prepRowAnnualDueForStop('ready', stale, 'June', '2026-06-01'),
    ).toBe(true)
  })
})

describe('derivePrepAnnualScheduleWarning', () => {
  it('matches backend warning derivation', () => {
    expect(
      derivePrepAnnualScheduleWarning(true, true, false),
    ).toBe('no_annual_scheduled')
    expect(
      derivePrepAnnualScheduleWarning(false, true, true),
    ).toBe('annual_scheduled_wrong_month')
  })
})
